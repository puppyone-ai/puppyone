import type { AgentTurnTerminalState } from "../domain/agent-contract";
import { useLocalization } from "@puppyone/localization/react";
import { formatAgentDuration } from "../domain/agent-activity-presentation";
import { AgentRunFeedback } from "./AgentRunFeedback";

type AgentTurnSummaryProps = {
  durationMs: number;
  status: AgentTurnTerminalState;
};

/** Quiet end-of-turn metadata. It is derived from normalized lifecycle events, never model text. */
export function AgentTurnSummary({ durationMs, status }: AgentTurnSummaryProps) {
  const { t, formatNumber } = useLocalization();
  const duration = formatAgentDuration(durationMs, t, formatNumber);
  return <AgentRunFeedback className="desktop-agent-turn-summary" status={status}
    label={t("agent.turn.workedFor", { duration })} />;
}
