import type { AgentTurnCompletionQuality, AgentTurnTerminalState } from "../domain/agent-contract";
import { useLocalization } from "@puppyone/localization/react";
import { formatAgentDuration } from "../domain/agent-activity-presentation";
import { AgentRunFeedback } from "./AgentRunFeedback";

type AgentTurnSummaryProps = {
  durationMs: number;
  status: AgentTurnTerminalState;
  completionQuality?: AgentTurnCompletionQuality;
};

/** Quiet end-of-turn metadata. It is derived from normalized lifecycle events, never model text. */
export function AgentTurnSummary({ durationMs, status, completionQuality }: AgentTurnSummaryProps) {
  const { t, formatNumber } = useLocalization();
  const duration = formatAgentDuration(durationMs, t, formatNumber);
  const degraded = completionQuality === "degraded";
  return <AgentRunFeedback className="desktop-agent-turn-summary" status={degraded ? "degraded" : status}
    label={degraded
      ? t("agent.recovery.degraded.turnSummary", { duration })
      : t("agent.turn.workedFor", { duration })} />;
}
