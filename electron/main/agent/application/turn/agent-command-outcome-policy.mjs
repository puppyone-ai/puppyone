/**
 * Native request failures are either authoritative rejections or ambiguous
 * delivery failures. Only the native boundary may mark delivery as unknown;
 * message-text guessing would make protocol and mock behavior diverge.
 */
export function isAgentDeliveryOutcomeUnknown(error) {
  return error?.deliveryOutcome === "unknown" || [
    "JSONL_RPC_TIMEOUT",
    "JSONL_RPC_DELIVERY_UNKNOWN",
    "PI_RPC_TIMEOUT",
    "PI_RPC_DELIVERY_UNKNOWN",
  ].includes(error?.code);
}

export function agentDeliveryOutcomeUnknownError(message) {
  const error = new Error(message);
  error.name = "AgentDeliveryOutcomeUnknownError";
  error.code = "AGENT_DELIVERY_UNKNOWN";
  error.deliveryOutcome = "unknown";
  return error;
}
