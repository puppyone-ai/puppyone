import type { AgentSessionControl } from "../domain/agent-contract";
import type { AgentProjection } from "../domain/agent-projection-types";

/**
 * Applies Main's authoritative control snapshot to the reconstructable content
 * projection. Content events may describe messages and activities, but they do
 * not get a second vote on current execution or transport state.
 */
export function reconcileAgentProjectionWithControl(
  projection: AgentProjection,
  control: AgentSessionControl,
): AgentProjection {
  const activeTurnId = control.execution.activeTurnId;
  return {
    ...projection,
    runningTurnId: activeTurnId,
    terminalState: activeTurnId ? null : control.execution.nativeOutcome ?? projection.terminalState,
    connectionStatus: control.connection.status === "recovering"
      ? {
          state: control.connection.recoveryState ?? "reconnecting",
          message: control.connection.reason ?? "",
          attempt: control.connection.attempt ?? null,
          maxAttempts: control.connection.maxAttempts ?? null,
          turnId: activeTurnId,
          sequence: projection.lastSequence,
        }
      : null,
  };
}
