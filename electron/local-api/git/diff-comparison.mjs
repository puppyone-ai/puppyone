import { execGit, execGitStreaming } from "./runner.mjs";
import { gitStatusLabelToLetter } from "./source-control-model.mjs";

const GIT_EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const GIT_PREVIEW_MAX_BYTES = 256 * 1024;
const GIT_SUMMARY_MAX_BYTES = 4 * 1024 * 1024;
const VALID_PREVIEW_GROUPS = new Set(["remote", "committed"]);

/**
 * Resolves both sides of the remote comparison from one repository snapshot.
 * Callers use these exact ranges for both the sidebar preview and the opened
 * patch so a file cannot be labelled from commit-log history and rendered from
 * a different aggregate diff.
 */
export async function resolveGitRemoteDiffComparisons(
  rootPath,
  remoteRef,
  { signal, hasHead: hasHeadHint } = {},
) {
  const hasHead = typeof hasHeadHint === "boolean"
    ? hasHeadHint
    : await execGit(rootPath, ["rev-parse", "--verify", "--quiet", "HEAD"], { signal })
      .then((result) => Boolean(result.stdout.trim()))
      .catch(() => {
        throwIfAborted(signal);
        return false;
      });

  if (!hasHead) {
    return {
      incoming: createComparison("incoming", GIT_EMPTY_TREE, remoteRef, "empty-tree"),
      outgoing: createComparison("outgoing", remoteRef, GIT_EMPTY_TREE, "empty-tree"),
    };
  }

  const mergeBase = await execGit(rootPath, ["merge-base", "HEAD", remoteRef], { signal })
    .then((result) => result.stdout.trim())
    .catch(() => {
      throwIfAborted(signal);
      return "";
    });

  if (mergeBase) {
    return {
      incoming: createComparison("incoming", mergeBase, remoteRef, "merge-base"),
      outgoing: createComparison("outgoing", mergeBase, "HEAD", "merge-base"),
    };
  }

  return {
    incoming: createComparison("incoming", "HEAD", remoteRef, "direct"),
    outgoing: createComparison("outgoing", remoteRef, "HEAD", "direct"),
  };
}

/**
 * Reads the net files for a trusted comparison range. `git diff` is
 * intentional: `git log --name-status` reports how a path changed in each
 * commit, not its final status across the selected range.
 */
export async function readGitComparisonPreview(
  rootPath,
  comparison,
  group,
  { signal, limit = 12 } = {},
) {
  if (!VALID_PREVIEW_GROUPS.has(group)) {
    throw new TypeError(`Unsupported Git comparison preview group: ${String(group)}`);
  }
  if (!comparison?.range) {
    throw new TypeError("A trusted Git comparison range is required.");
  }

  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 12;
  const result = await execGitStreaming(rootPath, [
    "diff",
    "--name-status",
    "-z",
    "--find-renames",
    "--no-ext-diff",
    comparison.range,
  ], {
    optionalLocks: false,
    signal,
    maxBytes: GIT_PREVIEW_MAX_BYTES,
    // A rename/copy consumes three NUL-delimited records. Leave a small
    // margin so the final requested file can be parsed as a complete tuple.
    recordLimit: (normalizedLimit * 3) + 3,
  }).catch(() => {
    throwIfAborted(signal);
    return { stdout: "" };
  });

  return parseGitNameStatusPreview(result.stdout, group, normalizedLimit);
}

export function parseGitNameStatusPreview(output, group, limit = 12) {
  if (!VALID_PREVIEW_GROUPS.has(group)) {
    throw new TypeError(`Unsupported Git comparison preview group: ${String(group)}`);
  }

  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 12;
  const tokens = String(output ?? "").split("\0").filter(Boolean);
  const resources = [];

  for (let index = 0; index < tokens.length && resources.length < normalizedLimit; index += 1) {
    const code = tokens[index] ?? "";
    const statusCode = code[0] ?? "";
    if (!statusCode) continue;

    if (statusCode === "R" || statusCode === "C") {
      const oldPath = tokens[index + 1] ?? null;
      const nextPath = tokens[index + 2] ?? null;
      index += 2;
      if (oldPath && nextPath) {
        resources.push(buildGitPreviewResource({
          path: nextPath,
          oldPath,
          status: statusCode === "R" ? "renamed" : "copied",
          group,
        }));
      }
      continue;
    }

    const filePath = tokens[index + 1] ?? null;
    index += 1;
    if (!filePath) continue;
    resources.push(buildGitPreviewResource({
      path: filePath,
      oldPath: null,
      status: gitNameStatusCodeToLabel(statusCode),
      group,
    }));
  }

  return resources;
}

/** Reads aggregate file-status totals without loading names into the UI model. */
export async function readGitComparisonFileSummary(rootPath, comparison, { signal } = {}) {
  if (!comparison?.range) {
    throw new TypeError("A trusted Git comparison range is required.");
  }

  const result = await execGitStreaming(rootPath, [
    "diff",
    "--name-status",
    "-z",
    "--find-renames",
    "--no-ext-diff",
    comparison.range,
  ], {
    optionalLocks: false,
    signal,
    maxBytes: GIT_SUMMARY_MAX_BYTES,
  }).catch(() => {
    throwIfAborted(signal);
    return { stdout: "" };
  });

  return parseGitComparisonFileSummary(result.stdout);
}

export function parseGitComparisonFileSummary(output) {
  const summary = {
    total: 0,
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    changed: 0,
  };
  const tokens = String(output ?? "").split("\0").filter(Boolean);

  for (let index = 0; index < tokens.length; index += 1) {
    const statusCode = tokens[index]?.[0] ?? "";
    if (!statusCode) continue;
    if (statusCode === "R" || statusCode === "C") {
      if (!tokens[index + 1] || !tokens[index + 2]) break;
      index += 2;
    } else {
      if (!tokens[index + 1]) break;
      index += 1;
    }

    const status = gitNameStatusCodeToLabel(statusCode);
    summary.total += 1;
    summary[status] += 1;
  }

  return summary;
}

function createComparison(direction, beforeRef, afterRef, strategy) {
  return {
    direction,
    strategy,
    beforeRef,
    afterRef,
    range: `${beforeRef}..${afterRef}`,
  };
}

function buildGitPreviewResource({ path, oldPath, status, group }) {
  return {
    id: `${group}:${oldPath ?? ""}:${path}:${status}`,
    group: "workingTree",
    path,
    oldPath: oldPath ?? null,
    status,
    staged: false,
    conflict: false,
    letter: gitStatusLabelToLetter(status),
  };
}

function gitNameStatusCodeToLabel(statusCode) {
  if (statusCode === "A") return "added";
  if (statusCode === "D") return "deleted";
  if (statusCode === "R") return "renamed";
  if (statusCode === "C") return "copied";
  if (statusCode === "M") return "modified";
  return "changed";
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Git comparison request was cancelled.");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  throw error;
}
