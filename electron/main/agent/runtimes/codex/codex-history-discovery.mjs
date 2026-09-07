import { historyCursor, historyLocators, historyNativeId, historyPageSize } from "../../../../../shared/agent-contract/history-schema.mjs";
import { stringOrNull, toIsoFromSeconds } from "./codex-native-values.mjs";

/** Codex's native metadata list; never scans rollout files or mutates a live thread. */
export async function discoverCodexHistory({ request, workspaceRoot }, { cursor = null, limit, signal } = {}) {
  signal?.throwIfAborted();
  const pageSize = historyPageSize(limit);
  const result = await request("thread/list", { cwd: workspaceRoot, cursor: historyCursor(cursor), limit: pageSize,
    archived: false, sortKey: "updated_at", sortDirection: "desc", useStateDbOnly: true });
  signal?.throwIfAborted();
  if (!Array.isArray(result?.data) || result.data.length > pageSize
    || result.data.some((thread) => !historyNativeId(thread?.id))) {
    throw new TypeError("Codex history returned an invalid session page.");
  }
  return {
    supported: true,
    sessions: historyLocators(result.data.filter((thread) => !thread.ephemeral && thread.cwd === workspaceRoot)
      .map((thread) => ({ providerSessionId: thread.id,
        title: stringOrNull(thread.name) || stringOrNull(thread.preview) || "Codex session",
        createdAt: toIsoFromSeconds(thread.createdAt), updatedAt: toIsoFromSeconds(thread.updatedAt),
        selectedProviderId: stringOrNull(thread.modelProvider) })), pageSize),
    nextCursor: historyCursor(result.nextCursor),
    // The metadata index is not a consistent snapshot of every native conversation.
    coverage: { scopeComplete: false, snapshotId: null },
  };
}
