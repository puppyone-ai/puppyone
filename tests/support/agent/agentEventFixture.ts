import type { AgentEvent, AgentEventEnvelope, AgentEventPayloadMap, AgentEventType } from "../../../shared/agent-contract/types";

export type { AgentEventPayloadMap };

/** Keep discriminator/payload correlation while permitting opaque provider metadata. */
export function defineAgentEvent<T extends AgentEventType>(
  event: AgentEventEnvelope<T> & { payload: AgentEventPayloadMap[T] & Record<string, unknown> },
): AgentEvent<T> {
  // TypeScript cannot reduce the conditional union for a still-generic T.
  // The envelope above checks every field and the matching payload before this cast.
  return event as AgentEvent<T>;
}
