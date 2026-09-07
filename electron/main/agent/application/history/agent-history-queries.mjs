import { historyFailure, observeHistoryOperation } from "./history-operation.mjs";
import { normalizeRuntimeId, requireWorkspaceRoot } from "../agent-input-policy.mjs";
import { publicSessionRecord } from "../../domain/agent-conversation-metadata.mjs";
import { resolvePersistedRuntimeId } from "../../migrations/legacy-session-format.mjs";

/** History queries receive only catalog and native discovery capabilities. */
export function createAgentHistoryQueries({ catalog, nativeConversationIndexer }) {
  async function listSessions(_sender, request, workspaceRoot) {
    requireWorkspaceRoot(workspaceRoot);
    const runtimeId = normalizeRuntimeId(request?.runtimeId);
    const discovery = request?.discoverNative && runtimeId
      ? await nativeConversationIndexer.refresh({
        workspaceRoot,
        runtimeId,
        cursor: request?.cursor ?? null,
        scanId: request?.scanId ?? null,
        limit: request?.limit,
      })
      : {
        runtimeId: runtimeId ?? null,
        status: "not-requested",
        nextCursor: null,
        scanId: null,
        indexed: 0,
        warnings: [],
      };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(historyFailure("History catalog read timed out.")), 2_000);
    let records;
    let catalogCoverage;
    try {
      [records, catalogCoverage] = await observeHistoryOperation(() => Promise.all([
        catalog.list(workspaceRoot, { runtimeId, includeArchived: Boolean(request?.includeArchived) }),
        catalog.getCoverage(),
      ]), controller.signal);
    } finally {
      clearTimeout(timer);
    }
    return {
      ...(catalogCoverage ? { catalogCoverage } : {}),
      sessions: records.map((record) => publicSessionRecord({
        ...record,
        runtimeId: resolvePersistedRuntimeId(record, runtimeId),
      })),
      discovery,
      warnings: discovery.warnings,
    };
  }

  return { listSessions };
}
