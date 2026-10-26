import { describe, expect, it } from "vitest";
import { createPiEventState, normalizePiRpcEvent } from "../../../../../electron/main/agent/protocols/pi-rpc/pi-event-normalizer.mjs";

const failed = (errorMessage = "fetch failed") => ({ role: "assistant", content: [], stopReason: "error", errorMessage });
const answer = { role: "assistant", content: [{ type: "text", text: "Recovered" }], stopReason: "stop" };
function settle(messages, { interruptRequested = false } = {}) {
  const state = createPiEventState({ turnId: "turn", providerSessionId: "session" });
  state.interruptRequested = interruptRequested;
  const events = messages.flatMap(message => normalizePiRpcEvent(message, state));
  expect(events.some(event => ["turn.completed", "turn.failed", "turn.interrupted"].includes(event.type))).toBe(false);
  const terminal = normalizePiRpcEvent({ type: "agent_settled" }, state);
  expect(normalizePiRpcEvent({ type: "agent_settled" }, state)).toEqual([]);
  return terminal;
}

describe("Pi authoritative model outcome across retry attempts", () => {
  it("uses the final agent_end outcome when a failed attempt later succeeds", () => {
    expect(settle([
      { type: "agent_end", messages: [failed()], willRetry: true },
      { type: "auto_retry_start", attempt: 1, maxAttempts: 3 },
      { type: "auto_retry_end", success: true },
      { type: "agent_end", messages: [answer], willRetry: false },
    ])).toEqual([expect.objectContaining({ type: "turn.completed" })]);
  });

  it("reports exhausted retries and their final error", () => {
    expect(settle([
      { type: "message_end", message: failed() },
      { type: "auto_retry_end", success: false, finalError: "Retries exhausted" },
    ])).toContainEqual(expect.objectContaining({ type: "turn.failed", payload: { status: "failed", message: "Retries exhausted" } }));
  });

  it("retains a later failure after an earlier model request recovered", () => {
    expect(settle([
      { type: "message_end", message: failed() },
      { type: "message_end", message: answer },
      { type: "auto_retry_end", success: true },
      { type: "tool_execution_start", toolCallId: "tool", toolName: "read", args: { path: "README.md" } },
      { type: "tool_execution_end", toolCallId: "tool", isError: false },
      { type: "message_end", message: failed("Final request failed") },
      { type: "agent_end", messages: [answer, failed("Final request failed")] },
    ])).toContainEqual(expect.objectContaining({ type: "turn.failed", payload: { status: "failed", message: "Final request failed" } }));
  });

  it("does not treat retry success as proof that an aborted assistant succeeded", () => {
    expect(settle([
      { type: "message_end", message: { role: "assistant", content: [], stopReason: "aborted" } },
      { type: "auto_retry_end", success: true },
    ])).toContainEqual(expect.objectContaining({ type: "turn.failed" }));
  });

  it("does not erase a separate compaction failure when the model retry succeeds", () => {
    expect(settle([
      { type: "compaction_end", errorMessage: "Compaction failed" },
      { type: "message_end", message: answer },
      { type: "auto_retry_end", success: true },
      { type: "agent_end", messages: [answer] },
    ])).toContainEqual(expect.objectContaining({ type: "turn.failed", payload: { status: "failed", message: "Compaction failed" } }));
  });

  it("keeps an explicit interrupt authoritative while retry is cancelled", () => {
    expect(settle([{ type: "auto_retry_end", success: false, finalError: "Retry cancelled" }], { interruptRequested: true }))
      .toEqual([expect.objectContaining({ type: "turn.interrupted" })]);
  });
});
