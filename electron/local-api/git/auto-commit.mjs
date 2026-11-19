import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  GIT_MUTATION_TIMEOUT_MS,
  execGit,
  execGitStreaming,
} from "./runner.mjs";
import { parseGitPorcelainV2Status } from "./porcelain-v2.mjs";
import {
  normalizeRelativePath,
  resolveExistingWorkspacePath,
  resolveWorkspacePath,
} from "../files/path-policy.mjs";

export const GIT_AUTO_COMMIT_MAX_PATHS = 100;
export const GIT_AUTO_COMMIT_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const GIT_AUTO_COMMIT_STATUS_LIMIT = 10_000;
const EMPTY_TREE_OID_BY_LENGTH = new Map();

export async function runWorkspaceGitAutoCommit(rootPath, options = {}) {
  const root = resolveWorkspacePath(rootPath, null);
  const identity = requireIdentity(options.identity, root);
  const journal = requireJournal(options.journal);
  const now = options.now ?? (() => Date.now());
  const randomUUID = options.randomUUID ?? crypto.randomUUID;
  const contentEpoch = options.contentEpoch;
  const isContentEpochCurrent = options.isContentEpochCurrent ?? (() => true);
  const isExecutionAllowed = options.isExecutionAllowed ?? (() => true);
  const mutationTimeoutMs = boundedInteger(
    options.mutationTimeoutMs,
    1,
    GIT_MUTATION_TIMEOUT_MS,
    GIT_MUTATION_TIMEOUT_MS,
  );

  const existing = await journal.read(root);
  if (existing.record) {
    return recoverWorkspaceGitAutoCommit(root, { ...options, identity, journal });
  }

  const preflight = await inspectAutoCommitPreflight(root, {
    identity,
    maxPaths: options.maxPaths,
    maxTotalBytes: options.maxTotalBytes,
  });
  if (!preflight.ok) return result("skipped", preflight.reason, { retryable: preflight.retryable });
  if (!Number.isSafeInteger(contentEpoch) || !isContentEpochCurrent(contentEpoch)) {
    return result("skipped", "content-changed", { retryable: true });
  }
  if (!await isExecutionAllowed()) {
    return result("skipped", "feature-disabled", { retryable: false });
  }

  const operationId = randomUUID();
  const journalPaths = await journal.resolvePaths(root);
  const temporaryIndexName = `auto-commit-index.${operationId}`;
  const temporaryIndexPath = path.join(journalPaths.directory, temporaryIndexName);
  let record = {
    schema_version: 1,
    operation_id: operationId,
    revision: 0,
    phase: "prepared",
    workspace_key: options.workspaceKey,
    branch_ref: preflight.branchRef,
    expected_head: preflight.head,
    initial_index_tree: preflight.indexTree,
    temporary_index_name: temporaryIndexName,
    paths: preflight.paths,
    path_entries: [],
    content_epoch: contentEpoch,
    staged_tree: null,
    resulting_commit: null,
    created_at: new Date(now()).toISOString(),
    updated_at: new Date(now()).toISOString(),
  };

  try {
    record = (await journal.create(root, record)).record;
    await options.afterPhase?.("prepared", record);
    await options.afterCheckpoint?.("journal-prepared", { record });
    await prepareIsolatedIndex(
      root,
      temporaryIndexPath,
      preflight.head,
      preflight.paths,
      mutationTimeoutMs,
    );
    const pathEntries = await readIndexEntries(root, preflight.paths, temporaryIndexPath);
    if (!samePaths(pathEntries.map((entry) => entry.path), preflight.paths)) {
      throw createAutoCommitError("staged-path-mismatch");
    }
    const stagedTree = (await execGit(root, ["write-tree"], {
      indexFile: temporaryIndexPath,
      optionalLocks: false,
    })).stdout.trim();
    await options.afterCheckpoint?.("isolated-index-prepared", {
      record,
      pathEntries,
      stagedTree,
    });
    record = (await journal.update(root, record, {
      phase: "staged",
      path_entries: pathEntries,
      staged_tree: stagedTree,
      updated_at: new Date(now()).toISOString(),
    })).record;
    await options.afterPhase?.("staged", record);
    await options.afterCheckpoint?.("journal-staged", { record });

    if (!isContentEpochCurrent(contentEpoch)) {
      await clearUncommittedTransaction(root, journal, record, temporaryIndexPath);
      return result("skipped", "content-changed", { retryable: true });
    }
    if (!await isExecutionAllowed()) {
      await clearUncommittedTransaction(root, journal, record, temporaryIndexPath);
      return result("skipped", "feature-disabled", { retryable: false });
    }
    const refGuard = await readRefGuard(root);
    if (refGuard.branchRef !== record.branch_ref || refGuard.head !== record.expected_head) {
      await clearUncommittedTransaction(root, journal, record, temporaryIndexPath);
      return result("skipped", "repository-changed", { retryable: true });
    }

    const title = `Puppyone autosave: add ${record.paths.length} ${record.paths.length === 1 ? "file" : "files"}`;
    await execGit(root, [
      "commit",
      "-m", title,
      "-m", `Puppyone-Auto-Commit: ${operationId}`,
    ], {
      indexFile: temporaryIndexPath,
      timeout: mutationTimeoutMs,
    });
    const commitId = (await execGit(root, ["rev-parse", "HEAD"], { optionalLocks: false })).stdout.trim();
    await options.afterGitCommit?.({ commitId, record });
    await options.afterCheckpoint?.("commit-created", { record, commitId });
    record = (await journal.update(root, record, {
      phase: "committed",
      resulting_commit: commitId,
      updated_at: new Date(now()).toISOString(),
    })).record;
    await options.afterPhase?.("committed", record);
    await options.afterCheckpoint?.("journal-committed", { record, commitId });

    const verification = await verifyCommittedRecord(root, record);
    if (!verification.ok) {
      return result("needs-review", verification.reason, {
        commitId,
        pathCount: record.paths.length,
        retryable: false,
      });
    }
    await options.afterCheckpoint?.("commit-verified", { record, commitId });
    const reconciliation = await reconcileRealIndex(root, record.path_entries, mutationTimeoutMs);
    if (!reconciliation.ok) {
      return result("needs-review", reconciliation.reason, {
        commitId,
        pathCount: record.paths.length,
        retryable: false,
      });
    }
    await options.afterCheckpoint?.("index-reconciled", { record, commitId });
    await removeTemporaryIndex(temporaryIndexPath);
    await journal.clear(root, record);
    return result("committed", "untracked-files-committed", {
      commitId,
      pathCount: record.paths.length,
      retryable: false,
    });
  } catch (error) {
    if (error?.autoCommitCrash === true) throw error;
    const recovery = await recoverWorkspaceGitAutoCommit(root, { ...options, identity, journal });
    if (recovery.outcome === "needs-review" || recovery.outcome === "committed") return recovery;
    return result("failed", classifyTransactionFailure(error), { retryable: true });
  }
}

export async function recoverWorkspaceGitAutoCommit(rootPath, options = {}) {
  const root = resolveWorkspacePath(rootPath, null);
  requireIdentity(options.identity, root);
  const journal = requireJournal(options.journal);
  let entry;
  try {
    entry = await journal.read(root);
  } catch {
    return result("needs-review", "journal-invalid", { retryable: false });
  }
  const record = entry.record;
  if (!record) return result("no-op", "no-pending-transaction", { retryable: false });
  if (record.workspace_key !== options.workspaceKey) {
    return result("needs-review", "workspace-identity-changed", { retryable: false });
  }
  const temporaryIndexPath = path.join(entry.directory, record.temporary_index_name);
  const guard = await readRefGuard(root).catch(() => null);
  if (!guard || guard.branchRef !== record.branch_ref) {
    return result("needs-review", "branch-changed", { retryable: false });
  }

  if (guard.head === record.expected_head) {
    await removeTemporaryIndex(temporaryIndexPath);
    await journal.clear(root, record);
    return result("no-op", "recovered-before-commit", { retryable: true });
  }

  const verification = await verifyCommittedRecord(root, {
    ...record,
    resulting_commit: record.resulting_commit ?? guard.head,
  });
  if (!verification.ok) {
    return result("needs-review", verification.reason, {
      commitId: guard.head,
      pathCount: record.paths.length,
      retryable: false,
    });
  }
  const mutationTimeoutMs = boundedInteger(
    options.mutationTimeoutMs,
    1,
    GIT_MUTATION_TIMEOUT_MS,
    GIT_MUTATION_TIMEOUT_MS,
  );
  const reconciliation = await reconcileRealIndex(root, record.path_entries, mutationTimeoutMs);
  if (!reconciliation.ok) {
    return result("needs-review", reconciliation.reason, {
      commitId: guard.head,
      pathCount: record.paths.length,
      retryable: false,
    });
  }
  let committedRecord = record;
  if (record.phase !== "committed") {
    committedRecord = (await journal.update(root, record, {
      phase: "committed",
      resulting_commit: guard.head,
      updated_at: new Date((options.now ?? (() => Date.now()))()).toISOString(),
    })).record;
  }
  await removeTemporaryIndex(temporaryIndexPath);
  await journal.clear(root, committedRecord);
  return result("committed", "recovered-committed-transaction", {
    commitId: guard.head,
    pathCount: record.paths.length,
    retryable: false,
  });
}

export async function inspectAutoCommitPreflight(rootPath, options = {}) {
  const root = resolveWorkspacePath(rootPath, null);
  const identity = requireIdentity(options.identity, root);
  const statusResult = await execGitStreaming(root, [
    "status",
    "--porcelain=v2",
    "-z",
    "--branch",
    "--untracked-files=all",
  ], {
    optionalLocks: false,
    recordLimit: GIT_AUTO_COMMIT_STATUS_LIMIT + 32,
  }).catch(() => null);
  if (!statusResult) return blocked("repository-unavailable", true);
  const parsed = parseGitPorcelainV2Status(statusResult.stdout);
  if (statusResult.didHitLimit || parsed.entries.length > GIT_AUTO_COMMIT_STATUS_LIMIT) {
    return blocked("status-limit", false);
  }
  if (await hasInProgressOperation(identity)) return blocked("operation-in-progress", true);
  if (parsed.entries.some((entry) => entry.conflict || entry.status === "conflict")) {
    return blocked("conflicts-present", true);
  }
  if (parsed.entries.some((entry) => isStagedEntry(entry))) {
    return blocked("user-staged-changes", true);
  }

  const branchRef = (await execGit(root, ["symbolic-ref", "-q", "HEAD"], { optionalLocks: false })
    .catch(() => ({ stdout: "" }))).stdout.trim();
  if (!branchRef.startsWith("refs/heads/")) return blocked("named-branch-required", false);
  const head = await readHead(root);
  const [authorName, authorEmail, signing] = await Promise.all([
    readConfig(root, "user.name"),
    readConfig(root, "user.email"),
    readBooleanConfig(root, "commit.gpgsign"),
  ]);
  if (!authorName || !authorEmail) return blocked("author-identity-required", false);
  if (signing === true) return blocked("commit-signing-required", false);

  const untracked = parsed.entries
    .filter((entry) => entry.status === "untracked")
    .map((entry) => normalizeRelativePath(entry.path));
  if (untracked.length === 0) return blocked("no-untracked-files", false);
  const maxPaths = boundedInteger(options.maxPaths, 1, GIT_AUTO_COMMIT_MAX_PATHS, GIT_AUTO_COMMIT_MAX_PATHS);
  if (untracked.length > maxPaths) return blocked("candidate-count-limit", false);

  const paths = [...new Set(untracked)].sort((left, right) => left.localeCompare(right));
  let totalBytes = 0;
  const checkedDirectories = new Map();
  for (const relativePath of paths) {
    if (isSensitivePath(relativePath)) return blocked("sensitive-candidate", false);
    let absolutePath;
    try {
      absolutePath = await resolveExistingWorkspacePath(root, relativePath);
    } catch {
      return blocked("unsupported-candidate", true);
    }
    const metadata = await fs.lstat(absolutePath).catch(() => null);
    if (metadata?.isDirectory() && await containsGitAdministrativeEntry(absolutePath)) {
      return blocked("nested-repository", false);
    }
    if (!metadata?.isFile() || metadata.isSymbolicLink()) return blocked("unsupported-candidate", false);
    if (await isInsideNestedRepository(root, absolutePath, checkedDirectories)) {
      return blocked("nested-repository", false);
    }
    totalBytes += metadata.size;
  }
  const maxTotalBytes = boundedInteger(
    options.maxTotalBytes,
    1,
    GIT_AUTO_COMMIT_MAX_TOTAL_BYTES,
    GIT_AUTO_COMMIT_MAX_TOTAL_BYTES,
  );
  if (totalBytes > maxTotalBytes) return blocked("candidate-size-limit", false);

  return {
    ok: true,
    branchRef,
    head,
    indexTree: await readIndexTree(root),
    paths,
    totalBytes,
  };
}

async function prepareIsolatedIndex(root, indexFile, head, paths, mutationTimeoutMs) {
  await fs.rm(indexFile, { force: true });
  await execGit(root, head ? ["read-tree", head] : ["read-tree", "--empty"], {
    indexFile,
    optionalLocks: false,
  });
  await fs.chmod(indexFile, 0o600).catch(() => undefined);
  await execGit(root, ["add", "--", ...paths], {
    indexFile,
    timeout: mutationTimeoutMs,
  });
}

async function clearUncommittedTransaction(root, journal, record, temporaryIndexPath) {
  await removeTemporaryIndex(temporaryIndexPath);
  await journal.clear(root, record);
}

async function verifyCommittedRecord(root, record) {
  const head = await readHead(root);
  const expectedCommit = record.resulting_commit ?? head;
  if (!head || head !== expectedCommit) return blocked("head-changed", false);
  const [commitLine, tree, message, committedPaths] = await Promise.all([
    execGit(root, ["rev-list", "--parents", "-n", "1", head], { optionalLocks: false }),
    execGit(root, ["rev-parse", `${head}^{tree}`], { optionalLocks: false }),
    execGit(root, ["log", "-1", "--format=%B", head], { optionalLocks: false }),
    execGit(root, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-z", "-r", head], {
      optionalLocks: false,
    }),
  ]);
  const parents = commitLine.stdout.trim().split(/\s+/).slice(1);
  if ((record.expected_head && parents[0] !== record.expected_head) || (!record.expected_head && parents.length > 0)) {
    return blocked("unexpected-commit-parent", false);
  }
  if (tree.stdout.trim() !== record.staged_tree) return blocked("unexpected-commit-tree", false);
  if (!message.stdout.includes(`Puppyone-Auto-Commit: ${record.operation_id}`)) {
    return blocked("commit-identity-mismatch", false);
  }
  const paths = committedPaths.stdout.split("\0").filter(Boolean).sort((a, b) => a.localeCompare(b));
  if (!samePaths(paths, [...record.paths].sort((a, b) => a.localeCompare(b)))) {
    return blocked("committed-path-mismatch", false);
  }
  return { ok: true };
}

async function reconcileRealIndex(root, committedEntries, mutationTimeoutMs = GIT_MUTATION_TIMEOUT_MS) {
  if (!Array.isArray(committedEntries) || committedEntries.length === 0) {
    return blocked("staged-record-missing", false);
  }
  const paths = committedEntries.map((entry) => entry.path);
  const currentEntries = await readIndexEntries(root, paths, null);
  const committedByPath = new Map(committedEntries.map((entry) => [entry.path, entry]));
  for (const entry of currentEntries) {
    const committed = committedByPath.get(entry.path);
    if (!committed || committed.blob !== entry.blob || committed.mode !== entry.mode) {
      return blocked("index-ownership-ambiguous", false);
    }
  }
  const input = committedEntries.map((entry) => `${entry.mode} ${entry.blob}\t${entry.path}\0`).join("");
  await execGit(root, ["update-index", "--add", "-z", "--index-info"], {
    input,
    timeout: mutationTimeoutMs,
  });
  const verified = await readIndexEntries(root, paths, null);
  return sameIndexEntries(verified, committedEntries)
    ? { ok: true }
    : blocked("index-reconciliation-failed", false);
}

async function readIndexEntries(root, paths, indexFile) {
  const { stdout } = await execGit(root, ["ls-files", "--stage", "-z", "--", ...paths], {
    optionalLocks: false,
    ...(indexFile ? { indexFile } : {}),
  });
  return stdout.split("\0").filter(Boolean).map((record) => {
    const match = /^(\d+) ([0-9a-f]+) \d\t([\s\S]+)$/i.exec(record);
    if (!match) throw createAutoCommitError("index-entry-invalid");
    return { mode: match[1], blob: match[2].toLowerCase(), path: match[3] };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

async function readRefGuard(root) {
  const [branch, head] = await Promise.all([
    execGit(root, ["symbolic-ref", "-q", "HEAD"], { optionalLocks: false })
      .then(({ stdout }) => stdout.trim()),
    readHead(root),
  ]);
  return { branchRef: branch, head };
}

async function readHead(root) {
  return execGit(root, ["rev-parse", "--verify", "HEAD"], { optionalLocks: false })
    .then(({ stdout }) => stdout.trim() || null)
    .catch(() => null);
}

async function readIndexTree(root) {
  return execGit(root, ["write-tree"], { optionalLocks: false })
    .then(({ stdout }) => stdout.trim())
    .catch(async () => {
      let cached = EMPTY_TREE_OID_BY_LENGTH.get(40);
      if (!cached) {
        cached = (await execGit(root, ["mktree"], { input: "" })).stdout.trim();
        EMPTY_TREE_OID_BY_LENGTH.set(cached.length, cached);
      }
      return cached;
    });
}

async function readConfig(root, key) {
  return execGit(root, ["config", "--get", key], { optionalLocks: false })
    .then(({ stdout }) => stdout.trim())
    .catch(() => "");
}

async function readBooleanConfig(root, key) {
  return execGit(root, ["config", "--bool", "--get", key], { optionalLocks: false })
    .then(({ stdout }) => stdout.trim() === "true")
    .catch(() => false);
}

async function hasInProgressOperation(identity) {
  const markers = [
    path.join(identity.gitDir, "MERGE_HEAD"),
    path.join(identity.gitDir, "CHERRY_PICK_HEAD"),
    path.join(identity.gitDir, "REVERT_HEAD"),
    path.join(identity.gitDir, "rebase-merge"),
    path.join(identity.gitDir, "rebase-apply"),
  ];
  return (await Promise.all(markers.map((marker) => fs.lstat(marker).then(() => true).catch(() => false))))
    .some(Boolean);
}

async function isInsideNestedRepository(root, absoluteFilePath, cache) {
  let directory = path.dirname(absoluteFilePath);
  const boundary = path.resolve(root);
  while (directory !== boundary && directory.startsWith(`${boundary}${path.sep}`)) {
    if (!cache.has(directory)) {
      cache.set(directory, await fs.lstat(path.join(directory, ".git"))
        .then(() => true)
        .catch(() => false));
    }
    if (cache.get(directory)) return true;
    directory = path.dirname(directory);
  }
  return false;
}

async function containsGitAdministrativeEntry(directory) {
  return fs.lstat(path.join(directory, ".git"))
    .then(() => true)
    .catch(() => false);
}

function isSensitivePath(relativePath) {
  const segments = relativePath.toLowerCase().split("/");
  const basename = segments.at(-1) ?? "";
  return basename === ".env"
    || basename.startsWith(".env.")
    || ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", ".git-credentials", ".npmrc", ".pypirc"]
      .includes(basename)
    || basename === "credentials.json"
    || basename === "credentials"
    || basename === "secrets.json"
    || basename === "secrets.yaml"
    || basename === "secrets.yml"
    || basename.endsWith(".pem")
    || basename.endsWith(".key")
    || basename.endsWith(".p12")
    || basename.endsWith(".pfx")
    || basename.endsWith(".kdbx")
    || segments.some((segment) => [".ssh", ".aws", ".gnupg"].includes(segment));
}

function isStagedEntry(entry) {
  return Boolean(entry.staged && entry.staged !== "?" && entry.staged !== ".");
}

function sameIndexEntries(left, right) {
  const normalize = (entries) => entries
    .map(({ path: entryPath, mode, blob }) => `${entryPath}\0${mode}\0${blob}`)
    .sort();
  return samePaths(normalize(left), normalize(right));
}

function samePaths(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function boundedInteger(value, minimum, maximum, fallback) {
  return Number.isSafeInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function requireIdentity(identity, root) {
  const authorizedRoot = path.resolve(root);
  const matchesWorkspace = [identity?.workspaceRoot, identity?.topLevel]
    .filter(Boolean)
    .some((candidate) => path.resolve(candidate) === authorizedRoot);
  if (!identity?.repository || !matchesWorkspace) {
    throw new Error("Git Auto Commit requires the authorized worktree identity.");
  }
  return identity;
}

function requireJournal(journal) {
  if (!journal || ["read", "resolvePaths", "create", "update", "clear"].some((key) => (
    typeof journal[key] !== "function"
  ))) {
    throw new TypeError("Git Auto Commit requires a durable transaction journal.");
  }
  return journal;
}

function removeTemporaryIndex(filePath) {
  return fs.rm(filePath, { force: true });
}

function blocked(reason, retryable) {
  return { ok: false, reason, retryable };
}

function result(outcome, reason, extra = {}) {
  return Object.freeze({
    outcome,
    reason,
    commitId: extra.commitId ?? null,
    pathCount: extra.pathCount ?? null,
    retryable: extra.retryable === true,
  });
}

function createAutoCommitError(reason) {
  const error = new Error(`Git Auto Commit transaction failed: ${reason}`);
  error.autoCommitReason = reason;
  return error;
}

function classifyTransactionFailure(error) {
  if (typeof error?.autoCommitReason === "string") return error.autoCommitReason;
  if (error?.code === "ETIMEDOUT" || error?.killed === true) {
    return Array.isArray(error?.gitArgs) && error.gitArgs.includes("commit")
      ? "hook-timeout"
      : "git-operation-timeout";
  }
  const output = `${error?.stderr ?? ""}\n${error?.message ?? ""}`.toLowerCase();
  if (output.includes("hook") || output.includes("pre-commit") || output.includes("commit-msg")) {
    return "hook-rejected";
  }
  if (output.includes("sign") || output.includes("gpg")) return "commit-signing-required";
  if (Array.isArray(error?.gitArgs) && error.gitArgs.includes("commit")) return "commit-rejected";
  return "git-commit-failed";
}
