import {
  GIT_MUTATION_TIMEOUT_MS,
  GIT_NETWORK_TIMEOUT_MS,
  execGit,
  execGitBuffer,
} from "../../local-api/git/runner.mjs";
import { getWorkspaceGitStatus } from "../../local-api/workspace.mjs";
import {
  CLOUD_DESTINATION_REF,
  CLOUD_DESTINATION_BRANCH,
  CLOUD_REMOTE_NAME,
  COMMIT_ID_PATTERN,
  createPublishError,
  isSimulatedCrash,
} from "./cloud-publish-contract.mjs";
import { resolveSourceBranchCommit } from "./cloud-initialization/attempts/source-ref.mjs";
import {
  CLOUD_INITIAL_PUSH_TIMEOUT_MS,
  CLOUD_PUSH_RECONCILE_DELAYS_MS,
  isUncertainPushFailure,
  pushFailureMessage,
  reconcileExpectedRemoteHead,
  remoteConfigFailureMessage,
  reportCloudPublishProgress,
  waitForCloudPublishReconciliation,
} from "./cloud-publish-git-reconciliation.mjs";

const LFS_POINTER_PREAMBLE = "version https://git-lfs.github.com/spec/v1";
const LFS_POINTER_MAX_BYTES = 512;

export { CLOUD_INITIAL_PUSH_TIMEOUT_MS, CLOUD_PUSH_RECONCILE_DELAYS_MS };

export function createCloudPublishGitService({
  execGitCommand = execGit,
  execGitBufferCommand = execGitBuffer,
  getGitStatus = getWorkspaceGitStatus,
  gitCredentialManager,
  injectFault = async () => undefined,
  wait = waitForCloudPublishReconciliation,
} = {}) {
  if (
    !gitCredentialManager?.prepare
    || !gitCredentialManager?.approve
    || !gitCredentialManager?.assertManaged
    || !gitCredentialManager?.cleanupManaged
    || !gitCredentialManager?.commandArgs
  ) {
    throw new TypeError("Cloud publish Git service requires a credential manager.");
  }

  const inspectRemote = (rootPath) => inspectCloudRemote(rootPath, execGitCommand);
  const assertAttemptCommit = (rootPath, record) => (
    assertAttemptCommitExists(rootPath, record, execGitCommand)
  );
  const assertExactRemote = (rootPath, url) => (
    assertExactCanonicalRemote(rootPath, url, execGitCommand)
  );

  async function assertNoRemote(rootPath) {
    const names = await readRemoteNames(rootPath, execGitCommand);
    if (names.some((name) => name.toLowerCase() === CLOUD_REMOTE_NAME)) {
      throw createPublishError(
        "REMOTE_CONFLICT",
        "A Git remote named 'puppyone' already exists. Rename or remove it before publishing.",
        false,
      );
    }
  }

  async function assertResumeRemote(rootPath, record) {
    const remote = await inspectRemote(rootPath);
    if (remote.kind === "missing") return;
    if (
      record.canonical_remote_url
      && remote.kind === "exact"
      && remote.url === record.canonical_remote_url
    ) return;
    throw createPublishError(
      "REMOTE_CONFLICT",
      "The pending publish operation found a conflicting 'puppyone' Git remote.",
      false,
    );
  }

  async function configureRemote(rootPath, record, secret, verifyExpectedIdentity) {
    assertCredentialRecordComplete(record);
    if (verifyExpectedIdentity) await assertAttemptCommit(rootPath, record);
    const remote = await inspectRemote(rootPath);
    if (
      remote.kind !== "missing"
      && !(
        record.remote_add_intent
        && remote.kind === "exact"
        && remote.url === record.canonical_remote_url
      )
    ) {
      throw createPublishError(
        "REMOTE_CONFLICT",
        "A Git remote named 'puppyone' already exists with a different canonical URL.",
        false,
      );
    }

    let approval = null;
    let failureStage = "storing the Git credential";
    try {
      approval = await gitCredentialManager.approve(
        rootPath,
        record.canonical_remote_url,
        record.credential_username,
        secret,
        record.operation_id,
        record.credential_config_snapshot,
      );
      let created = false;
      if (remote.kind === "missing") {
        failureStage = "creating the local Cloud remote";
        await execGitCommand(rootPath, ["remote", "add", CLOUD_REMOTE_NAME, record.canonical_remote_url], {
          timeout: GIT_MUTATION_TIMEOUT_MS,
        });
        created = true;
        await injectFault("after-remote-add", record);
      }
      failureStage = "re-checking the repository identity";
      if (verifyExpectedIdentity) await assertAttemptCommit(rootPath, record);
      failureStage = "verifying the local Cloud remote";
      await assertExactRemote(rootPath, record.canonical_remote_url);
      await injectFault("after-canonical-remote-verified", record);
      // Use the journaled URL literal for every network side effect. Another
      // Git process can mutate the remote name after our verification.
      failureStage = "verifying Cloud Git access";
      await execGitCommand(rootPath, secureArgs(record, [
        "ls-remote", "--refs", record.canonical_remote_url,
      ]), {
        timeout: GIT_NETWORK_TIMEOUT_MS,
      });
      failureStage = "verifying the managed credential configuration";
      await assertManagedCredentialConfig(rootPath, record);
      return created;
    } catch (error) {
      if (isSimulatedCrash(error)) throw error;
      await approval?.rollback?.().catch(() => undefined);
      if (error?.publishCode) throw error;
      throw createPublishError(
        "REMOTE_CONFIG_FAILED",
        remoteConfigFailureMessage(failureStage, error),
        true,
        error,
      );
    }
  }

  async function assertRemoteAddIntent(rootPath, record, verifyExpectedIdentity) {
    assertCredentialRecordComplete(record);
    if (verifyExpectedIdentity) await assertAttemptCommit(rootPath, record);
    const remote = await inspectRemote(rootPath);
    if (remote.kind === "missing") return;
    throw createPublishError(
      "REMOTE_CONFLICT",
      "The canonical 'puppyone' remote appeared before this operation could claim it.",
      false,
    );
  }

  async function pushExpectedCommit(rootPath, record, secret, onProgress = null) {
    assertCredentialRecordComplete(record);
    await assertAttemptCommit(rootPath, record);
    await assertExactRemote(rootPath, record.canonical_remote_url);
    const attemptCommitOid = record.attempt?.commit_oid;
    let approval = null;
    try {
      approval = await gitCredentialManager.approve(
        rootPath,
        record.canonical_remote_url,
        record.credential_username,
        secret,
        record.operation_id,
        record.credential_config_snapshot,
      );
      reportCloudPublishProgress(onProgress, "checking-remote");
      let remoteHead = await readRemoteMain(rootPath, record, execGitCommand, secureArgs);
      if (remoteHead && remoteHead !== attemptCommitOid) {
        throw createPublishError(
          "REMOTE_REF_CONFLICT",
          "The Cloud Project main branch already points to a different commit.",
          false,
        );
      }
      if (!remoteHead) {
        try {
          await injectFault("after-push-remote-verified", record);
          reportCloudPublishProgress(onProgress, "uploading");
          await execGitCommand(rootPath, secureArgs(record, [
            "push",
            `--force-with-lease=${CLOUD_DESTINATION_REF}:`,
            record.canonical_remote_url,
            `${attemptCommitOid}:${CLOUD_DESTINATION_REF}`,
          ]), { timeout: CLOUD_INITIAL_PUSH_TIMEOUT_MS });
          await injectFault("after-push-side-effect", record);
          reportCloudPublishProgress(onProgress, "confirming");
        } catch (error) {
          if (isSimulatedCrash(error)) throw error;
          remoteHead = await readRemoteMain(rootPath, record, execGitCommand, secureArgs).catch(() => null);
          if (
            remoteHead !== attemptCommitOid
            && isUncertainPushFailure(error)
          ) {
            reportCloudPublishProgress(onProgress, "confirming");
            remoteHead = await reconcileExpectedRemoteHead({
              expectedHeadCommitId: attemptCommitOid,
              readRemoteHead: () => readRemoteMain(rootPath, record, execGitCommand, secureArgs),
              wait,
            });
          }
          if (remoteHead && remoteHead !== attemptCommitOid) {
            throw createPublishError(
              "REMOTE_REF_CONFLICT",
              "Cloud main changed while the initial push was in flight.",
              false,
              error,
            );
          }
          if (remoteHead !== attemptCommitOid && isUncertainPushFailure(error)) {
            throw createPublishError(
              "PUSH_UNCERTAIN",
              "The initial push result is uncertain. Reconcile Cloud main before retrying.",
              true,
              error,
            );
          }
          if (remoteHead !== attemptCommitOid) throw error;
        }
      }
      remoteHead = remoteHead ?? await readRemoteMain(rootPath, record, execGitCommand, secureArgs);
      if (remoteHead !== attemptCommitOid) {
        throw createPublishError(
          "PUSH_FAILED",
          "The Cloud Project did not confirm the expected initial commit.",
          true,
        );
      }
      await injectFault("after-push-reconciled", record);
      await assertManagedCredentialConfig(rootPath, record);
      reportCloudPublishProgress(onProgress, "finalizing");
      return { remoteHead };
    } catch (error) {
      if (isSimulatedCrash(error)) throw error;
      await approval?.rollback?.().catch(() => undefined);
      if (error?.publishCode) throw error;
      throw createPublishError(
        "PUSH_FAILED",
        pushFailureMessage(error),
        true,
        error,
      );
    }
  }

  async function finalizeUpstreamAndStatus(rootPath, record) {
    await assertManagedCredentialConfig(rootPath, record);
    await assertAttemptCommit(rootPath, record);
    await assertExactRemote(rootPath, record.canonical_remote_url);
    const remoteHead = await readRemoteMain(rootPath, record, execGitCommand, secureArgs);
    if (remoteHead !== record.attempt?.commit_oid) {
      throw createPublishError("PUSH_FAILED", "The Cloud main branch no longer matches the expected commit.", false);
    }
    await execGitCommand(rootPath, [
      "update-ref",
      `refs/remotes/${CLOUD_REMOTE_NAME}/${CLOUD_DESTINATION_BRANCH}`,
      record.attempt.commit_oid,
    ], { timeout: GIT_MUTATION_TIMEOUT_MS });
    await execGitCommand(rootPath, [
      "branch",
      `--set-upstream-to=${CLOUD_REMOTE_NAME}/${CLOUD_DESTINATION_BRANCH}`,
      record.selected_source_branch,
    ], { timeout: GIT_MUTATION_TIMEOUT_MS });
    await injectFault("after-upstream-configured", record);
    return getGitStatus(rootPath);
  }

  async function cleanupAfterServerAbandon(rootPath, record) {
    if (
      record.credential_config_snapshot
      && record.canonical_remote_url
      && record.credential_username
    ) {
      await gitCredentialManager.cleanupManaged(
        rootPath,
        record.canonical_remote_url,
        record.credential_username,
        record.operation_id,
        record.credential_config_snapshot,
      );
    }
    const remote = await inspectRemote(rootPath);
    if (
      (record.remote_add_intent || record.remote_created_by_operation)
      && remote.kind === "exact"
      && remote.url === record.canonical_remote_url
    ) {
      await execGitCommand(rootPath, ["remote", "remove", CLOUD_REMOTE_NAME], {
        timeout: GIT_MUTATION_TIMEOUT_MS,
      });
      await injectFault("after-abandon-remote-removed", record);
    }
  }

  async function inspectRemoteHead(rootPath, record, secret, requireExactLocalRemote) {
    assertCredentialRecordComplete(record);
    if (requireExactLocalRemote) await assertExactRemote(rootPath, record.canonical_remote_url);
    const approval = await gitCredentialManager.approve(
      rootPath,
      record.canonical_remote_url,
      record.credential_username,
      secret,
      record.operation_id,
      record.credential_config_snapshot,
    );
    try {
      return await readRemoteMain(rootPath, record, execGitCommand, secureArgs);
    } catch (error) {
      await approval?.rollback?.().catch(() => undefined);
      throw error;
    }
  }

  function secureArgs(record, args) {
    return gitCredentialManager.commandArgs(
      record.canonical_remote_url,
      record.credential_config_snapshot,
      args,
    );
  }

  function assertManagedCredentialConfig(rootPath, record) {
    return gitCredentialManager.assertManaged(
      rootPath,
      record.canonical_remote_url,
      record.operation_id,
      record.credential_config_snapshot,
    );
  }

  return {
    assertNoRemote,
    assertResumeRemote,
    assertCanonicalRemoteAddIntent: (rootPath, record) => assertRemoteAddIntent(rootPath, record, true),
    assertExistingRemoteAddIntent: (rootPath, record) => assertRemoteAddIntent(rootPath, record, false),
    inspectRemote,
    prepareCredentialConfig: (rootPath, record) => gitCredentialManager.prepare(
      rootPath,
      record.canonical_remote_url,
      record.operation_id,
    ),
    preflight: (rootPath, commitId) => assertVersionEnginePreflight(rootPath, commitId, {
      execGitCommand,
      execGitBufferCommand,
    }),
    configureCanonicalRemote: (rootPath, record, secret) => configureRemote(rootPath, record, secret, true),
    configureExistingProjectRemote: (rootPath, record, secret) => configureRemote(rootPath, record, secret, false),
    inspectCanonicalRemoteHead: (rootPath, record, secret) => (
      inspectRemoteHead(rootPath, record, secret, true)
    ),
    inspectJournaledRemoteHead: (rootPath, record, secret) => (
      inspectRemoteHead(rootPath, record, secret, false)
    ),
    resolveSourceCommit: (rootPath, sourceBranch) => resolveSourceBranchCommit(
      rootPath,
      sourceBranch,
      execGitCommand,
    ),
    pushExpectedCommit,
    finalizeUpstreamAndStatus,
    cleanupAfterServerAbandon,
  };
}

export async function inspectCloudRemote(rootPath, execGitCommand = execGit) {
  const names = await readRemoteNames(rootPath, execGitCommand);
  const collisions = names.filter((name) => name.toLowerCase() === CLOUD_REMOTE_NAME);
  if (collisions.length === 0) return { kind: "missing", url: null };
  if (collisions.length !== 1 || collisions[0] !== CLOUD_REMOTE_NAME) {
    return { kind: "conflict", url: null };
  }
  const [fetchUrls, pushUrls] = await Promise.all([
    readRemoteUrls(rootPath, execGitCommand, false),
    readRemoteUrls(rootPath, execGitCommand, true),
  ]);
  if (fetchUrls.length !== 1 || pushUrls.length !== 1 || fetchUrls[0] !== pushUrls[0]) {
    return { kind: "conflict", url: null };
  }
  return { kind: "exact", url: fetchUrls[0] };
}

export async function assertVersionEnginePreflight(rootPath, expectedCommitId, {
  execGitCommand = execGit,
  execGitBufferCommand = execGitBuffer,
} = {}) {
  const parentLine = await execGitCommand(rootPath, ["rev-list", "--parents", "-n", "1", expectedCommitId], {
    optionalLocks: false,
  }).then(({ stdout }) => stdout.trim()).catch((error) => {
    throw createPublishError("COMMIT_REQUIRED", "Unable to inspect the expected Git commit.", false, error);
  });
  if (parentLine.split(/\s+/).filter(Boolean).length > 2) {
    throw createPublishError(
      "MERGE_TIP_UNSUPPORTED",
      "The current merge commit cannot be the initial Puppyone Cloud tip. Publish a linearized tip.",
      false,
    );
  }

  let matches;
  try {
    const result = await execGitBufferCommand(rootPath, [
      "grep", "-z", "-l", "--full-name", "-e",
      `^${LFS_POINTER_PREAMBLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      expectedCommitId, "--",
    ], { maxBuffer: 8 * 1024 * 1024, optionalLocks: false });
    matches = result.stdout;
  } catch (error) {
    if (Number(error?.code) === 1) return;
    throw createPublishError("LFS_UNSUPPORTED", "Unable to complete the Git LFS preflight.", false, error);
  }
  const prefix = Buffer.from(`${expectedCommitId}:`);
  for (const entry of splitNulBuffer(matches)) {
    const pathBytes = entry.subarray(0, prefix.length).equals(prefix) ? entry.subarray(prefix.length) : entry;
    const objectSpec = `${expectedCommitId}:${pathBytes.toString("utf8")}`;
    const size = await execGitCommand(rootPath, ["cat-file", "-s", objectSpec], { optionalLocks: false })
      .then(({ stdout }) => Number.parseInt(stdout.trim(), 10)).catch(() => Number.NaN);
    if (!Number.isFinite(size) || size > LFS_POINTER_MAX_BYTES) continue;
    const body = await execGitBufferCommand(rootPath, ["cat-file", "blob", objectSpec], {
      maxBuffer: LFS_POINTER_MAX_BYTES + 1,
      optionalLocks: false,
    }).then(({ stdout }) => stdout.toString("utf8")).catch(() => "");
    if (
      body.startsWith(`${LFS_POINTER_PREAMBLE}\n`)
      && /\noid sha256:[0-9a-f]{64}\n/i.test(`\n${body}`)
      && /\nsize \d+(?:\n|$)/.test(`\n${body}`)
    ) {
      throw createPublishError(
        "LFS_UNSUPPORTED",
        "Git LFS pointer files are not supported by the Puppyone Cloud repository engine.",
        false,
      );
    }
  }
}

async function assertAttemptCommitExists(rootPath, record, execGitCommand) {
  const commitOid = record.attempt?.commit_oid;
  if (!COMMIT_ID_PATTERN.test(commitOid ?? "")) {
    throw createPublishError("COMMIT_REQUIRED", "Cloud push attempt has no valid commit.", false);
  }
  await execGitCommand(rootPath, ["cat-file", "-e", `${commitOid}^{commit}`], {
    optionalLocks: false,
  }).catch((error) => {
    throw createPublishError("COMMIT_REQUIRED", "The selected push commit is no longer available locally.", false, error);
  });
}

async function assertExactCanonicalRemote(rootPath, canonicalUrl, execGitCommand) {
  const remote = await inspectCloudRemote(rootPath, execGitCommand);
  if (remote.kind !== "exact" || remote.url !== canonicalUrl) {
    throw createPublishError("REMOTE_CONFLICT", "Canonical PuppyOne Git remote changed during publish.", false);
  }
}

async function readRemoteMain(rootPath, record, execGitCommand, secureArgs) {
  const { stdout } = await execGitCommand(rootPath, secureArgs(record, [
    "ls-remote",
    "--refs",
    record.canonical_remote_url,
    `refs/heads/${CLOUD_DESTINATION_BRANCH}`,
  ]), { timeout: GIT_NETWORK_TIMEOUT_MS });
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  if (lines.length !== 1) throw createPublishError("PUSH_FAILED", "Cloud main ref response is ambiguous.", false);
  const [commitId, ref] = lines[0].split(/\s+/);
  if (!COMMIT_ID_PATTERN.test(commitId) || ref !== `refs/heads/${CLOUD_DESTINATION_BRANCH}`) {
    throw createPublishError("PUSH_FAILED", "Cloud main ref response is invalid.", false);
  }
  return commitId.toLowerCase();
}

async function readRemoteNames(rootPath, execGitCommand) {
  return execGitCommand(rootPath, ["remote"], { optionalLocks: false })
    .then(({ stdout }) => stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean));
}

async function readRemoteUrls(rootPath, execGitCommand, push) {
  return execGitCommand(rootPath, ["remote", "get-url", ...(push ? ["--push"] : []), "--all", CLOUD_REMOTE_NAME], {
    optionalLocks: false,
  }).then(({ stdout }) => stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean));
}

function assertCredentialRecordComplete(record) {
  if (
    !record.project_id
    || !record.credential_id
    || !record.canonical_remote_url
    || !record.credential_username
    || !record.credential_config_snapshot
  ) {
    throw createPublishError("CREDENTIAL_FAILED", "Pending credential state is incomplete.", false);
  }
}

function splitNulBuffer(buffer) {
  const result = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    if (index > start) result.push(buffer.subarray(start, index));
    start = index + 1;
  }
  if (start < buffer.length) result.push(buffer.subarray(start));
  return result;
}
