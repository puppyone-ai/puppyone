import path from "node:path";
import { historyCursor, historyLocators, historyNativeId, historyPageSize } from "../../../../../shared/agent-contract/history-schema.mjs";
import { normalizeDate } from "./claude-native-values.mjs";

export async function discoverClaudeHistory({ sdk, workspaceRoot }, { cursor = null, limit, signal } = {}) {
  signal?.throwIfAborted();
  if (typeof sdk.listSessions !== "function") return { supported: false, sessions: [], nextCursor: null };
  const token = historyCursor(cursor);
  const offset = token === null ? 0 : Number(token);
  if (token !== null && (!/^\d+$/.test(token) || !Number.isSafeInteger(offset))) {
    throw Object.assign(new TypeError("Claude history continuation is invalid. Refresh history."), { retryable: false });
  }
  const pageSize = historyPageSize(limit);
  const page = await sdk.listSessions({ dir: workspaceRoot, limit: pageSize, offset });
  signal?.throwIfAborted();
  if (!Array.isArray(page) || page.length > pageSize || page.some((entry) => !historyNativeId(entry?.sessionId))) {
    throw new TypeError("Claude history returned an invalid session page.");
  }
  return {
    supported: true,
    sessions: historyLocators(page.filter((entry) => !entry.cwd || path.resolve(entry.cwd) === workspaceRoot)
      .map((entry) => ({ providerSessionId: entry.sessionId,
        title: entry.customTitle || entry.summary || entry.firstPrompt || "Claude Code session",
        createdAt: normalizeDate(entry.createdAt ?? entry.lastModified), updatedAt: normalizeDate(entry.lastModified) })), pageSize),
    // Advance by the raw SDK page, even if workspace filtering removed every entry.
    nextCursor: page.length === pageSize ? String(offset + page.length) : null,
    coverage: { scopeComplete: false, snapshotId: null },
  };
}
