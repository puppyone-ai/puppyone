import { nativeSessionId } from "../../../../shared/agent-contract/native-session-id.mjs";

/** A native read describes content coverage; it never invents an execution outcome. */
export function agentHistoryReadResult({ providerSessionId, events, coverage = "unknown", reason = null }) {
  if (!nativeSessionId(providerSessionId) || !Array.isArray(events) || events.length > 10000
    || !["complete", "partial", "unknown"].includes(coverage)) throw new TypeError("Native history returned an invalid read result.");
  if (reason !== null && !["read-limit", "replay-unverified", "unsupported", "unverified"].includes(reason)) {
    throw new TypeError("Native history returned an invalid coverage reason.");
  }
  if (coverage === "complete" && reason !== null) throw new TypeError("Complete history cannot have a missing-content reason.");
  for (const event of events) {
    if (!event || typeof event.type !== "string" || (event.providerSessionId != null && event.providerSessionId !== providerSessionId)) {
      throw new TypeError("Native history returned content for a different conversation.");
    }
  }
  return { providerSessionId, events, coverage, reason: coverage === "complete" ? null : reason ?? "unverified" };
}

export function assertAgentHistoryReadResult(value, providerSessionId) {
  const result = agentHistoryReadResult(value ?? {});
  if (result.providerSessionId !== providerSessionId) throw new TypeError("Native history does not match the opened conversation.");
  return result;
}
