import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionActor } from "../../../../electron/main/agent/domain/agent-session-actor.mjs";
import { JsonlRpcConnection } from "../../../../electron/main/agent/transports/jsonl-rpc-connection.mjs";
import { CodexAppServerAdapter } from "../../../../electron/main/agent/runtimes/codex/codex-app-server-adapter.mjs";
import { applyAgentEvents, createAgentProjection } from "../../../../electron/main/agent/domain/transcript/transcript-reducer.mjs";
import { createSender, createServiceHarness } from "../../../support/agent/agentServiceHarness.mjs";

const services = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.closeAll();
  vi.useRealTimers();
});

function native(type, turnId, payload = {}) {
  return { type, turnId, providerSessionId: "thread-1", payload };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

async function setup(options = {}) {
  const harness = createServiceHarness(options);
  services.push(harness.service);
  const owner = createSender(900);
  const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
  return { ...harness, owner, id: created.session.id };
}

function snapshot(harness) {
  return harness.service.replay(harness.owner, { sessionId: harness.id, afterSequence: 0 }, "/workspace");
}

function request(harness, commandId, prompt = commandId) {
  return { sessionId: harness.id, commandId, prompt };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Agent control-plane concurrency invariants", () => {
  it("persists the originating degraded turn on an explicit recovery start", async () => {
    const harness = await setup();
    await harness.service.startTurn(harness.owner, {
      ...request(harness, "recover", "Inspect state and continue"),
      recoveryOfTurnId: "turn-degraded",
    }, "/workspace");

    expect(snapshot(harness).events.find((event) => event.type === "turn.started")?.payload)
      .toMatchObject({ submissionId: "recover", recoveryOfTurnId: "turn-degraded" });
  });

  it("settles a start when its terminal event precedes its native receipt", async () => {
    const harness = await setup();
    const adapter = harness.adapters[0];
    const receipt = deferred();
    adapter.startTurn.mockImplementationOnce(() => receipt.promise);
    const start = harness.service.startTurn(harness.owner, request(harness, "fast"), "/workspace");
    adapter.emit(native("turn.completed", "fast-A"));
    receipt.resolve({ turnId: "fast-A" });
    await start;

    const control = snapshot(harness).control;
    expect(control.execution).toMatchObject({ status: "ended", nativeOutcome: "completed", certainty: "confirmed" });
    expect(control.runGeneration).toBe(1);
    expect(control.pendingSubmission).toBeNull();
    expect(control.commands.find((entry) => entry.commandId === "fast")?.status).toBe("accepted");
  });

  it("keeps B blockers when A interrupt acceptance arrives late", async () => {
    const harness = await setup({ capabilities: { queue: true } });
    const adapter = harness.adapters[0];
    await harness.service.startTurn(harness.owner, request(harness, "a"), "/workspace");
    const receipt = deferred();
    adapter.interruptTurn.mockImplementationOnce(() => receipt.promise);
    const interrupt = harness.service.interruptTurn(harness.owner, {
      sessionId: harness.id, commandId: "interrupt-a", turnId: "turn-1",
    }, "/workspace");
    adapter.emit(native("turn.interrupted", "turn-1"));
    adapter.startTurn.mockImplementationOnce(async () => {
      adapter.emit(native("turn.started", "B"));
      return { turnId: "B" };
    });
    await harness.service.startTurn(harness.owner, request(harness, "b"), "/workspace");
    adapter.emit({ ...native("approval.requested", "B", { requestId: "approval-B" }), itemId: "tool-B" });
    adapter.emit({ ...native("question.requested", "B", { requestId: "question-B", questions: [] }), itemId: "question-B" });
    receipt.resolve();
    await interrupt;

    const control = snapshot(harness).control;
    expect(control.execution.activeTurnId).toBe("B");
    expect(control.interaction.approvals.map((entry) => entry.requestId)).toEqual(["approval-B"]);
    expect(control.interaction.questions.map((entry) => entry.requestId)).toEqual(["question-B"]);
  });

  it("marks a written start with no response as outcome-unknown", async () => {
    const harness = await setup();
    const adapter = harness.adapters[0];
    vi.useFakeTimers();
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    child.kill = vi.fn(() => {
      setTimeout(() => child.emit("close", null, "SIGTERM"), 1);
      return true;
    });
    const rpc = new JsonlRpcConnection({
      executablePath: "/usr/local/bin/codex", args: [], cwd: "/workspace", env: {}, spawn: () => child,
    });
    rpc.on("exit", adapter.exit);
    adapter.startTurn.mockImplementationOnce(async () => {
      try {
        return await rpc.request("turn/start", {}, { timeoutMs: 20 });
      } catch (error) {
        error.clientUserMessageId = "native-user-ambiguous";
        throw error;
      }
    });
    const pending = harness.service.startTurn(harness.owner, request(harness, "ambiguous"), "/workspace");
    await vi.advanceTimersByTimeAsync(25);
    await pending;

    const control = snapshot(harness).control;
    expect(control.commands.find((entry) => entry.commandId === "ambiguous")).toMatchObject({
      status: "outcome-unknown",
      userMessageId: "native-user-ambiguous",
    });
    expect(control.execution).toMatchObject({ status: "outcome-unknown", certainty: "unknown" });
  });

  it("releases a queued attachment lease when native start rejects", async () => {
    const releaseLease = vi.fn(async () => ({ released: 1 }));
    const harness = await setup({ capabilities: { queue: true }, attachmentStore: { releaseLease } });
    const adapter = harness.adapters[0];
    await harness.service.startTurn(harness.owner, request(harness, "a"), "/workspace");
    await harness.service.startTurn(harness.owner, {
      ...request(harness, "queued"),
      privateReferenceLease: { leaseId: "lease-queued", tokens: ["q".repeat(43)] },
    }, "/workspace");
    adapter.startTurn.mockRejectedValueOnce(new Error("native rejected queued turn"));
    adapter.emit(native("turn.completed", "turn-1"));
    await tick();

    expect(releaseLease).toHaveBeenCalledWith({
      ownerId: harness.owner.id,
      workspaceRoot: "/workspace",
      leaseId: "lease-queued",
      tokens: ["q".repeat(43)],
    });
  });

  it("transfers a queued attachment lease to the accepted turn without releasing it", async () => {
    const releaseLease = vi.fn(async () => ({ released: 1 }));
    const revoke = vi.fn(async () => ({ revoked: 1 }));
    const harness = await setup({ capabilities: { queue: true }, attachmentStore: { releaseLease, revoke } });
    const adapter = harness.adapters[0];
    await harness.service.startTurn(harness.owner, request(harness, "a"), "/workspace");
    await harness.service.startTurn(harness.owner, {
      ...request(harness, "queued"),
      privateReferenceLease: { leaseId: "lease-queued", tokens: ["q".repeat(43)] },
    }, "/workspace");
    adapter.startTurn.mockImplementationOnce(async () => {
      adapter.emit(native("turn.started", "B"));
      return { turnId: "B" };
    });
    adapter.emit(native("turn.completed", "turn-1"));
    await tick();

    expect(releaseLease).not.toHaveBeenCalled();
    adapter.emit(native("turn.completed", "B"));
    await tick();
    expect(revoke).toHaveBeenCalledWith({
      ownerId: harness.owner.id,
      workspaceRoot: "/workspace",
      tokens: ["q".repeat(43)],
    });
  });

  it("scopes equal command IDs to their own session queues", async () => {
    const harness = await setup({ capabilities: { queue: true } });
    const second = await harness.service.createSession(harness.owner, { runtimeId: "codex" }, "/workspace");
    const other = { ...harness, id: second.session.id };
    await harness.service.startTurn(harness.owner, request(harness, "first-a"), "/workspace");
    await harness.service.startTurn(harness.owner, request(other, "first-b"), "/workspace");
    await harness.service.startTurn(harness.owner, request(harness, "same-id", "A queued"), "/workspace");
    await harness.service.startTurn(harness.owner, request(other, "same-id", "B queued"), "/workspace");
    harness.adapters[0].emit(native("turn.completed", "turn-1"));
    await tick();

    expect(harness.adapters[0].startTurn).toHaveBeenCalledTimes(2);
    expect(harness.adapters[0].startTurn.mock.calls[1][0].prompt).toBe("A queued");
  });

  it("revalidates idle state inside the queued dispatch microtask", async () => {
    const harness = await setup({ capabilities: { queue: true } });
    const adapter = harness.adapters[0];
    await harness.service.startTurn(harness.owner, request(harness, "a"), "/workspace");
    await harness.service.startTurn(harness.owner, request(harness, "queued"), "/workspace");
    adapter.emit(native("turn.completed", "turn-1"));
    adapter.emit(native("turn.started", "native-B"));
    await tick();

    expect(adapter.startTurn).toHaveBeenCalledTimes(1);
    expect(snapshot(harness).control.commands.find((entry) => entry.commandId === "queued")?.status).toBe("queued");
  });

  it("does not let a late A steer failure replace B attachment ownership", async () => {
    const revoke = vi.fn(async () => ({ revoked: 1 }));
    const harness = await setup({ capabilities: { steer: true }, attachmentStore: { revoke } });
    const adapter = harness.adapters[0];
    await harness.service.startTurn(harness.owner, {
      ...request(harness, "a"), privateReferenceLease: { leaseId: "lease-A", tokens: ["a".repeat(43)] },
    }, "/workspace");
    const steerReceipt = deferred();
    adapter.steerTurn.mockImplementationOnce(() => steerReceipt.promise);
    const steering = harness.service.steerTurn(harness.owner, {
      sessionId: harness.id, turnId: "turn-1", commandId: "steer-A", message: "continue",
    }, "/workspace").catch(() => undefined);
    adapter.emit(native("turn.completed", "turn-1"));
    adapter.startTurn.mockImplementationOnce(async () => {
      adapter.emit(native("turn.started", "B"));
      return { turnId: "B" };
    });
    await harness.service.startTurn(harness.owner, {
      ...request(harness, "b"), privateReferenceLease: { leaseId: "lease-B", tokens: ["b".repeat(43)] },
    }, "/workspace");
    steerReceipt.reject(new Error("late A steer failure"));
    await steering;
    adapter.emit(native("turn.completed", "B"));
    await tick();

    expect(revoke.mock.calls.flatMap(([query]) => query.tokens)).toContain("b".repeat(43));
  });

  it("rebuilds replace and append text with the same object semantics as live projection", () => {
    const actor = new AgentSessionActor();
    const all = [];
    const append = (event) => all.push(actor.appendEvent({
      sessionId: "session-1", runtimeId: "codex", providerSessionId: "thread-1", event,
    }));
    const reasoning = (text, mode) => ({
      ...native("reasoning.summary.delta", "A", { delta: text, summaryIndex: 0, updateMode: mode }),
      itemId: "reason-A",
    });
    append(native("turn.started", "A"));
    append(reasoning("OLD", "append"));
    append({ ...native("provider.activity", "A", { label: "interleaving", status: "running" }), itemId: "other" });
    append(reasoning("NEW", "replace"));
    append(reasoning(" tail", "append"));
    for (let index = 0; index < 1_001; index += 1) {
      append({ ...native("provider.activity", "A", { label: "activity", status: "running" }), itemId: "activity" });
    }
    const live = applyAgentEvents(createAgentProjection(), all);
    const saved = actor.snapshot();
    const restored = applyAgentEvents(createAgentProjection(), [
      ...saved.timeline.checkpointEvents,
      ...saved.timeline.events,
    ]);
    const read = (projection) => projection.activities.find((activity) => activity.kind === "reasoning")?.detail.delta;
    expect(read(live)).toBe("NEW tail");
    expect(read(restored)).toBe(read(live));
  });

  it("scopes a native Codex interrupt receipt to its target turn", async () => {
    const connection = new EventEmitter();
    const receipt = deferred();
    connection.request = vi.fn(async (method) => method === "turn/interrupt" ? receipt.promise : {});
    connection.notify = vi.fn();
    connection.respond = vi.fn();
    connection.respondError = vi.fn();
    connection.dispose = vi.fn();
    const adapter = new CodexAppServerAdapter({ workspaceRoot: "/workspace", connectionFactory: () => connection });
    await adapter.connect();
    adapter.threadId = "thread-1";
    const interrupt = adapter.interruptTurn({ turnId: "A" });
    connection.emit("notification", { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "A", status: "interrupted" } } });
    connection.emit("notification", { method: "turn/started", params: { threadId: "thread-1", turn: { id: "B", status: "inProgress" } } });
    connection.emit("request", {
      method: "item/commandExecution/requestApproval", id: 88,
      params: { threadId: "thread-1", turnId: "B", itemId: "tool-B", command: "echo B" },
    });
    receipt.resolve({});
    await interrupt;

    expect(connection.respond).not.toHaveBeenCalled();
    expect(adapter.pendingApprovals.has("codex:88")).toBe(true);
    adapter.dispose();
  });
});
