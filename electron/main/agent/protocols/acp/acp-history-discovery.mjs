import path from "node:path";
import { agentHistoryLimits, historyCursor, historyLocators, historyNativeId } from "../../../../../shared/agent-contract/history-schema.mjs";
import { normalizeDate } from "./acp-native-values.mjs";

/** Shared ACP list semantics. Connection ownership remains with the querying adapter. */
export async function discoverAcpHistory({ client, workspaceRoot, fallbackTitle }, { cursor = null, signal } = {}) {
  signal?.throwIfAborted();
  const capabilities = client.agentCapabilities ?? {};
  if (capabilities.sessionCapabilities?.list == null && capabilities.listSessions !== true) {
    return { supported: false, sessions: [], nextCursor: null };
  }
  // ACP chooses page size; the UI limit is only a hint for protocols that support it.
  const pageSize = agentHistoryLimits.nativePage;
  const token = historyCursor(cursor);
  const page = await client.listSessions({ cwd: workspaceRoot, ...(token !== null ? { cursor: token } : {}) });
  signal?.throwIfAborted();
  if (!Array.isArray(page?.sessions) || page.sessions.length > pageSize
    || page.sessions.some((entry) => !historyNativeId(entry?.sessionId))) {
    throw new TypeError("ACP history returned an invalid session page.");
  }
  return { supported: true,
    sessions: historyLocators(page.sessions.filter((entry) => !entry.cwd || path.resolve(entry.cwd) === workspaceRoot)
      .map((entry) => ({ providerSessionId: entry.sessionId, title: entry.title || fallbackTitle,
        createdAt: normalizeDate(entry.createdAt ?? entry.updatedAt),
        updatedAt: entry.updatedAt == null ? new Date(0).toISOString() : normalizeDate(entry.updatedAt),
        updatedAtKnown: entry.updatedAt != null })), pageSize),
    nextCursor: historyCursor(page.nextCursor), coverage: { scopeComplete: false, snapshotId: null },
  };
}
