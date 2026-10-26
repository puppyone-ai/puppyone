import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveGitRepositoryIdentity } from "../../../local-api/workspace.mjs";
import { normalizeCloudApiBaseUrl } from "../../../shared/cloudEndpoint.js";

export const CLOUD_REMOTE_NAME = "puppyone";
export const CLOUD_DESTINATION_BRANCH = "main";
export const CLOUD_DESTINATION_REF = `refs/heads/${CLOUD_DESTINATION_BRANCH}`;
export const CLOUD_GIT_USERNAME = "x-puppyone-token";
export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const COMMIT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export const CLOUD_PUBLISH_ERROR_CODES = Object.freeze([
  "SESSION_REQUIRED",
  "IDENTITY_MISMATCH",
  "ORGANIZATION_REQUIRED",
  "REPOSITORY_REQUIRED",
  "COMMIT_REQUIRED",
  "BRANCH_REQUIRED",
  "SOURCE_MISSING",
  "MERGE_TIP_UNSUPPORTED",
  "LFS_UNSUPPORTED",
  "REMOTE_CONFLICT",
  "REMOTE_REF_CONFLICT",
  "PROJECT_CREATE_FAILED",
  "PROJECT_UNAVAILABLE",
  "CREDENTIAL_FAILED",
  "SERVICE_UPGRADE_REQUIRED",
  "REMOTE_CONFIG_FAILED",
  "PUSH_FAILED",
  "PUSH_LIMIT_EXCEEDED",
  "PUSH_UNCERTAIN",
  "LOCAL_FINALIZE_FAILED",
  "CLEANUP_FAILED",
  "CLEANUP_NOT_ALLOWED",
  // Kept as a decoder/API compatibility code for version-1 operations.
  "COMPENSATION_FAILED",
  "JOURNAL_CORRUPT",
  "JOURNAL_IO_FAILED",
  "PERMISSION_DENIED",
  "UNKNOWN",
]);

export function normalizeReadRequest(request = {}) {
  return {
    rootPath: requireString(request.rootPath, "REPOSITORY_REQUIRED", "Workspace path is required."),
    apiBaseUrl: requireApiBase(request.apiBaseUrl),
    userId: requireString(request.userId, "SESSION_REQUIRED", "Cloud user identity is required."),
  };
}

export function normalizeStartRequest(request = {}) {
  const base = normalizeReadRequest(request);
  const organizationId = requireString(
    request.organizationId,
    "ORGANIZATION_REQUIRED",
    "Select a PuppyOne organization before publishing.",
  );
  const projectName = requireString(request.projectName, "IDENTITY_MISMATCH", "Cloud Project name is required.");
  if (projectName.length > 200) {
    throw createPublishError("IDENTITY_MISMATCH", "Cloud Project name is too long.", false);
  }
  // expectedBranch is accepted only as a short-lived bridge for older Renderer
  // bundles. It is converted to a named source ref and is never coupled to HEAD.
  const sourceBranch = normalizeBranch(request.sourceBranch ?? request.expectedBranch);
  const operationId = optionalUuid(request.operationId, "Publish operation id is invalid.");
  const action = ["initialize", "retry-push", "push-latest", "choose-source", "reconcile"].includes(request.action)
    ? request.action
    : "initialize";
  return { ...base, organizationId, projectName, sourceBranch, operationId, action };
}

export function normalizeCleanupRequest(request = {}) {
  const base = normalizeReadRequest(request);
  const operationId = requireUuid(request.operationId, "Cleanup operation id is invalid.");
  return { ...base, operationId };
}

// Compatibility export for the old IPC facade.
export const normalizeAbandonRequest = normalizeCleanupRequest;

export async function resolveRepositoryContext(rootPath, {
  resolveRepositoryIdentity = resolveGitRepositoryIdentity,
  fsApi = fs.promises,
} = {}) {
  const identity = await resolveRepositoryIdentity(rootPath);
  if (!identity?.repository || !identity.gitDir || !identity.commonDir) {
    throw createPublishError("REPOSITORY_REQUIRED", "Current workspace is not a Git repository.", false);
  }
  const canonicalRoot = path.resolve(rootPath);
  const metadata = await fsApi.stat(identity.commonDir).catch((error) => {
    throw createPublishError("REPOSITORY_REQUIRED", "Unable to inspect the Git repository.", false, error);
  });
  const repositoryFingerprint = crypto.createHash("sha256").update([
    "puppyone-publish-repository-v1",
    String(metadata.dev),
    String(metadata.ino),
    path.resolve(identity.commonDir),
    path.resolve(identity.gitDir),
    path.resolve(identity.topLevel ?? canonicalRoot),
  ].join("\0")).digest("hex");
  return { rootPath: canonicalRoot, identity, repositoryFingerprint };
}

export async function refreshRepositoryContext(rootPath, initial, options = {}) {
  const current = await resolveRepositoryContext(rootPath, options);
  if (
    current.identity.gitDir !== initial.identity.gitDir
    || current.identity.commonDir !== initial.identity.commonDir
    || current.repositoryFingerprint !== initial.repositoryFingerprint
  ) {
    throw createPublishError("IDENTITY_MISMATCH", "Git repository identity changed during Cloud initialization.", false);
  }
  return current;
}

export function createInitialRecord(base, context, session, attempt, now, randomUUID) {
  const operationId = normalizeGeneratedUuid(randomUUID(), "Cloud initialization operation");
  const timestamp = new Date(now()).toISOString();
  return {
    version: 2,
    kind: "puppyone-cloud-initialization",
    operation_id: operationId,
    revision: 0,
    checkpoint: "prepared",
    api_base_url: base.apiBaseUrl,
    api_origin: new URL(base.apiBaseUrl).origin,
    user_id: session.user_id,
    organization_id: base.organizationId,
    project_name: base.projectName,
    create_payload: {
      org_id: base.organizationId,
      name: base.projectName,
      description: null,
    },
    repository_fingerprint: context.repositoryFingerprint,
    selected_source_branch: base.sourceBranch,
    selected_source_ref: `refs/heads/${base.sourceBranch}`,
    destination_ref: CLOUD_DESTINATION_REF,
    project_state: "absent",
    push_state: "preparing",
    cleanup_state: "none",
    project_id: null,
    credential_id: null,
    secret_ref: null,
    secret_stored: false,
    canonical_remote_url: null,
    credential_username: null,
    credential_config_snapshot: null,
    remote_add_intent: false,
    remote_created_by_operation: false,
    attempt_count: 1,
    attempt,
    attempt_history: [],
    last_error: null,
    migrated_from: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export function assertFreshPublishStatus(status, base) {
  if (!status?.isRepo) {
    throw createPublishError("REPOSITORY_REQUIRED", "Current workspace is not a Git repository.", false);
  }
  if (
    !COMMIT_ID_PATTERN.test(status.headCommitId ?? "")
    || !Number.isInteger(status.totalCommits)
    || status.totalCommits < 1
  ) {
    throw createPublishError("COMMIT_REQUIRED", "Create a Git commit before publishing.", false);
  }
  const currentBranch = normalizeStatusBranch(status.branch);
  if (!currentBranch) {
    throw createPublishError("BRANCH_REQUIRED", "Select a local Git branch before publishing.", false);
  }
  if (currentBranch !== base.sourceBranch) {
    throw createPublishError("BRANCH_REQUIRED", "The selected source branch changed before initialization started.", false);
  }
}

export function assertJournalStartIdentity(record, base, context, session) {
  assertJournalReadIdentity(record, base, context);
  if (
    record.user_id !== session.user_id
    || record.organization_id !== base.organizationId
    || record.project_name !== base.projectName
    || (base.action !== "choose-source" && record.selected_source_branch !== base.sourceBranch)
    || (base.operationId && record.operation_id !== base.operationId)
  ) {
    throw createPublishError("IDENTITY_MISMATCH", "Request does not match the pending Cloud initialization.", false);
  }
}

export function assertJournalReadIdentity(record, base, context) {
  if (
    record.api_base_url !== base.apiBaseUrl
    || record.user_id !== base.userId
    || record.repository_fingerprint !== context.repositoryFingerprint
  ) {
    throw createPublishError(
      "IDENTITY_MISMATCH",
      "Cloud initialization does not match this account or Git repository.",
      false,
    );
  }
}

export function requestFingerprint(request) {
  return JSON.stringify([
    request.apiBaseUrl,
    request.userId,
    request.organizationId,
    request.projectName,
    request.sourceBranch,
    request.operationId ?? null,
    request.action,
  ]);
}

export function successResult(state, gitStatus = undefined) {
  return {
    ok: true,
    state,
    ...(gitStatus === undefined ? {} : { gitStatus }),
  };
}

export function failureResult(error, state) {
  const normalized = normalizePublishError(error);
  return {
    ok: false,
    state,
    error: {
      code: normalized.code,
      retryable: normalized.retryable,
      ...(normalized.message ? { message: normalized.message } : {}),
    },
  };
}

export function createPublishError(code, message, retryable, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.publishCode = CLOUD_PUBLISH_ERROR_CODES.includes(code) ? code : "UNKNOWN";
  error.publishRetryable = retryable === true;
  return error;
}

export function mapCloudMutationError(defaultCode, message, error) {
  if (["SESSION_SIGNED_OUT", "SESSION_SIGNING_OUT", "SESSION_CHANGED"].includes(error?.code)) {
    return createPublishError("SESSION_REQUIRED", "Sign in to Puppyone Cloud to continue.", true, error);
  }
  if (Number(error?.status) === 401) {
    return createPublishError("SESSION_REQUIRED", "Sign in to Puppyone Cloud to continue.", true, error);
  }
  if (Number(error?.status) === 403) {
    return createPublishError("PERMISSION_DENIED", "You do not have permission to access this Cloud Project.", false, error);
  }
  if (Number(error?.status) === 404) {
    return createPublishError("PROJECT_UNAVAILABLE", "The Cloud Project no longer exists or is unavailable.", false, error);
  }
  if (error?.code === "organization_required") {
    return createPublishError("ORGANIZATION_REQUIRED", "Select a PuppyOne organization before publishing.", false, error);
  }
  if ([
    "database_schema_outdated",
    "schema_migration_required",
    "service_upgrade_required",
  ].includes(error?.code)) {
    return createPublishError(
      "SERVICE_UPGRADE_REQUIRED",
      "Puppyone Cloud is being upgraded. Resume publishing shortly.",
      true,
      error,
    );
  }
  const retryable = ![400, 403, 404, 409, 410, 422].includes(Number(error?.status));
  return createPublishError(defaultCode, message, retryable, error);
}

export function toStoredError(error, now = Date.now) {
  const normalized = normalizePublishError(error);
  return {
    code: normalized.code,
    retryable: normalized.retryable,
    occurred_at: new Date(now()).toISOString(),
  };
}

export function isSimulatedCrash(error) {
  return error?.simulateCrash === true;
}

export function isProjectUnavailable(error) {
  for (let current = error; current; current = current.cause) {
    if (current?.publishCode === "PROJECT_UNAVAILABLE" || Number(current?.status) === 404) return true;
  }
  return false;
}

function requireApiBase(value) {
  const normalized = normalizeCloudApiBaseUrl(value);
  if (!normalized) throw createPublishError("SESSION_REQUIRED", "Cloud API origin is invalid.", false);
  return normalized;
}

function requireString(value, code, message) {
  if (typeof value !== "string" || !value.trim()) throw createPublishError(code, message, false);
  return value.trim();
}

function normalizeBranch(value) {
  const branch = requireString(value, "BRANCH_REQUIRED", "Select a local Git branch before publishing.");
  if (
    ["head", "detached"].includes(branch.toLowerCase())
    || branch.startsWith("-")
    || branch.startsWith("refs/")
    || branch.includes("..")
    || /[~^:?*[\\\x00-\x20\x7f]/.test(branch)
    || branch.endsWith("/")
    || branch.endsWith(".")
    || branch.includes("@{")
  ) {
    throw createPublishError("BRANCH_REQUIRED", "Selected source branch is invalid.", false);
  }
  return branch;
}

function normalizeStatusBranch(value) {
  if (typeof value !== "string") return null;
  const branch = value.trim();
  return !branch || ["head", "detached"].includes(branch.toLowerCase()) ? null : branch;
}

function optionalUuid(value, message) {
  if (value == null || value === "") return null;
  return requireUuid(value, message);
}

function requireUuid(value, message) {
  const normalized = requireString(value, "IDENTITY_MISMATCH", message).toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) throw createPublishError("IDENTITY_MISMATCH", message, false);
  return normalized;
}

function normalizeGeneratedUuid(value, label) {
  const normalized = String(value ?? "").toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    throw createPublishError("JOURNAL_IO_FAILED", `Unable to allocate a ${label} id.`, false);
  }
  return normalized;
}

function normalizePublishError(error) {
  const code = CLOUD_PUBLISH_ERROR_CODES.includes(error?.publishCode)
    ? error.publishCode
    : error?.code === "CLOUD_PUBLISH_SECRET_VAULT_FAILED"
      ? "JOURNAL_IO_FAILED"
      : "UNKNOWN";
  const retryable = typeof error?.publishRetryable === "boolean"
    ? error.publishRetryable
    : code === "UNKNOWN";
  return {
    code,
    retryable,
    message: code === "UNKNOWN"
      ? "Unable to complete Puppyone Cloud initialization."
      : sanitizeDiagnostic(error instanceof Error ? error.message : String(error ?? "")),
  };
}

function sanitizeDiagnostic(message) {
  return String(message || "")
    .replace(/pwg_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .slice(0, 500);
}
