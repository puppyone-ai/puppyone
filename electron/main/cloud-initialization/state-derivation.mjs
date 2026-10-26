import { CLOUD_DESTINATION_BRANCH } from "./contract.mjs";
import { requiresSameCommitRetry } from "./attempts/retry-policy.mjs";

export const CLOUD_INITIALIZATION_ACTIONS = Object.freeze([
  "retry-push",
  "push-latest",
  "choose-source",
  "reconcile",
  "delete-empty-project",
  "finish-cleanup",
]);

/** Pure projection from durable operation facts to the Renderer contract. */
export function deriveCloudInitializationState(record, facts = {}) {
  const project = deriveProjectState(record, facts);
  const push = derivePushState(record, facts);
  const cleanup = record.cleanup_state;
  const local = deriveLocalState(record, facts);
  const availableActions = deriveAvailableActions({ record, project, push, cleanup, local, facts });
  return {
    operationId: record.operation_id,
    session: "signed-in",
    project,
    push,
    local,
    cleanup,
    projectId: record.project_id,
    projectName: record.project_name,
    organizationId: record.organization_id,
    selectedSourceBranch: record.selected_source_branch,
    selectedSourceRef: record.selected_source_ref,
    latestSourceCommitOid: facts.sourceTip ?? null,
    attemptId: record.attempt?.attempt_id ?? null,
    attemptCommitOid: record.attempt?.commit_oid ?? null,
    attemptCount: record.attempt_count,
    destinationBranch: CLOUD_DESTINATION_BRANCH,
    hasUncommittedChanges: hasDirtyFiles(facts.status),
    currentBranch: normalizeCurrentBranch(facts.status?.branch),
    lastError: record.last_error ? {
      code: record.last_error.code,
      retryable: record.last_error.retryable,
      occurredAt: record.last_error.occurred_at,
    } : null,
    availableActions,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function deriveProjectState(record, facts) {
  if (record.push_state === "accepted" || facts.remoteAccepted === true) return "published";
  if (record.cleanup_state === "completed") return "deleted";
  if (["requested", "deleting", "failed"].includes(record.cleanup_state)) return "deleting";
  return record.project_state;
}

function derivePushState(record, facts) {
  if (facts.remoteAccepted === true) return "accepted";
  if (facts.remoteConflict === true) return "conflict";
  return record.push_state;
}

function deriveLocalState(record, facts) {
  if (facts.localRemoteConflict === true) return "remote-conflict";
  if (facts.sourceMissing === true) return "source-missing";
  const currentBranch = normalizeCurrentBranch(facts.status?.branch);
  if (currentBranch && currentBranch !== record.selected_source_branch) return "branch-switched";
  if (
    facts.sourceTip
    && record.attempt?.commit_oid
    && facts.sourceTip !== record.attempt.commit_oid
  ) return "source-advanced";
  return hasDirtyFiles(facts.status) ? "dirty" : "clean";
}

function deriveAvailableActions({ record, project, push, cleanup, local, facts }) {
  if (["requested", "deleting", "failed"].includes(cleanup)) return ["finish-cleanup"];
  if (project === "published" || push === "accepted" || project === "deleted") return [];
  if (project === "unavailable") return ["finish-cleanup"];
  // `preparing` is durable: the process may have stopped immediately after
  // journaling the attempt. Renderer loading state prevents duplicate clicks
  // while a live operation is running; after restart the same state must be
  // recoverable.
  if (["uploading", "confirming"].includes(push)) return [];

  const actions = [];
  if (requiresSameCommitRetry(record) && local !== "remote-conflict") actions.push("retry-push");
  else if (local === "source-missing") actions.push("choose-source");
  else if (push !== "conflict" && local !== "remote-conflict") {
    actions.push(
      facts.sourceTip && record.attempt?.commit_oid && facts.sourceTip !== record.attempt.commit_oid
        ? "push-latest"
        : "retry-push",
    );
  }
  if (project === "empty" && record.last_error?.code !== "CLEANUP_NOT_ALLOWED") actions.push("delete-empty-project");
  return actions;
}

function hasDirtyFiles(status) {
  if (!status) return false;
  return [
    status.entries,
    status.stagedEntries,
    status.unstagedEntries,
    status.untrackedEntries,
  ].some((entries) => Array.isArray(entries) && entries.length > 0);
}

function normalizeCurrentBranch(value) {
  const branch = typeof value === "string" ? value.trim() : "";
  return !branch || ["head", "detached"].includes(branch.toLowerCase()) ? null : branch;
}
