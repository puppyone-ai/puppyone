import { describe, expect, it } from "vitest";
import { AgentSessionActor } from "../electron/main/agent/domain/agent-session-actor.mjs";
import { applyAgentDisplayPatch } from "../shared/agent-contract/display-state.mjs";
import { assertAgentDisplay, assertAgentDisplayPatch } from "../shared/agent-contract/display-schema.mjs";
import { agentHistoryReadResult } from "../electron/main/agent/runtime/agent-history-read-result.mjs";

const append = (actor, event) => actor.appendEvent({ sessionId: "product", runtimeId: "codex", providerSessionId: "native", event });

describe("Native history coverage, event replay and display window", () => {
  it.each(["partial", "unknown"])("clears %s coverage through a committed display patch after complete recovery", (coverage) => {
    const actor = new AgentSessionActor({ sequence: 42 });
    let replica = actor.display;
    actor.subscribe((commit) => {
      assertAgentDisplayPatch(commit.displayPatch);
      replica = applyAgentDisplayPatch(replica, commit.displayPatch);
      assertAgentDisplay(replica);
    });
    append(actor, { type: "assistant.completed", turnId: "turn", itemId: "answer", payload: { text: "Recovered answer" } });
    actor.dispatch({ type: "history.loaded", coverage, reason: "unverified" });
    expect(replica.history.coverage).toBe(coverage);
    const messages = replica.messages;
    actor.dispatch({ type: "history.loaded", coverage: "complete" });
    expect(replica.history).toEqual({ coverage: "complete", reason: null });
    expect(replica.messages).toEqual(messages);
    expect(replica.missingRanges).toEqual([]);
    expect(actor.sequence).toBe(43);
  });

  it("does not clear real display truncation when native history is complete", () => {
    const actor = new AgentSessionActor();
    for (let i = 0; i < 50; i++) append(actor, {
      type: "assistant.completed", turnId: "turn", itemId: `answer-${i}`, payload: { text: "中".repeat(60_000) },
    });
    expect(actor.display.displayWindow.truncated).toBe(true);
    actor.dispatch({ type: "history.loaded", coverage: "complete" });
    expect(actor.display.history.coverage).toBe("complete");
    expect(actor.display.displayWindow.truncated).toBe(true);
    expect(actor.display.messages.at(-1).itemId).toBe("answer-49");
  });

  it("keeps native coverage independent of lost live execution observation", () => {
    const actor = new AgentSessionActor();
    actor.dispatch({ type: "adapter.attached" });
    actor.dispatch({ type: "history.loaded", coverage: "complete" });
    append(actor, { type: "turn.started", turnId: "active", payload: {} });
    actor.dispatch({ type: "adapter.exited", adapterGeneration: actor.control.adapterGeneration, reason: "connection-lost" });
    expect(actor.display.history.coverage).toBe("complete");
    expect(actor.control.execution.status).toBe("outcome-unknown");
  });

  it("rejects contradictory or invalid native coverage reasons", () => {
    const result = { providerSessionId: "native", events: [] };
    expect(() => agentHistoryReadResult({ ...result, coverage: "complete", reason: "read-limit" })).toThrow(/Complete history/);
    expect(() => agentHistoryReadResult({ ...result, coverage: "partial", reason: "anything" })).toThrow(/coverage reason/);
    expect(agentHistoryReadResult({ ...result, coverage: "unknown" })).toMatchObject({ reason: "unverified" });
  });
});
