import type { AgentProjection } from "../domain/agent-projection-types";

const REASON_KEYS = {
  "read-limit": "agent.transcript.historyReason.readLimit",
  "replay-unverified": "agent.transcript.historyReason.unverified",
  unsupported: "agent.transcript.historyReason.unsupported",
  unverified: "agent.transcript.historyReason.unverified",
} as const;

/** Local replay gaps do not establish that native chat messages were lost. */
export function agentHistoryNotice(display: Pick<AgentProjection, "history" | "displayWindow">) {
  const { history, displayWindow } = display;
  const limited = history.coverage === "partial" || history.coverage === "unknown";
  if (!displayWindow.truncated && !limited) return null;
  return {
    kind: displayWindow.truncated ? "window" : history.coverage,
    messageKey: displayWindow.truncated ? "agent.transcript.historyWindow"
      : history.coverage === "partial" ? "agent.transcript.historyPartial" : "agent.transcript.historyUnknown",
    reasonKeys: [
      ...(displayWindow.truncated ? ["agent.transcript.historyReason.displayWindow"] : []),
      ...(limited ? [REASON_KEYS[history.reason ?? "unverified"]] : []),
    ],
  };
}
