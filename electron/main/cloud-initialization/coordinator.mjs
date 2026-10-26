import crypto from "node:crypto";
import fs from "node:fs";
import { getWorkspaceGitStatus, resolveGitRepositoryIdentity } from "../../../local-api/workspace.mjs";
import { execGit, execGitBuffer } from "../../../local-api/git/runner.mjs";
import { normalizeCloudApiBaseUrl } from "../../../shared/cloudEndpoint.js";
import { createCloudPublishApi } from "../cloud-publish-api.mjs";
import { createCloudGitConnectJournal } from "../cloud-git-connect-journal.mjs";
import { createCloudPublishGitCredentialManager } from "../cloud-publish-git-credentials.mjs";
import { createCloudPublishGitService } from "../cloud-publish-git.mjs";
import { createCloudPublishJournal } from "../cloud-publish-journal.mjs";
import { createCloudPublishProgressChannel } from "../cloud-publish-progress.mjs";
import { createCloudGitOperationLease } from "../cloud-git-operation-lease.mjs";
import { createGitOperationCoordinator, repositoryLockKey } from "../git-operation-coordinator.mjs";
import {
  assertFreshPublishStatus,
  assertJournalReadIdentity,
  assertJournalStartIdentity,
  createInitialRecord,
  createPublishError,
  failureResult,
  isProjectUnavailable,
  isSimulatedCrash,
  normalizeCleanupRequest,
  normalizeReadRequest,
  normalizeStartRequest,
  refreshRepositoryContext,
  requestFingerprint,
  resolveRepositoryContext,
  successResult,
  toStoredError,
} from "./contract.mjs";
import { archiveAttempt, createPushAttempt } from "./attempts/source-ref.mjs";
import { deriveCloudInitializationState } from "./state-derivation.mjs";
import { createCloudInitializationTelemetry } from "./telemetry.mjs";

/** Main-owned Cloud Project + immutable Git push-attempt coordinator. */
export function createCloudPublishCoordinator({
  cloudAuthService,
  secretVault,
  journal = null,
  connectJournal = null,
  operationLease = null,
  gitOperationCoordinator = createGitOperationCoordinator(),
  gitCredentialManager = createCloudPublishGitCredentialManager(),
  execGitCommand = execGit,
  execGitBufferCommand = execGitBuffer,
  getGitStatus = getWorkspaceGitStatus,
  resolveRepositoryIdentity = resolveGitRepositoryIdentity,
  fsApi = fs.promises,
  randomUUID = crypto.randomUUID,
  randomBytes = crypto.randomBytes,
  now = () => Date.now(),
  faultInjector = async () => undefined,
  validateRemoteUrl,
  configuredGitOrigin = process.env.VITE_DESKTOP_CLOUD_GIT_ORIGIN ?? null,
  telemetry = null,
  logger = {},
} = {}) {
  if (!cloudAuthService?.readSession || !cloudAuthService?.requestSessionApi) {
    throw new TypeError("Cloud initialization coordinator requires cloudAuthService.");
  }
  if (!secretVault?.createRef || !secretVault?.put || !secretVault?.get || !secretVault?.clear) {
    throw new TypeError("Cloud initialization coordinator requires a main-only SecretVault.");
  }

  const durableJournal = journal ?? createCloudPublishJournal({ fsApi, now, resolveRepositoryIdentity });
  const otherJournal = connectJournal ?? createCloudGitConnectJournal({ fsApi, now, resolveRepositoryIdentity });
  const leaseService = operationLease ?? createCloudGitOperationLease({ fsApi, now, resolveRepositoryIdentity });
  const cloudApi = createCloudPublishApi({
    cloudAuthService,
    ...(validateRemoteUrl ? { validateRemoteUrl } : {}),
    configuredGitOrigin,
  });
  const gitService = createCloudPublishGitService({
    execGitCommand,
    execGitBufferCommand,
    getGitStatus,
    gitCredentialManager,
    injectFault,
  });
  const events = telemetry ?? createCloudInitializationTelemetry({ logger, now });
  const inflight = new Map();
  const contextOptions = { resolveRepositoryIdentity, fsApi };
  const resolveContext = (rootPath) => resolveRepositoryContext(rootPath, contextOptions);
  const refreshContext = (rootPath, initial) => refreshRepositoryContext(rootPath, initial, contextOptions);

  async function withOperationLease(rootPath, operation) {
    const lease = await leaseService.acquire(rootPath);
    try {
      return await operation();
    } finally {
      await lease.release();
    }
  }

  async function assertActiveSession(base, record = null) {
    const session = await cloudAuthService.readSession();
    const sessionApiBase = normalizeCloudApiBaseUrl(session?.api_base_url);
    if (
      !session
      || typeof session.user_id !== "string"
      || session.user_id !== base.userId
      || sessionApiBase !== base.apiBaseUrl
      || (record && (record.user_id !== session.user_id || record.api_base_url !== sessionApiBase))
    ) {
      throw createPublishError(
        "SESSION_REQUIRED",
        "Sign in with the Puppyone Cloud account that owns this initialization.",
        true,
      );
    }
    return session;
  }

  async function getState(request = {}) {
    try {
      const base = normalizeReadRequest(request);
      const context = await resolveContext(base.rootPath);
      await gitOperationCoordinator.whenIdle(repositoryLockKey(context.identity.commonDir));
      return await withOperationLease(base.rootPath, () => readStateUnderLock(base, context));
    } catch (error) {
      if (isSimulatedCrash(error)) throw error;
      return failureResult(error, null);
    }
  }

  async function startOrResume(request = {}, { onProgress = null } = {}) {
    let base;
    let context;
    try {
      base = normalizeStartRequest(request);
      context = await resolveContext(base.rootPath);
    } catch (error) {
      return failureResult(error, null);
    }
    const key = context.identity.gitDir;
    const fingerprint = requestFingerprint(base);
    const active = inflight.get(key);
    if (active) {
      if (active.fingerprint === fingerprint) {
        active.progress.add(onProgress);
        return active.promise;
      }
      return failureResult(createPublishError(
        "IDENTITY_MISMATCH",
        "A different Cloud initialization action is already running for this repository.",
        false,
      ), null);
    }
    const progress = createCloudPublishProgressChannel({ rootPath: base.rootPath, now, onProgress });
    const operation = { fingerprint, progress, promise: null };
    progress.report("validating");
    const promise = gitOperationCoordinator.run(
      repositoryLockKey(context.identity.commonDir),
      () => withOperationLease(base.rootPath, () => runInitializeUnderLock(base, context, progress.report)),
    ).catch((error) => {
      if (isSimulatedCrash(error)) throw error;
      return failureResult(error, null);
    }).finally(() => {
      if (inflight.get(key)?.promise === promise) inflight.delete(key);
    });
    operation.promise = promise;
    inflight.set(key, operation);
    return promise;
  }

  async function cleanup(request = {}) {
    let base;
    let context;
    try {
      base = normalizeCleanupRequest(request);
      context = await resolveContext(base.rootPath);
    } catch (error) {
      return failureResult(error, null);
    }
    if (inflight.has(context.identity.gitDir)) {
      return failureResult(createPublishError(
        "CLEANUP_FAILED",
        "Wait for the current Cloud initialization action to finish.",
        true,
      ), null);
    }
    return gitOperationCoordinator.run(
      repositoryLockKey(context.identity.commonDir),
      () => withOperationLease(base.rootPath, () => runCleanupUnderLock(base, context)),
    ).catch((error) => {
      if (isSimulatedCrash(error)) throw error;
      return failureResult(error, null);
    });
  }

  async function readStateUnderLock(base, initialContext) {
    const loaded = await durableJournal.read(base.rootPath);
    if (!loaded.record) return successResult(null);
    let record = loaded.record;
    try {
      assertJournalRemoteTrust(record);
      const context = await refreshContext(base.rootPath, initialContext);
      await assertActiveSession(base, record);
      assertJournalReadIdentity(record, base, context);
      const factsReader = record.cleanup_state === "none" ? readFacts : readCleanupFacts;
      let facts = await factsReader(base.rootPath, record);
      ({ record, facts } = await persistRemoteTruth(base.rootPath, record, facts));
      if (record.push_state === "accepted") {
        return finishAcceptedOperation(base.rootPath, record, facts.status, null);
      }
      return successResult(deriveCloudInitializationState(record, facts), facts.status);
    } catch (error) {
      if (isSimulatedCrash(error)) throw error;
      const facts = await readLocalFacts(base.rootPath, record).catch(() => ({}));
      return failureResult(error, deriveCloudInitializationState(record, facts));
    }
  }

  async function runInitializeUnderLock(base, initialContext, reportProgress) {
    let record = null;
    try {
      const context = await refreshContext(base.rootPath, initialContext);
      const session = await assertActiveSession(base);
      if ((await otherJournal.read(base.rootPath)).record) {
        throw createPublishError("IDENTITY_MISMATCH", "A Cloud Git connection operation is already pending.", false);
      }
      record = (await durableJournal.read(base.rootPath)).record;
      reportProgress("validating", record);
      if (!record) {
        const status = await getGitStatus(base.rootPath);
        assertFreshPublishStatus(status, base);
        await gitService.assertNoRemote(base.rootPath);
        const source = await gitService.resolveSourceCommit(base.rootPath, base.sourceBranch);
        await gitService.preflight(base.rootPath, source.commitOid);
        const attempt = createPushAttempt({ sequence: 1, commitOid: source.commitOid, now, randomUUID });
        record = createInitialRecord(base, context, session, attempt, now, randomUUID);
        await durableJournal.write(base.rootPath, record, { createOnly: true });
        events.record("cloud_init_started", eventFields(record, now));
        await injectFault("after-prepared", record);
      } else {
        assertJournalRemoteTrust(record);
        assertJournalStartIdentity(record, base, context, session);
        if (["requested", "deleting", "failed"].includes(record.cleanup_state)) {
          throw createPublishError(
            "CLEANUP_FAILED",
            "This operation is deleting an empty Cloud Project. Finish cleanup to continue.",
            true,
          );
        }
        let facts = await readFacts(base.rootPath, record);
        ({ record, facts } = await persistRemoteTruth(base.rootPath, record, facts));
        if (record.push_state === "accepted") {
          return finishAcceptedOperation(base.rootPath, record, facts.status, reportProgress);
        }
        if (record.push_state === "conflict") {
          throw createPublishError("REMOTE_REF_CONFLICT", "Cloud main contains a different commit.", false);
        }
        if (record.push_state === "uncertain") {
          if (base.action !== "reconcile") {
            throw createPublishError("PUSH_UNCERTAIN", "Check Cloud main before creating another push attempt.", true);
          }
          const notAccepted = createPublishError(
            "PUSH_FAILED",
            "Cloud main does not contain the uncertain attempt. Retry Push when ready.",
            true,
          );
          record = await persistFailure(base.rootPath, record, notAccepted);
          const refreshedFacts = await readLocalFacts(base.rootPath, record);
          return failureResult(notAccepted, deriveCloudInitializationState(record, refreshedFacts));
        }
        if (base.action === "choose-source") {
          if (!facts.sourceMissing) {
            throw createPublishError(
              "IDENTITY_MISMATCH",
              "The selected source branch still exists; source replacement is not available.",
              false,
            );
          }
          record = await beginRetryAttempt(base.rootPath, record, base.sourceBranch);
          reportProgress("validating", record);
        } else if (record.last_error || ["retry-push", "push-latest"].includes(base.action)) {
          record = await beginRetryAttempt(base.rootPath, record);
          reportProgress("validating", record);
        }
      }

      if (record.checkpoint === "prepared") {
        reportProgress("creating-project", record);
        record = await persist(base.rootPath, record, { project_state: "creating", last_error: null });
        const projectId = await cloudApi.createProject(record);
        await injectFault("after-project-response", record);
        record = await persist(base.rootPath, record, {
          checkpoint: "project-created",
          project_state: "empty",
          project_id: projectId,
        });
        events.record("cloud_project_created", eventFields(record, now));
        await injectFault("after-project-created", record);
      }
      if (record.checkpoint === "project-created") {
        reportProgress("securing-credential", record);
        const secret = await ensureCredentialSecret(base.rootPath, record);
        record = secret.record;
        const credential = await cloudApi.issueCredential(record, secret.value);
        await injectFault("after-credential-response", record);
        record = await persist(base.rootPath, record, {
          checkpoint: "credential-issued",
          credential_id: credential.id,
          canonical_remote_url: credential.remoteUrl,
          credential_username: credential.username,
        });
        await injectFault("after-credential-issued", record);
      }
      if (record.checkpoint === "credential-issued") {
        record = await configureRemote(base.rootPath, record, reportProgress);
      }

      if (["remote-configured", "push-attempt"].includes(record.checkpoint)) {
        record = await ensureConfiguredRemote(base.rootPath, record, reportProgress);
        record = await persist(base.rootPath, record, {
          checkpoint: "push-attempt",
          push_state: "uploading",
          last_error: null,
          attempt: updateAttempt(record.attempt, "uploading", now),
        });
        events.record("push_attempt_started", eventFields(record, now));
        await gitService.pushExpectedCommit(
          base.rootPath,
          record,
          await requireStoredSecret(record),
          (stage) => reportProgress(stage, record),
        );
        record = await persist(base.rootPath, record, {
          checkpoint: "push-accepted",
          project_state: "published",
          push_state: "accepted",
          cleanup_state: "none",
          last_error: null,
          attempt: updateAttempt(record.attempt, "accepted", now, true),
        });
        events.record("push_attempt_accepted", eventFields(record, now));
        await injectFault("after-push-accepted", record);
      }

      return finishAcceptedOperation(base.rootPath, record, null, reportProgress);
    } catch (error) {
      if (isSimulatedCrash(error)) throw error;
      const latest = await durableJournal.read(base.rootPath).then((entry) => entry.record).catch(() => record);
      const failed = latest ? await persistFailure(base.rootPath, latest, error).catch(() => latest) : null;
      if (failed) {
        const errorFields = { ...eventFields(failed, now), error_code: error.publishCode ?? "UNKNOWN" };
        events.record(errorEventName(error), errorFields);
        if (failed.project_state === "empty" && !["accepted", "conflict"].includes(failed.push_state)) {
          events.record("empty_project_retained", { ...errorFields, outcome: "retained" });
        }
      }
      const facts = failed ? await readLocalFacts(base.rootPath, failed).catch(() => ({})) : {};
      return failureResult(error, failed ? deriveCloudInitializationState(failed, facts) : null);
    }
  }

  async function runCleanupUnderLock(base, initialContext) {
    let record = null;
    try {
      const context = await refreshContext(base.rootPath, initialContext);
      record = (await durableJournal.read(base.rootPath)).record;
      if (!record) return successResult(null, await getGitStatus(base.rootPath));
      assertJournalRemoteTrust(record);
      await assertActiveSession(base, record);
      assertJournalReadIdentity(record, base, context);
      if (record.operation_id !== base.operationId) {
        throw createPublishError("IDENTITY_MISMATCH", "Cleanup operation id does not match.", false);
      }

      let facts = await readCleanupFacts(base.rootPath, record);
      ({ record, facts } = await persistRemoteTruth(base.rootPath, record, facts));
      if (record.push_state === "accepted") {
        return finishAcceptedOperation(base.rootPath, record, facts.status, null);
      }
      if (record.push_state === "conflict" || facts.remoteConflict) {
        throw createPublishError(
          "REMOTE_REF_CONFLICT",
          "Cloud main contains content, so this Project is no longer empty and cannot be deleted by initialization cleanup.",
          false,
        );
      }

      if (record.cleanup_state === "none") {
        record = await persist(base.rootPath, record, {
          checkpoint: "cleanup-requested",
          project_state: "deleting",
          cleanup_state: "requested",
          last_error: null,
        });
        events.record("cleanup_requested", eventFields(record, now));
      }
      await injectFault("after-cleanup-requested", record);

      if (record.project_id && record.checkpoint !== "cleanup-server-complete") {
        try {
          await cloudApi.abandonEmptyProject(record);
        } catch (error) {
          if (isNotAbandonable(error)) {
            facts = await readFacts(base.rootPath, record, { canonicalUrlOnly: true });
            ({ record, facts } = await persistRemoteTruth(base.rootPath, record, facts));
            if (record.push_state === "accepted") {
              return finishAcceptedOperation(base.rootPath, record, facts.status, null);
            }
            if (record.push_state === "conflict") {
              throw createPublishError(
                "REMOTE_REF_CONFLICT",
                "Cloud main contains content; cleanup stopped without deleting the Project.",
                false,
                error,
              );
            }
          }
          if (!isProjectUnavailable(error)) throw error;
        }
        await injectFault("after-cleanup-server-response", record);
        record = await persist(base.rootPath, record, {
          checkpoint: "cleanup-server-complete",
          project_state: "deleted",
          cleanup_state: "deleting",
          last_error: null,
        });
      }

      await cloudApi.revokeCredential(record);
      await gitService.cleanupAfterServerAbandon(base.rootPath, record);
      if (record.secret_ref) await secretVault.clear(record.secret_ref);
      await clearJournal(base.rootPath, record);
      events.record("cleanup_completed", eventFields(record, now));
      return successResult(null, await getGitStatus(base.rootPath));
    } catch (error) {
      if (isSimulatedCrash(error)) throw error;
      const latest = await durableJournal.read(base.rootPath).then((entry) => entry.record).catch(() => record);
      let failed = latest;
      if (latest && latest.push_state !== "accepted" && latest.push_state !== "conflict") {
        failed = await persist(base.rootPath, latest, {
          checkpoint: "cleanup-requested",
          project_state: "deleting",
          cleanup_state: "failed",
          last_error: toStoredError(normalizeCleanupError(error), now),
        }).catch(() => latest);
      }
      events.record("cleanup_failed", { ...eventFields(failed, now), error_code: error.publishCode ?? "UNKNOWN" });
      const facts = failed ? await readLocalFacts(base.rootPath, failed).catch(() => ({})) : {};
      return failureResult(error, failed ? deriveCloudInitializationState(failed, facts) : null);
    }
  }

  async function configureRemote(rootPath, current, reportProgress, targetCheckpoint = "remote-configured") {
    let record = current;
    reportProgress("configuring-remote", record);
    if (!record.credential_config_snapshot) {
      const credentialConfig = await gitService.prepareCredentialConfig(rootPath, record);
      record = await persist(rootPath, record, { credential_config_snapshot: credentialConfig });
      await injectFault("after-credential-config-journaled", record);
    }
    if (!record.remote_add_intent) {
      await gitService.assertCanonicalRemoteAddIntent(rootPath, record);
      record = await persist(rootPath, record, { remote_add_intent: true });
      await injectFault("after-remote-add-intent", record);
    }
    const remoteCreated = await gitService.configureCanonicalRemote(
      rootPath,
      record,
      await requireStoredSecret(record),
    );
    record = await persist(rootPath, record, {
      checkpoint: targetCheckpoint,
      remote_created_by_operation: record.remote_add_intent || remoteCreated,
    });
    await injectFault("after-remote-configured", record);
    return record;
  }

  async function ensureConfiguredRemote(rootPath, record, reportProgress) {
    const remote = await gitService.inspectRemote(rootPath);
    if (remote.kind === "exact" && remote.url === record.canonical_remote_url) return record;
    if (remote.kind !== "missing") {
      throw createPublishError("REMOTE_CONFLICT", "Canonical PuppyOne Git remote has conflicting configuration.", false);
    }
    // A user or another Git client may remove our local remote after the push
    // attempt was journaled. Recreate it without rewinding the durable
    // checkpoint; journal CAS must always compare against the record on disk.
    return configureRemote(rootPath, record, reportProgress, record.checkpoint);
  }

  async function beginRetryAttempt(rootPath, record, sourceBranch = record.selected_source_branch) {
    if (record.push_state === "conflict") {
      throw createPublishError("REMOTE_REF_CONFLICT", "Cloud main contains a different commit.", false);
    }
    const source = await gitService.resolveSourceCommit(rootPath, sourceBranch);
    await gitService.preflight(rootPath, source.commitOid);
    const historyEntry = archiveAttempt(record.attempt, terminalAttemptState(record.push_state), now);
    const attempt = createPushAttempt({
      sequence: record.attempt_count + 1,
      commitOid: source.commitOid,
      now,
      randomUUID,
    });
    return persist(rootPath, record, {
      selected_source_branch: sourceBranch,
      selected_source_ref: `refs/heads/${sourceBranch}`,
      push_state: "preparing",
      attempt_count: record.attempt_count + 1,
      attempt,
      attempt_history: historyEntry
        ? [...record.attempt_history, historyEntry].slice(-20)
        : record.attempt_history,
      last_error: null,
    });
  }

  async function readFacts(rootPath, record, { canonicalUrlOnly = false } = {}) {
    const facts = await readLocalFacts(rootPath, record);
    if (
      (facts.localRemoteConflict && !canonicalUrlOnly)
      || !record.canonical_remote_url
      || !record.credential_config_snapshot
      || !record.credential_id
      || !record.secret_ref
      || !record.secret_stored
    ) return facts;
    const secret = await secretVault.get(record.secret_ref).catch(() => null);
    if (!secret) return facts;
    const inspectHead = canonicalUrlOnly
      ? gitService.inspectJournaledRemoteHead
      : gitService.inspectCanonicalRemoteHead;
    const remoteHead = await inspectHead(rootPath, record, secret).catch((error) => {
      if (error?.publishCode === "REMOTE_CONFLICT") throw error;
      return undefined;
    });
    if (remoteHead === undefined) return facts;
    return {
      ...facts,
      remoteHead,
      remoteAccepted: Boolean(remoteHead && remoteHead === record.attempt?.commit_oid),
      remoteConflict: Boolean(remoteHead && remoteHead !== record.attempt?.commit_oid),
    };
  }

  async function readLocalFacts(rootPath, record) {
    const [status, source, remote] = await Promise.all([
      getGitStatus(rootPath),
      gitService.resolveSourceCommit(rootPath, record.selected_source_branch)
        .catch((error) => error?.publishCode === "SOURCE_MISSING" ? null : Promise.reject(error)),
      gitService.inspectRemote(rootPath),
    ]);
    const localRemoteConflict = remote.kind === "conflict"
      || (remote.kind === "exact" && record.canonical_remote_url && remote.url !== record.canonical_remote_url);
    return {
      status,
      sourceTip: source?.commitOid ?? null,
      sourceMissing: !source,
      localRemoteConflict,
      remoteKind: remote.kind,
    };
  }

  async function readCleanupFacts(rootPath, record) {
    const localFacts = await readLocalFacts(rootPath, record);
    // Server-side abandonment is the final empty-Project proof. A missing or
    // user-owned conflicting local remote must not strand explicit cleanup;
    // local reconciliation will only remove an exact operation-owned value.
    if (
      record.checkpoint === "cleanup-server-complete"
      || localFacts.remoteKind !== "exact"
      || localFacts.localRemoteConflict
    ) return localFacts;
    return readFacts(rootPath, record);
  }

  async function persistRemoteTruth(rootPath, current, facts) {
    let record = current;
    if (facts.remoteAccepted && record.push_state !== "accepted") {
      record = await persist(rootPath, record, {
        checkpoint: "push-accepted",
        project_state: "published",
        push_state: "accepted",
        cleanup_state: "none",
        last_error: null,
        attempt: updateAttempt(record.attempt, "accepted", now, true),
      });
      events.record("push_reconciled", { ...eventFields(record, now), outcome: "accepted" });
    } else if (facts.remoteConflict && record.push_state !== "conflict") {
      record = await persist(rootPath, record, {
        checkpoint: "push-accepted",
        project_state: "published",
        push_state: "conflict",
        cleanup_state: "none",
        last_error: toStoredError(createPublishError(
          "REMOTE_REF_CONFLICT",
          "Cloud main points to a different commit.",
          false,
        ), now),
        attempt: updateAttempt(record.attempt, "conflict", now, true),
      });
      events.record("push_reconciled", { ...eventFields(record, now), outcome: "conflict" });
    }
    return { record, facts };
  }

  async function persistFailure(rootPath, record, error) {
    if (["push-accepted", "completed"].includes(record.checkpoint)) return record;
    const code = error?.publishCode ?? "UNKNOWN";
    const pushState = code === "PUSH_UNCERTAIN"
      ? "uncertain"
      : ["REMOTE_REF_CONFLICT", "REMOTE_CONFLICT"].includes(code)
        ? "conflict"
        : "failed";
    return persist(rootPath, record, {
      project_state: code === "PROJECT_UNAVAILABLE" ? "unavailable" : record.project_state,
      push_state: pushState,
      last_error: toStoredError(error, now),
      attempt: updateAttempt(record.attempt, terminalAttemptState(pushState), now, true),
    });
  }

  async function ensureCredentialSecret(rootPath, current) {
    let record = current;
    if (!record.secret_ref) {
      record = await persist(rootPath, record, { secret_ref: secretVault.createRef(), secret_stored: false });
      await injectFault("after-secret-ref-journaled", record);
    }
    let secret = await secretVault.get(record.secret_ref).catch((error) => {
      throw createPublishError("CREDENTIAL_FAILED", "Unable to read the protected Git credential.", false, error);
    });
    if (!secret) {
      if (record.secret_stored) {
        throw createPublishError("CREDENTIAL_FAILED", "Protected Git credential is unavailable.", false);
      }
      secret = `pwg_${randomBytes(32).toString("base64url")}`;
      await secretVault.put(record.secret_ref, secret).catch((error) => {
        throw createPublishError("CREDENTIAL_FAILED", "Unable to protect the Git credential.", false, error);
      });
      await injectFault("after-secret-vault-write", record);
    }
    if (!record.secret_stored) record = await persist(rootPath, record, { secret_stored: true });
    return { record, value: secret };
  }

  async function requireStoredSecret(record) {
    if (!record.secret_ref || !record.secret_stored) {
      throw createPublishError("CREDENTIAL_FAILED", "Pending Git credential state is incomplete.", false);
    }
    const secret = await secretVault.get(record.secret_ref).catch((error) => {
      throw createPublishError("CREDENTIAL_FAILED", "Unable to read the protected Git credential.", false, error);
    });
    if (!secret) throw createPublishError("CREDENTIAL_FAILED", "Protected Git credential is unavailable.", false);
    return secret;
  }

  function assertJournalRemoteTrust(record) {
    if (record.canonical_remote_url) cloudApi.validateExistingRemote(record.canonical_remote_url, record);
  }

  async function persist(rootPath, record, patch) {
    const next = {
      ...record,
      ...patch,
      revision: record.revision + 1,
      updated_at: new Date(now()).toISOString(),
    };
    return durableJournal.write(rootPath, next, {
      expectedOperationId: record.operation_id,
      expectedRevision: record.revision,
      expectedState: record.checkpoint,
    }).then((entry) => entry.record);
  }

  async function finishAcceptedOperation(rootPath, current, knownStatus, reportProgress) {
    let record = current;
    reportProgress?.("finalizing", record);
    let status = knownStatus;
    try {
      status = await gitService.finalizeUpstreamAndStatus(rootPath, record);
    } catch {
      events.record("local_finalize_failed", { ...eventFields(record, now), error_code: "LOCAL_FINALIZE_FAILED" });
      status = status ?? await getGitStatus(rootPath).catch(() => undefined);
    }
    if (record.checkpoint !== "completed") {
      record = await persist(rootPath, record, {
        checkpoint: "completed",
        project_state: "published",
        push_state: "accepted",
        cleanup_state: "none",
        last_error: null,
      });
    }
    const state = deriveCloudInitializationState(record, {
      status,
      sourceTip: record.attempt?.commit_oid ?? null,
      remoteAccepted: true,
    });
    reportProgress?.("completed", record);
    if (record.secret_ref) await secretVault.clear(record.secret_ref).catch(() => undefined);
    await clearJournal(rootPath, record).catch(() => undefined);
    return successResult(state, status);
  }

  function clearJournal(rootPath, record) {
    return durableJournal.clear(rootPath, {
      expectedOperationId: record.operation_id,
      expectedRevision: record.revision,
      expectedState: record.checkpoint,
    });
  }

  async function injectFault(point, record) {
    await faultInjector(point, structuredClone(record));
  }

  return {
    getState,
    startOrResume,
    cleanup,
    // Compatibility until all callers move to cloud-initialization:cleanup.
    abandon: cleanup,
  };
}

function updateAttempt(attempt, state, now, completed = false) {
  if (!attempt) return attempt;
  const timestamp = new Date(now()).toISOString();
  return {
    ...attempt,
    state,
    updated_at: timestamp,
    completed_at: completed ? timestamp : attempt.completed_at,
  };
}

function terminalAttemptState(state) {
  return ["accepted", "failed", "uncertain", "conflict"].includes(state) ? state : "failed";
}

function isNotAbandonable(error) {
  for (let current = error; current; current = current.cause) {
    if (current?.code === "initialization_not_abandonable") return true;
  }
  return false;
}

function normalizeCleanupError(error) {
  if (error?.publishCode === "COMPENSATION_FAILED") {
    return createPublishError("CLEANUP_FAILED", "Unable to finish empty Project cleanup.", true, error);
  }
  return error;
}

function eventFields(record, now) {
  if (!record) return {};
  const startedAt = Date.parse(record.attempt?.started_at ?? record.created_at);
  const durationMs = Number.isFinite(startedAt)
    ? Math.max(0, now() - startedAt)
    : null;
  return {
    operation_id: record.operation_id,
    attempt_id: record.attempt?.attempt_id ?? null,
    project_id: record.project_id,
    commit_oid: record.attempt?.commit_oid ?? null,
    attempt_count: record.attempt_count,
    duration_ms: durationMs,
  };
}

function errorEventName(error) {
  if (error?.publishCode === "PUSH_UNCERTAIN") return "push_attempt_uncertain";
  if (["PUSH_FAILED", "REMOTE_REF_CONFLICT"].includes(error?.publishCode)) return "push_attempt_failed";
  return "cloud_init_failed";
}
