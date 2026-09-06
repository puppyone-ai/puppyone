/**
 * Canonical text mutation semantics shared by live projection and replay
 * checkpointing. Adapters describe facts; consumers do not reinterpret them.
 */
export function agentEventContentUpdate(event) {
  switch (event?.type) {
    case "assistant.delta":
      return { field: "delta", mode: "append" };
    case "reasoning.summary.delta":
      return { field: "delta", mode: event.payload?.updateMode === "replace" ? "replace" : "append" };
    case "plan.updated":
      return {
        field: "text",
        mode: event.payload?.updateMode === "append" || event.payload?.streaming === true ? "append" : "replace",
      };
    case "command.output.delta":
      return { field: "delta", mode: "append" };
    default:
      return null;
  }
}

/** Applies one canonical content mutation with the same bounded semantics everywhere. */
export function applyAgentEventContentUpdate(current, event, limit) {
  const update = agentEventContentUpdate(event);
  if (!update) return null;
  const existing = typeof current === "string" ? current : "";
  const incoming = typeof event?.payload?.[update.field] === "string" ? event.payload[update.field] : "";
  const combined = update.mode === "replace" ? incoming : `${existing}${incoming}`;
  const boundedLimit = Number.isSafeInteger(limit) && limit >= 0 ? limit : combined.length;
  return {
    ...update,
    text: combined.slice(0, boundedLimit),
    truncated: combined.length > boundedLimit,
  };
}
