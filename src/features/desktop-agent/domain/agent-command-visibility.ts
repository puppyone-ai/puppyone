import type { AgentSessionControl } from "./agent-contract";
import type { AgentTranscriptMessage } from "./agent-projection-types";

type AgentControlCommand = AgentSessionControl["commands"][number];

/**
 * Selects command intents that still need a transcript fallback. A canonical
 * user message is the durable content source once it exists; command control
 * records cover queued and unconfirmed delivery without inventing success or
 * triggering a retry.
 */
export function agentStartCommandNeedsTranscriptFallback(
  command: AgentControlCommand,
  messages: AgentTranscriptMessage[],
  pendingSubmissionCommandId: string | null = null,
  activeTurnId: string | null = null,
) {
  if (command.kind !== "start" || !command.intent) return false;
  if (command.commandId === pendingSubmissionCommandId) return false;
  const hasCanonicalMessage = messages.some((message) => (
    message.role === "user" && (
      (Boolean(command.userMessageId) && message.itemId === command.userMessageId)
      || (Boolean(command.targetTurnId) && message.turnId === command.targetTurnId)
    )
  ));
  if (hasCanonicalMessage) return false;
  if (command.status === "queued" || command.status === "dispatching" || command.status === "outcome-unknown") {
    return true;
  }
  if (command.status === "accepted" && command.targetTurnId === activeTurnId) return true;
  return command.wasQueued && (command.status === "rejected" || command.status === "cancelled");
}
