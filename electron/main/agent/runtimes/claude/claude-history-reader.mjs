import { normalizeClaudeHistory } from "./claude-events.mjs";
import { agentHistoryReadResult } from "../../runtime/agent-history-read-result.mjs";

export async function readClaudeHistory({ sdk, workspaceRoot, providerSessionId }) {
  const messages = await sdk.getSessionMessages(providerSessionId, {
    dir: workspaceRoot, limit: 1000, includeSystemMessages: false,
  });
  if (!Array.isArray(messages)) throw new TypeError("Claude Code returned an invalid history snapshot.");
  return agentHistoryReadResult({ providerSessionId,
    events: normalizeClaudeHistory(messages, providerSessionId),
    coverage: messages.length >= 1000 ? "partial" : "complete",
    reason: messages.length >= 1000 ? "read-limit" : null,
  });
}
