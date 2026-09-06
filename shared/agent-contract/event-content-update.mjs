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
