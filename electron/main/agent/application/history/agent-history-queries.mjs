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
    let catalogNextCursor;
    let excludedSessionIds;
    let catalogCoverage;
    try {
      [records, catalogCoverage] = await observeHistoryOperation(() => Promise.all([
        typeof catalog.listPage === "function"
          ? catalog.listPage(workspaceRoot, { runtimeId: request?.discoverNative ? null : runtimeId, includeArchived: Boolean(request?.includeArchived), cursor: request?.catalogCursor })
          : catalog.list(workspaceRoot, { runtimeId, includeArchived: Boolean(request?.includeArchived) }),
        catalog.getCoverage(),
      ]), controller.signal);
    } finally {
      clearTimeout(timer);
    }
    if (!Array.isArray(records)) { catalogNextCursor = records.nextCursor; excludedSessionIds = records.excludedSessionIds; records = records.sessions; }
    if (Array.isArray(discovery.sessions)) records = discovery.sessions.filter((record) => request?.includeArchived || !record.archivedAt);
    const publicDiscovery = { ...discovery };
    delete publicDiscovery.sessions;
    return {
      ...(catalogNextCursor !== undefined ? { catalogNextCursor, sessionListKind: "page" } : {}),
      ...(excludedSessionIds ? { excludedSessionIds } : {}),
      ...(catalogCoverage ? { catalogCoverage } : {}),
      sessions: records.map((record) => publicSessionRecord({
        ...record,
        runtimeId: resolvePersistedRuntimeId(record, runtimeId),
      })),
      discovery: publicDiscovery,
      warnings: discovery.warnings,
    };
  }

  return { listSessions };
}
