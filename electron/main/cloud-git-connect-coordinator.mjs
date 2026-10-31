import crypto from "node:crypto";
import fs from "node:fs";
import { getWorkspaceGitStatus, resolveGitRepositoryIdentity } from "../local-api/workspace.mjs";
import { execGit, execGitBuffer } from "../local-api/git/runner.mjs";
import { normalizeCloudApiBaseUrl } from "../../shared/cloudEndpoint.js";
import { createCloudGitConnectJournal } from "./cloud-git-connect-journal.mjs";
import { createCloudGitOperationLease } from "./cloud-git-operation-lease.mjs";
import { createCloudPublishApi } from "./cloud-publish-api.mjs";
import {
  createPublishError,
  failureResult,
  isSimulatedCrash,
  normalizeReadRequest,
  refreshRepositoryContext,
  resolveRepositoryContext,
} from "./cloud-publish-contract.mjs";
import { createCloudPublishGitCredentialManager } from "./cloud-publish-git-credentials.mjs";
import { createCloudPublishGitService } from "./cloud-publish-git.mjs";
import { createCloudPublishJournal } from "./cloud-publish-journal.mjs";
import { createGitOperationCoordinator, repositoryLockKey } from "./git-operation-coordinator.mjs";

/** Durable main-owned primitive for Connect Existing Project and future Clone. */
export function createCloudGitConnectCoordinator({
  cloudAuthService,
  secretVault,
  journal = null,
  publishJournal = null,
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
} = {}) {
  if (!cloudAuthService?.readSession || !cloudAuthService?.requestSessionApi) {
    throw new TypeError("Cloud Git connect coordinator requires cloudAuthService.");
  }
  if (!secretVault?.createRef || !secretVault?.put || !secretVault?.get || !secretVault?.clear) {
    throw new TypeError("Cloud Git connect coordinator requires SecretVault.");
  }
  const contextOptions = { resolveRepositoryIdentity, fsApi };
  const durableJournal = journal ?? createCloudGitConnectJournal({ fsApi, now, resolveRepositoryIdentity });
  const otherJournal = publishJournal ?? createCloudPublishJournal({ fsApi, now, resolveRepositoryIdentity });
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
  const inflight = new Map();

  async function connect(request = {}) {
    let base;
    let context;
    try {
      base = normalizeRequest(request);
      context = await resolveRepositoryContext(base.rootPath, contextOptions);
    } catch (error) {
      return connectFailure(error, null);
    }
    const key = context.identity.gitDir;
    if (inflight.has(key)) return inflight.get(key);
    const promise = gitOperationCoordinator.run(repositoryLockKey(context.identity.commonDir), async () => {
      const lease = await leaseService.acquire(base.rootPath);
      try {
        return await runConnect(base, context);
      } finally {
        await lease.release();
      }
    }).catch((error) => {
      if (isSimulatedCrash(error)) throw error;
      return connectFailure(error, null);
    }).finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  }

  async function abandon(request = {}) {
    let base;
    let context;
    try {
      base = { ...normalizeRequest(request), operationId: requireUuid(request.operationId) };
      context = await resolveRepositoryContext(base.rootPath, contextOptions);
    } catch (error) {
      return connectFailure(error, null);
    }
    return gitOperationCoordinator.run(repositoryLockKey(context.identity.commonDir), async () => {
      const lease = await leaseService.acquire(base.rootPath);
      try {
        return await runCompensation(base, context);
      } finally {
        await lease.release();
      }
    }).catch((error) => {
      if (isSimulatedCrash(error)) throw error;
      return connectFailure(error, null);
    });
  }

  async function runConnect(base, initialContext) {
    let record = null;
    try {
      const context = await refreshRepositoryContext(base.rootPath, initialContext, contextOptions);
      const session = await assertSession(base);
      record = (await durableJournal.read(base.rootPath)).record;
      if (!record) {
        if ((await otherJournal.read(base.rootPath)).record) {
          throw createPublishError("IDENTITY_MISMATCH", "A Cloud publish operation is already pending.", false);
        }
        const existingRemote = await gitService.inspectRemote(base.rootPath);
        if (existingRemote.kind === "exact") {
          const accessRecord = {
            api_base_url: base.apiBaseUrl,
            project_id: base.projectId,
          };
          cloudApi.validateExistingRemote(existingRemote.url, accessRecord);
          await cloudApi.verifyProjectAccess(accessRecord);
          return connectSuccess(await getGitStatus(base.rootPath), base.projectId);
        }
        await gitService.assertNoRemote(base.rootPath);
        record = createRecord(base, context, session);
        await durableJournal.write(base.rootPath, record, { createOnly: true });
        await injectFault("connect-after-prepared", record);
      } else {
        assertJournalRemoteTrust(record);
        assertRecordIdentity(record, base, context, session);
        if (record.phase === "compensation-pending") {
          return connectFailure(createPublishError(
            "COMPENSATION_FAILED",
            "Finish abandoning the previous connection attempt before retrying.",
            true,
          ), record.operation_id);
        }
        if (record.phase === "completed") {
          const status = await getGitStatus(base.rootPath);
          await cleanup(base.rootPath, record);
          return connectSuccess(status, record.project_id);
        }
        await gitService.assertResumeRemote(base.rootPath, record);
      }

      if (record.phase === "prepared") {
        const secret = await ensureSecret(base.rootPath, record);
        record = secret.record;
        const credential = await cloudApi.issueCredential(record, secret.value);
        await injectFault("connect-after-credential-response", record);
        record = await persist(base.rootPath, record, {
          phase: "credential-issued",
          credential_id: credential.id,
          canonical_remote_url: credential.remoteUrl,
          credential_username: credential.username,
        });
      }
      if (record.phase === "credential-issued") {
        if (!record.credential_config_snapshot) {
          const credentialConfig = await gitService.prepareCredentialConfig(base.rootPath, record);
          record = await persist(base.rootPath, record, {
            credential_config_snapshot: credentialConfig,
          });
          await injectFault("connect-after-credential-config-journaled", record);
        }
        if (!record.remote_add_intent) {
          await gitService.assertExistingRemoteAddIntent(base.rootPath, record);
          record = await persist(base.rootPath, record, { remote_add_intent: true });
          await injectFault("connect-after-remote-add-intent", record);
        }
        const created = await gitService.configureExistingProjectRemote(
          base.rootPath,
          record,
          await requireSecret(record),
        );
        record = await persist(base.rootPath, record, {
          phase: "remote-configured",
          remote_created_by_operation: record.remote_add_intent || created,
        });
        await injectFault("connect-after-remote-configured", record);
      }
      const status = await getGitStatus(base.rootPath);
      record = await persist(base.rootPath, record, { phase: "completed" });
      await cleanup(base.rootPath, record);
      return connectSuccess(status, record.project_id);
    } catch (error) {
      if (isSimulatedCrash(error)) throw error;
      const latest = await durableJournal.read(base.rootPath).then((entry) => entry.record).catch(() => record);
      return connectFailure(error, latest?.operation_id ?? null);
    }
  }

  async function runCompensation(base, initialContext) {
    let record = null;
    try {
      const context = await refreshRepositoryContext(base.rootPath, initialContext, contextOptions);
      const session = await assertSession(base);
      record = (await durableJournal.read(base.rootPath)).record;
      if (!record) return connectSuccess(await getGitStatus(base.rootPath), base.projectId);
      assertJournalRemoteTrust(record);
      assertRecordIdentity(record, base, context, session);
      if (record.operation_id !== base.operationId) {
        throw createPublishError("IDENTITY_MISMATCH", "Connection operation id does not match.", false);
      }
      if (record.phase !== "compensation-pending") {
        record = await persist(base.rootPath, record, { phase: "compensation-pending" });
      }
      await cloudApi.revokeCredential(record);
      await gitService.cleanupAfterServerAbandon(base.rootPath, record);
      record = await persist(base.rootPath, record, { phase: "completed" });
      await cleanup(base.rootPath, record);
      return connectSuccess(await getGitStatus(base.rootPath), record.project_id);
    } catch (error) {
      if (isSimulatedCrash(error)) throw error;
      return connectFailure(error, record?.operation_id ?? null);
    }
  }

  async function assertSession(base) {
    const session = await cloudAuthService.readSession();
    if (
      session?.user_id !== base.userId
      || normalizeCloudApiBaseUrl(session?.api_base_url) !== base.apiBaseUrl
    ) throw createPublishError("SESSION_REQUIRED", "Sign in with the selected Cloud account.", true);
    return session;
  }

  async function ensureSecret(rootPath, current) {
    let record = current;
    if (!record.secret_ref) {
      record = await persist(rootPath, record, { secret_ref: secretVault.createRef(), secret_stored: false });
    }
    let secret = await secretVault.get(record.secret_ref);
    if (!secret) {
      if (record.secret_stored) {
        throw createPublishError("CREDENTIAL_FAILED", "Protected Git credential is unavailable.", false);
      }
      secret = `pwg_${randomBytes(32).toString("base64url")}`;
      await secretVault.put(record.secret_ref, secret);
    }
    if (!record.secret_stored) record = await persist(rootPath, record, { secret_stored: true });
    return { record, value: secret };
  }

  async function requireSecret(record) {
    const secret = record.secret_ref ? await secretVault.get(record.secret_ref) : null;
    if (!secret) throw createPublishError("CREDENTIAL_FAILED", "Protected Git credential is unavailable.", false);
    return secret;
  }

  function assertJournalRemoteTrust(record) {
    if (record.canonical_remote_url) {
      cloudApi.validateExistingRemote(record.canonical_remote_url, record);
    }
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
      expectedPhase: record.phase,
    }).then((entry) => entry.record);
  }

  async function cleanup(rootPath, record) {
    if (record.secret_ref) await secretVault.clear(record.secret_ref);
    await durableJournal.clear(rootPath, {
      expectedOperationId: record.operation_id,
      expectedRevision: record.revision,
      expectedPhase: record.phase,
    });
  }

  async function injectFault(point, record) {
    await faultInjector(point, { operationId: record.operation_id, phase: record.phase });
  }

  function createRecord(base, context, session) {
    const timestamp = new Date(now()).toISOString();
    return {
      version: 1,
      kind: "configure-existing-remote",
      operation_id: randomUUID(),
      revision: 0,
      phase: "prepared",
      api_base_url: base.apiBaseUrl,
      api_origin: new URL(base.apiBaseUrl).origin,
      user_id: session.user_id,
      project_id: base.projectId,
      repository_fingerprint: context.repositoryFingerprint,
      secret_ref: null,
      secret_stored: false,
      credential_id: null,
      canonical_remote_url: null,
      credential_username: null,
      credential_config_snapshot: null,
      remote_add_intent: false,
      remote_created_by_operation: false,
      created_at: timestamp,
      updated_at: timestamp,
    };
  }

  return { connect, abandon };
}

function normalizeRequest(request) {
  const base = normalizeReadRequest(request);
  const projectId = typeof request.projectId === "string" ? request.projectId.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(projectId)) {
    throw createPublishError("IDENTITY_MISMATCH", "Cloud Project id is invalid.", false);
  }
  return { ...base, projectId };
}

function assertRecordIdentity(record, base, context, session) {
  if (
    record.api_base_url !== base.apiBaseUrl
    || record.user_id !== base.userId
    || record.user_id !== session.user_id
    || record.project_id !== base.projectId
    || record.repository_fingerprint !== context.repositoryFingerprint
  ) throw createPublishError("IDENTITY_MISMATCH", "Connection request does not match the pending operation.", false);
}

function requireUuid(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw createPublishError("IDENTITY_MISMATCH", "Connection operation id is invalid.", false);
  }
  return normalized;
}

function connectSuccess(gitStatus, projectId) {
  return {
    ok: true,
    gitStatus,
    projectId,
    target: { kind: "project_root", project_id: projectId },
  };
}

function connectFailure(error, operationId) {
  const result = failureResult(error, null);
  return { ...result, operationId };
}
