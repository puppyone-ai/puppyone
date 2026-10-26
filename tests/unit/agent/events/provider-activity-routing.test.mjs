import { describe, expect, it } from "vitest";
import { AgentSessionActor } from "../../../../electron/main/agent/domain/agent-session-actor.mjs";
import { createAgentEventEnvelope } from "../../../../electron/main/agent/agent-events.mjs";
import { applyAgentEvents, createAgentProjection } from "../../../../electron/main/agent/domain/transcript/transcript-reducer.mjs";
import { normalizeClaudeMessage } from "../../../../electron/main/agent/runtimes/claude/claude-events.mjs";
import { normalizeItemLifecycle } from "../../../../electron/main/agent/runtimes/codex/codex-events.mjs";
import { normalizePiHistory } from "../../../../electron/main/agent/protocols/pi-rpc/pi-event-normalizer.mjs";
import { foldAgentEventCheckpoint } from "../../../../electron/main/agent/domain/agent-event-checkpoint.mjs";
import { applyAgentDisplayPatch, createAgentDisplayPatch } from "../../../../shared/agent-contract/display-state.mjs";
import { assertAgentDisplay, assertAgentDisplayPatch } from "../../../../shared/agent-contract/display-schema.mjs";

function envelope(sequence, type, payload, itemId = "item", turnId = "turn") {
  return createAgentEventEnvelope({ sequence, type, payload, itemId, turnId, sessionId: "session", runtimeId: "pi" });
}
function commit(actor, event) {
  actor.appendEvent({ sessionId: "session", runtimeId: "pi", event });
}

describe("Provider activity routing", () => {
  it.each(["info", "warning", "error"])("preserves %s notification text through sanitization, snapshots and replay", severity => {
    const actor = new AgentSessionActor();
    commit(actor, { type: "turn.started", turnId: "turn", payload: { prompt: "Hello" } });
    const before = actor.display;
    const notice = { type: "provider.notification", turnId: "turn", itemId: "notice", payload: { message: "A useful notice", severity, source: "Extension" } };
    commit(actor, notice);
    commit(actor, notice);
    expect(actor.display.activities).toHaveLength(1);
    expect(actor.display.activities[0]).toMatchObject({ kind: "notification", label: "A useful notice", detail: { severity, source: "Extension" } });
    expect(actor.control.execution.status).toBe("active");
    const patch = createAgentDisplayPatch(before, actor.display);
    assertAgentDisplayPatch(patch);
    const replica = applyAgentDisplayPatch(before, patch);
    assertAgentDisplay(replica);
    expect(replica).toEqual(actor.display);
    const replay = applyAgentEvents(createAgentProjection(), actor.events());
    expect(replay.activities).toEqual(actor.display.activities);
    expect(replay.rows.map(row => row.kind)).toEqual(["user"]);
    expect(actor.events().reduce(foldAgentEventCheckpoint, []).some(event => event.type === "provider.notification")).toBe(false);
  });

  it("isolates late and reused notice identities without inventing turns or changing the active turn", () => {
    const actor = new AgentSessionActor();
    commit(actor, { type: "turn.started", turnId: "current", payload: {} });
    for (const turnId of ["older", "current", null]) commit(actor, {
      type: "provider.notification", turnId, itemId: "reused", payload: { severity: "error", message: "Extension failed" },
    });
    expect(actor.display.activities).toHaveLength(3);
    expect(actor.display.turns.map(turn => turn.id)).toEqual(["current"]);
    expect(actor.control.execution.activeTurnId).toBe("current");
    expect(actor.control.execution.status).toBe("active");
  });

  it("bounds auxiliary notices without consuming transcript geometry or tool identity", () => {
    const actor = new AgentSessionActor();
    commit(actor, { type: "tool.completed", turnId: "turn", itemId: "notice-0", payload: { tool: "custom", status: "completed" } });
    for (let i = 0; i < 80; i++) commit(actor, {
      type: "provider.notification", turnId: "turn", itemId: `notice-${i}`, payload: { severity: "info", message: `Notice ${i}` },
    });
    expect(actor.display.activities.filter(activity => activity.kind === "notification")).toHaveLength(32);
    expect(actor.display.activities.find(activity => activity.kind === "tool")).toBeDefined();
    expect(actor.display.rows.map(row => row.kind)).toEqual(["tool"]);
    expect(actor.display.parts).toHaveLength(33);
    assertAgentDisplay(actor.display);
  });

  it("routes legacy notifications and unrecognized provider statuses away from tools", () => {
    const display = applyAgentEvents(createAgentProjection(), [
      envelope(1, "provider.activity", { message: "Old notification", label: "Pi extension", status: "completed" }, "pi:extension:old"),
      envelope(2, "provider.activity", { message: "A future status", status: "teleporting", tool: "not-a-call" }, "future"),
    ]);
    expect(display.activities.map(activity => activity.kind)).toEqual(["notification", "system"]);
    expect(display.activities.map(activity => activity.label)).toEqual(["Old notification", "A future status"]);
    expect(display.rows).toEqual([]);
    expect(display.turns).toEqual([]);
  });

  it.each(["started", "completed"])("routes Codex compaction %s as a system activity, including older journals", phase => {
    const [event] = normalizeItemLifecycle({ id: "compact", type: "contextCompaction" }, phase, "native", "turn");
    const current = applyAgentEvents(createAgentProjection(), [envelope(1, event.type, event.payload, event.itemId)]);
    const old = applyAgentEvents(createAgentProjection(), [envelope(1, `tool.${phase}`, { kind: "system", tool: "compaction", status: phase === "started" ? "running" : "completed" }, "compact")]);
    for (const display of [current, old]) {
      expect(display.activities[0]).toMatchObject({ kind: "system", detail: { category: "compaction" } });
      expect(display.rows.map(row => row.kind)).toEqual(["system"]);
    }
  });

  it("does not invent successful compaction from a completed parent turn or merge separate turns", () => {
    const display = applyAgentEvents(createAgentProjection(), [
      envelope(1, "provider.activity", { category: "compaction", status: "running" }, "pi:compaction", "turn-1"),
      envelope(2, "turn.completed", {}, null, "turn-1"),
      envelope(3, "provider.activity", { category: "compaction", status: "completed" }, "pi:compaction", "turn-2"),
    ]);
    expect(display.activities.map(activity => activity.status)).toEqual(["unknown", "completed"]);
    expect(display.parts.map(part => part.status)).toEqual(["unknown", "completed"]);
    expect(display.rows).toHaveLength(2);
  });

  it.each(["running", "completed", "failed"])("routes Claude authentication %s as session status", status => {
    const [event] = normalizeClaudeMessage({ type: "auth_status", isAuthenticating: status === "running", error: status === "failed" ? "Authentication failed" : null, output: ["Authentication update"] }, { turnId: "turn" });
    expect(event).toMatchObject({ type: "provider.activity", turnId: null, payload: { category: "authentication", status } });
    const display = applyAgentEvents(createAgentProjection(), [envelope(1, event.type, event.payload, event.itemId, event.turnId)]);
    expect(display.rows).toEqual([]);
    expect(display.activities[0].label).toBe(status === "failed" ? "Authentication failed" : "Authentication update");
  });

  it("restores native Pi history without synthesizing transient notifications", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "Hello" }] }, { role: "assistant", content: [{ type: "text", text: "Hi" }], stopReason: "stop" }];
    const events = normalizePiHistory(messages, "native");
    const display = applyAgentEvents(createAgentProjection(), events.map((event, index) => envelope(index + 1, event.type, event.payload, event.itemId, event.turnId)));
    expect(display.activities).toEqual([]);
    expect(display.messages.map(message => message.text)).toEqual(["Hello", "Hi"]);
  });

  it.each([{ severity: "success", message: "Notice" }, { severity: "info", message: "" }])("rejects malformed notification contracts", payload => {
    expect(() => envelope(1, "provider.notification", payload)).toThrow();
  });
});
