import type { AgentProjection, AgentTurn, AgentTurnRecovery } from "./agent-projection-types";

export type ActiveAgentDegradedRecovery = {
  turnId: string;
  recovery: AgentTurnRecovery;
};

/** Only the latest settled turn may offer an active continuation action. */
export function activeAgentDegradedRecovery(
  projection: AgentProjection,
): ActiveAgentDegradedRecovery | null {
  if (projection.runningTurnId) return null;
  const latestTurn: AgentTurn | undefined = projection.turns.at(-1);
  if (latestTurn?.status !== "completed"
    || latestTurn.completionQuality !== "degraded"
    || latestTurn.recovery?.kind !== "degraded-completion") return null;
  return { turnId: latestTurn.id, recovery: latestTurn.recovery };
}
