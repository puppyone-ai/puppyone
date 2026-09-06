import { describe, expect, it, vi } from "vitest";
import { AgentSessionActor } from "../electron/main/agent/domain/agent-session-actor.mjs";
import { createAgentSessionControl, reduceAgentSessionControl } from "../electron/main/agent/domain/agent-session-control.mjs";
import { agentSessionFeedLimits } from "../electron/main/agent/application/session/agent-session-feed.mjs";
import { normalizeCodexNotification, normalizeHistoricalThread } from "../electron/main/agent/runtimes/codex/codex-app-server-adapter.mjs";
import { assertAgentSessionControl } from "../shared/agent-contract/schema.mjs";
import { createSender, createServiceHarness } from "./helpers/agentServiceHarness.mjs";

function nativeEvent(type, turnId, payload = {}) {
  return { type, turnId, providerSessionId: "thread-1", payload };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

describe("Main Agent SessionActor and versioned feed", () => {
  it("keeps stale terminal facts scoped to their own turn", () => {
    const actor = new AgentSessionActor();
    const append = (event) => actor.appendEvent({ sessionId: "session-1", runtimeId: "codex", providerSessionId: "thread-1", event });
    append(nativeEvent("turn.started", "A"));
    append(nativeEvent("turn.interrupted", "A"));
    append(nativeEvent("turn.started", "B"));
    append(nativeEvent("turn.completed", "A"));

    expect(actor.control.execution).toMatchObject({ status: "active", activeTurnId: "B" });
    expect(actor.control.terminalTurns).toEqual(expect.arrayContaining(["A"]));
  });

  it("keeps a newer submission when an older turn terminal or request rejection arrives late", async () => {
    const harness = createServiceHarness();
    const owner = createSender(506);
    const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    const adapter = harness.adapters[0];
    const firstReply = deferred();
    const secondReply = deferred();
    adapter.startTurn.mockImplementationOnce(() => {
      adapter.emit(nativeEvent("turn.started", "A"));
      return firstReply.promise;
    });
    const first = harness.service.startTurn(owner, {
      sessionId: created.session.id, prompt: "first", commandId: "late-A",
    }, "/workspace").catch(() => undefined);
    adapter.emit(nativeEvent("turn.completed", "A"));
    adapter.startTurn.mockImplementationOnce(() => secondReply.promise);
    const second = harness.service.startTurn(owner, {
      sessionId: created.session.id, prompt: "second", commandId: "current-B",
    }, "/workspace");

    adapter.emit(nativeEvent("turn.completed", "A"));
    firstReply.reject(new Error("late transport rejection"));
    await first;
    const observed = harness.service.replay(owner, {
      sessionId: created.session.id, afterSequence: 0,
    }, "/workspace").control;
    expect(observed.execution.status).toBe("starting");
    expect(observed.pendingSubmission).toMatchObject({ commandId: "current-B", prompt: "second" });

    secondReply.resolve({ turnId: "B" });
    await second;
  });

  it("uses one deterministic pure reducer for live folding and offline reconstruction", () => {
    const inputs = [
      { type: "adapter.attached" },
      { type: "command.received", command: { commandId: "command-1", kind: "start", status: "dispatching", intentFingerprint: "fingerprint-1", intent: { prompt: "hello", promptMentions: [], referenceDisplays: [], model: null, effort: null, mode: null } } },
      { type: "command.dispatching", commandId: "command-1", operationId: "operation-1" },
      { type: "submission.prepared", submission: { commandId: "command-1", operationId: "operation-1", adapterGeneration: 1, prompt: "hello", promptMentions: [], referenceDisplays: [] }, startedAtMs: 100 },
      { type: "event.accepted", event: { ...nativeEvent("turn.started", "A"), emittedAt: "2026-09-06T00:00:00.000Z" } },
      { type: "event.accepted", event: { ...nativeEvent("turn.completed", "A"), emittedAt: "2026-09-06T00:00:01.000Z" } },
      { type: "command.accepted", commandId: "command-1", turnId: "A" },
    ];
    const initial = createAgentSessionControl({ streamId: "stream-1", sessionEpoch: "epoch-1" });
    const live = inputs.reduce(reduceAgentSessionControl, initial);
    const rebuilt = inputs.reduce(reduceAgentSessionControl, initial);
    expect(rebuilt).toEqual(live);
    expect(Object.isFrozen(rebuilt)).toBe(true);
    expect(rebuilt.execution).toMatchObject({ status: "ended", nativeOutcome: "completed" });
  });

  it("records a late command ACK without resurrecting completed execution", () => {
    const actor = new AgentSessionActor();
    actor.dispatch({ type: "adapter.attached" });
    actor.dispatch({ type: "command.received", command: { commandId: "command-1", kind: "start", status: "dispatching", intentFingerprint: "fingerprint-1", intent: { prompt: "hello", promptMentions: [], referenceDisplays: [], model: null, effort: null, mode: null } } });
    actor.dispatch({ type: "command.dispatching", commandId: "command-1", operationId: "operation-1" });
    actor.dispatch({ type: "submission.prepared", submission: { commandId: "command-1", operationId: "operation-1", adapterGeneration: 1, prompt: "hello", promptMentions: [], referenceDisplays: [] } });
    actor.appendEvent({ sessionId: "session-1", runtimeId: "codex", providerSessionId: "thread-1", event: nativeEvent("turn.started", "A") });
    actor.appendEvent({ sessionId: "session-1", runtimeId: "codex", providerSessionId: "thread-1", event: nativeEvent("turn.completed", "A") });
    actor.dispatch({ type: "command.accepted", commandId: "command-1", turnId: "A" });

    expect(actor.control.execution).toMatchObject({ status: "ended", activeTurnId: null, nativeOutcome: "completed" });
    expect(actor.control.commands.find((entry) => entry.commandId === "command-1")?.status).toBe("accepted");
    const revision = actor.control.revision;
    actor.dispatch({ type: "command.accepted", commandId: "command-1", turnId: "A" });
    expect(actor.control.revision).toBe(revision);
  });

  it("keeps an unconfirmed active outcome unknown when the product session closes", () => {
    const actor = new AgentSessionActor();
    actor.appendEvent({ sessionId: "session-1", runtimeId: "codex", event: nativeEvent("turn.started", "A") });
    actor.appendEvent({
      sessionId: "session-1",
      runtimeId: "codex",
      event: { type: "session.closed", providerSessionId: "thread-1", payload: { status: "closed" } },
    });

    expect(actor.control.execution).toMatchObject({
      status: "outcome-unknown",
      activeTurnId: null,
      uncertainTurnId: "A",
      nativeOutcome: null,
      certainty: "unknown",
    });
  });

  it("rejects receipts from an older adapter generation", () => {
    const actor = new AgentSessionActor();
    actor.dispatch({ type: "adapter.attached" });
    actor.dispatch({ type: "adapter.attached" });
    const revision = actor.control.revision;

    actor.dispatch({ type: "adapter.exited", adapterGeneration: 1, reason: "late-exit" });

    expect(actor.control.revision).toBe(revision);
    expect(actor.control.connection.status).toBe("connected");
  });

  it("settles in-flight commands when an adapter generation is replaced", () => {
    const actor = new AgentSessionActor();
    actor.dispatch({ type: "adapter.attached" });
    actor.dispatch({ type: "command.received", command: { commandId: "replace-me", kind: "steer", status: "dispatching", intentFingerprint: "fingerprint-1" } });
    actor.dispatch({ type: "command.dispatching", commandId: "replace-me", operationId: "operation-old" });

    actor.dispatch({ type: "adapter.attached" });
    actor.dispatch({ type: "command.accepted", commandId: "replace-me", operationId: "operation-old", turnId: "A" });

    expect(actor.control.commands.find((entry) => entry.commandId === "replace-me")).toMatchObject({
      status: "outcome-unknown",
      error: "adapter-generation-changed",
    });
  });

  it("does not infer a live turn from persisted or restored history", () => {
    const historicalStart = {
      schemaVersion: 1,
      sequence: 1,
      sessionId: "session-1",
      runtimeId: "codex",
      provider: "codex",
      providerSessionId: "thread-1",
      turnId: "A",
      itemId: null,
      emittedAt: "2026-09-06T00:00:00.000Z",
      type: "turn.started",
      payload: { status: "running" },
    };
    const restored = new AgentSessionActor({ events: [historicalStart], sequence: 1, terminalState: "running" });
    expect(restored.control.execution).toMatchObject({ status: "outcome-unknown", activeTurnId: null, uncertainTurnId: "A", certainty: "unknown" });
    restored.appendEvent({
      sessionId: "session-1",
      runtimeId: "codex",
      providerSessionId: "thread-1",
      event: nativeEvent("turn.completed", "A", { status: "completed", restored: true }),
    });
    expect(restored.control.execution).toMatchObject({ status: "ended", uncertainTurnId: null, nativeOutcome: "completed", certainty: "confirmed" });

    const live = new AgentSessionActor();
    live.appendEvent({
      sessionId: "session-1",
      runtimeId: "codex",
      providerSessionId: "thread-1",
      event: nativeEvent("turn.started", "A", { status: "running", restored: true }),
    });
    expect(live.control.execution.activeTurnId).toBeNull();
  });

  it("keeps metadata-only native running history explicitly unconfirmed", async () => {
    const historicalEvents = normalizeHistoricalThread({
      id: "thread-1",
      turns: [{ id: "A", status: "inProgress", items: [] }],
    });
    const harness = createServiceHarness({ historicalEvents });
    await harness.persistence.save({
      sessionId: "saved-running",
      workspaceRoot: "/workspace",
      runtimeId: "codex",
      providerSessionId: "thread-1",
      selectedModel: "gpt-5",
      terminalState: "running",
      lastSequence: 10,
      createdAt: "2026-01-01T00:00:00.000Z",
    }, { promoteCatalog: true });
    const restored = await harness.service.resumeSession(createSender(507), {
      sessionId: "saved-running", runtimeId: "codex",
    }, "/workspace");
    expect(restored.control.execution).toMatchObject({ status: "outcome-unknown", certainty: "unknown" });
  });

  it("bounds reconnect diagnostics before control state enters the feed", async () => {
    const harness = createServiceHarness();
    const owner = createSender(508);
    const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    const receipt = harness.service.attachSession(owner, { sessionId: created.session.id }, "/workspace");
    harness.service.acknowledgeSession(owner, {
      sessionId: created.session.id,
      subscriptionId: receipt.subscriptionId,
      ...receipt.snapshot.cursor,
    }, "/workspace");
    harness.adapters[0].emit(normalizeCodexNotification({
      method: "error",
      params: { threadId: "thread-1", willRetry: true, error: { message: "x".repeat(1_001) } },
    })[0]);
    const control = harness.service.replay(owner, {
      sessionId: created.session.id, afterSequence: 0,
    }, "/workspace").control;
    expect(() => assertAgentSessionControl(control)).not.toThrow();
    expect(control.connection.reason).toHaveLength(1_000);
  });

  it("materializes the evicted prefix of a long active turn", () => {
    const actor = new AgentSessionActor();
    const append = (event) => actor.appendEvent({ sessionId: "session-1", runtimeId: "codex", providerSessionId: "thread-1", event });
    append(nativeEvent("turn.started", "A", { status: "running" }));
    append({ ...nativeEvent("approval.requested", "A", { requestId: "approval-A", kind: "command" }), itemId: "tool-A" });
    for (let index = 0; index < 1_100; index += 1) {
      append({ ...nativeEvent("assistant.delta", "A", { delta: "x" }), itemId: "message-A" });
    }

    const snapshot = actor.snapshot();
    expect(snapshot.timeline.events).toHaveLength(1_000);
    expect(snapshot.timeline.partial).toBe(true);
    expect(snapshot.timeline.checkpointEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "turn.started", turnId: "A" }),
      expect.objectContaining({ type: "approval.requested", payload: expect.objectContaining({ requestId: "approval-A" }) }),
      expect.objectContaining({ type: "assistant.delta", itemId: "message-A", payload: expect.objectContaining({ delta: "x".repeat(100) }) }),
    ]));
    expect(snapshot.control.execution).toMatchObject({ status: "active", activeTurnId: "A" });
    expect(snapshot.control.interaction.approvals).toEqual([expect.objectContaining({ requestId: "approval-A", turnId: "A" })]);
  });

  it("accepts a command idempotently and rejects stale session generations", async () => {
    const harness = createServiceHarness();
    const owner = createSender(504);
    const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    const epoch = created.control.sessionEpoch;

    const first = await harness.service.startTurn(owner, {
      sessionId: created.session.id,
      prompt: "hello",
      commandId: "stable-command",
      expectedSessionEpoch: epoch,
    }, "/workspace");
    const duplicate = await harness.service.startTurn(owner, {
      sessionId: created.session.id,
      prompt: "hello",
      commandId: "stable-command",
      expectedSessionEpoch: epoch,
    }, "/workspace");
    expect(first.turnId).toBe("turn-1");
    expect(duplicate).toMatchObject({ commandId: "stable-command", deduplicated: true, deliveryStatus: "accepted" });
    expect(harness.adapters[0].startTurn).toHaveBeenCalledTimes(1);

    await expect(harness.service.startTurn(owner, {
      sessionId: created.session.id,
      prompt: "must not execute",
      commandId: "stable-command",
      expectedSessionEpoch: epoch,
    }, "/workspace")).rejects.toThrow(/different input/i);

    await expect(harness.service.startTurn(owner, {
      sessionId: created.session.id,
      prompt: "stale",
      commandId: "stale-command",
      expectedSessionEpoch: "older-epoch",
    }, "/workspace")).rejects.toThrow(/older session generation/i);
    expect(harness.adapters[0].startTurn).toHaveBeenCalledTimes(1);
  });

  it("captures a snapshot before releasing a contiguous feed", async () => {
    const harness = createServiceHarness();
    const owner = createSender(501);
    const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    const receipt = harness.service.attachSession(owner, { sessionId: created.session.id }, "/workspace");

    await harness.service.startTurn(owner, { sessionId: created.session.id, prompt: "hello", commandId: "command-start" }, "/workspace");
    expect(owner.send.mock.calls.filter(([channel]) => channel === "agent:session-frame")).toHaveLength(0);

    harness.service.acknowledgeSession(owner, {
      sessionId: created.session.id,
      subscriptionId: receipt.subscriptionId,
      streamId: receipt.snapshot.cursor.streamId,
      revision: receipt.snapshot.cursor.revision,
    }, "/workspace");
    const frames = owner.send.mock.calls
      .filter(([channel]) => channel === "agent:session-frame")
      .map(([, frame]) => frame);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0].baseRevision).toBe(receipt.snapshot.cursor.revision);
    for (let index = 1; index < frames.length; index += 1) {
      expect(frames[index].baseRevision).toBe(frames[index - 1].revision);
    }
    expect(frames.at(-1).control.execution.activeTurnId).toBe("turn-1");
  });

  it("owns follow-up queuing and advancement in Main", async () => {
    const harness = createServiceHarness({ capabilities: { queue: true } });
    const owner = createSender(502);
    const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    const adapter = harness.adapters[0];
    adapter.startTurn
      .mockImplementationOnce(async () => {
        adapter.emit(nativeEvent("turn.started", "A", { status: "running" }));
        return { turnId: "A" };
      })
      .mockImplementationOnce(async () => {
        adapter.emit(nativeEvent("turn.started", "B", { status: "running" }));
        return { turnId: "B" };
      });

    await harness.service.startTurn(owner, { sessionId: created.session.id, prompt: "first", commandId: "first" }, "/workspace");
    const queued = await harness.service.startTurn(owner, { sessionId: created.session.id, prompt: "second", commandId: "second" }, "/workspace");
    expect(queued).toMatchObject({ queued: true, commandId: "second" });
    expect(adapter.startTurn).toHaveBeenCalledTimes(1);

    adapter.emit(nativeEvent("turn.completed", "A", { status: "completed" }));
    await vi.waitFor(() => expect(adapter.startTurn).toHaveBeenCalledTimes(2));
    const replay = harness.service.replay(owner, { sessionId: created.session.id, afterSequence: 0 }, "/workspace");
    expect(replay.control.execution.activeTurnId).toBe("B");
    expect(replay.control.queue).toEqual([]);
  });

  it("cancels accepted-but-unsent queued input when its native session exits", async () => {
    const harness = createServiceHarness({ capabilities: { queue: true } });
    const owner = createSender(509);
    const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await harness.service.startTurn(owner, { sessionId: created.session.id, prompt: "first", commandId: "running" }, "/workspace");
    await harness.service.startTurn(owner, { sessionId: created.session.id, prompt: "queued text", commandId: "queued" }, "/workspace");

    harness.adapters[0].exit({ expected: false, diagnostics: "test exit" });
    const control = harness.service.replay(owner, {
      sessionId: created.session.id, afterSequence: 0,
    }, "/workspace").control;
    expect(control.queue).toEqual([]);
    expect(control.commands.find((command) => command.commandId === "queued")).toMatchObject({
      status: "cancelled",
      wasQueued: true,
      intent: { prompt: "queued text" },
    });
    expect(harness.adapters[0].startTurn).toHaveBeenCalledTimes(1);
  });

  it("bounds an acknowledged but stalled Renderer and requires resynchronization", async () => {
    const harness = createServiceHarness();
    const owner = createSender(503);
    const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    const receipt = harness.service.attachSession(owner, { sessionId: created.session.id }, "/workspace");
    harness.service.acknowledgeSession(owner, {
      sessionId: created.session.id,
      subscriptionId: receipt.subscriptionId,
      streamId: receipt.snapshot.cursor.streamId,
      revision: receipt.snapshot.cursor.revision,
    }, "/workspace");
    owner.send.mockClear();

    for (let index = 0; index <= agentSessionFeedLimits.maxPendingFrames; index += 1) {
      harness.adapters[0].emit({
        type: "provider.activity",
        providerSessionId: "thread-1",
        payload: { status: "running", label: `activity-${index}` },
      });
    }

    const frames = owner.send.mock.calls.filter(([channel]) => channel === "agent:session-frame").map(([, frame]) => frame);
    expect(frames.at(-1)).toMatchObject({ type: "resync-required", subscriptionId: receipt.subscriptionId });
    expect(frames.filter((frame) => frame.type === "delta")).toHaveLength(agentSessionFeedLimits.maxPendingFrames);
  });

  it("rebinds the feed when a retired session id receives a new SessionActor", async () => {
    const harness = createServiceHarness();
    const owner = createSender(505);
    const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    const firstReceipt = harness.service.attachSession(owner, { sessionId: created.session.id }, "/workspace");
    harness.service.acknowledgeSession(owner, {
      sessionId: created.session.id,
      subscriptionId: firstReceipt.subscriptionId,
      streamId: firstReceipt.snapshot.cursor.streamId,
      revision: firstReceipt.snapshot.cursor.revision,
    }, "/workspace");

    harness.adapters[0].exit({ expected: false, diagnostics: "restart" });
    const resumed = await harness.service.resumeSession(owner, { sessionId: created.session.id }, "/workspace");
    const secondReceipt = harness.service.attachSession(owner, { sessionId: resumed.session.id }, "/workspace");
    expect(secondReceipt.snapshot.cursor.streamId).not.toBe(firstReceipt.snapshot.cursor.streamId);
    owner.send.mockClear();

    await harness.service.startTurn(owner, { sessionId: resumed.session.id, prompt: "after reconnect", commandId: "after-reconnect" }, "/workspace");
    harness.service.acknowledgeSession(owner, {
      sessionId: resumed.session.id,
      subscriptionId: secondReceipt.subscriptionId,
      streamId: secondReceipt.snapshot.cursor.streamId,
      revision: secondReceipt.snapshot.cursor.revision,
    }, "/workspace");
    const frames = owner.send.mock.calls.filter(([channel]) => channel === "agent:session-frame").map(([, frame]) => frame);
    expect(frames.at(-1)).toMatchObject({
      streamId: secondReceipt.snapshot.cursor.streamId,
      control: { execution: { activeTurnId: "turn-1" } },
    });
  });
});
