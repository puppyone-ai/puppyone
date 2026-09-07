import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { AgentProviderSessionUnavailableError } from "../electron/main/agent/runtime/agent-runtime-port.mjs";
import {
  createSender,
  createServiceHarness,
  semanticReferenceCapabilities,
} from "./helpers/agentServiceHarness.mjs";

describe("Electron AgentService ownership and lifecycle", () => {
  it("returns installed runtime inventory without inspecting or selecting a default runtime", async () => {
    const harness = createServiceHarness();
    const inspection = await harness.service.discoverProviders(createSender(100), {}, "/workspace");

    expect(inspection).toMatchObject({
      selectedRuntimeId: null,
      readiness: null,
      account: null,
      providers: [],
      models: [],
      capabilities: null,
    });
    expect(inspection.runtimes.map((entry) => entry.descriptor.id)).toEqual(["codex"]);
    expect(harness.adapters).toHaveLength(0);
  });

  it("requires an explicit runtime before creating a session", async () => {
    const harness = createServiceHarness();

    await expect(harness.service.createSession(createSender(101), {}, "/workspace"))
      .rejects.toThrow(/choose an Agent/i);
    expect(harness.adapters).toHaveLength(0);
  });

  it("binds sessions to one sender and rejects cross-window mutations", async () => {
    const harness = createServiceHarness();
    const owner = createSender(1);
    const attacker = createSender(2);
    const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");

    expect(() => harness.service.replay(attacker, {
      sessionId: snapshot.session.id,
      afterSequence: 0,
    })).toThrow(/another window/i);
    await expect(harness.service.startTurn(attacker, {
      sessionId: snapshot.session.id,
      prompt: "attack",
    })).rejects.toThrow(/another window/i);
    await expect(harness.service.interruptTurn(attacker, {
      sessionId: snapshot.session.id,
      turnId: "turn-1",
    })).rejects.toThrow(/another window/i);
    await expect(harness.service.closeSession(attacker, {
      sessionId: snapshot.session.id,
    })).rejects.toThrow(/another window/i);
  });

  it("keeps a turn alive without renderer visibility and cleans up on window close", async () => {
    const harness = createServiceHarness();
    const owner = createSender(3);
    const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    const result = await harness.service.startTurn(owner, {
      sessionId: snapshot.session.id,
      prompt: "Keep running",
    });
    expect(result.turnId).toBe("turn-1");
    expect(harness.adapters[0].disposed).toBe(false);

    await harness.service.closeSessionsForWindow(owner.id);
    expect(harness.adapters[0].disposed).toBe(true);
    expect(harness.service.getSessionCount()).toBe(0);
  });

  it("closes one Root's sessions without disposing sibling Root Agents", async () => {
    const attachmentStore = { revokeWorkspace: vi.fn(async () => undefined) };
    const harness = createServiceHarness({ attachmentStore });
    const owner = createSender(30);
    await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace-a");
    await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace-b");

    await expect(harness.service.closeSessionsForWorkspaceRoot(owner.id, "/workspace-a"))
      .resolves.toBe(1);
    expect(harness.adapters[0].disposed).toBe(true);
    expect(harness.adapters[1].disposed).toBe(false);
    expect(harness.service.getSessionCount()).toBe(1);
    expect(attachmentStore.revokeWorkspace).toHaveBeenCalledWith(owner.id, "/workspace-a");
    await harness.service.closeAll();
  });

  it("supports multiple tab-owned live sessions in one workspace and preserves process-local recovery on close", async () => {
    const harness = createServiceHarness();
    const owner = createSender(33);

    const first = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    const second = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");

    expect(second.session.id).not.toBe(first.session.id);
    expect(harness.service.getSessionCount()).toBe(2);
    await harness.service.closeSession(owner, { sessionId: first.session.id }, "/workspace");
    await harness.service.closeSession(owner, { sessionId: second.session.id }, "/workspace");
    expect(harness.persistence.remove).not.toHaveBeenCalled();
    expect(harness.persistence.save).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: first.session.id }),
      { promoteCatalog: false },
    );
    expect(harness.persistence.save).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: second.session.id }),
      { promoteCatalog: false },
    );
  });

  it("keeps an allocated empty session out of durable History until its first accepted turn", async () => {
    const harness = createServiceHarness();
    const owner = createSender(36);
    const empty = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await harness.service.closeSession(owner, { sessionId: empty.session.id }, "/workspace");
    expect(harness.persistence.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: empty.session.id }),
      { promoteCatalog: false },
    );

    const durable = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await harness.service.startTurn(owner, { sessionId: durable.session.id, prompt: "Persist me" }, "/workspace");
    await harness.service.closeSession(owner, { sessionId: durable.session.id }, "/workspace");
    expect(harness.persistence.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: durable.session.id }),
      { promoteCatalog: true },
    );
  });

  it("allows two same-workspace Chat tabs to prepare sessions concurrently", async () => {
    const harness = createServiceHarness();
    const owner = createSender(35);

    const [first, second] = await Promise.all([
      harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace"),
      harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace"),
    ]);

    expect(first.session.id).not.toBe(second.session.id);
    expect(harness.service.getSessionCount()).toBe(2);
    expect(harness.adapters).toHaveLength(2);
  });

  it("indexes native session metadata on explicit refresh without persisting transcript payloads", async () => {
    const harness = createServiceHarness({
      nativeSessions: [{
        providerSessionId: "native-external",
        title: "Existing Codex chat",
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-30T00:00:00.000Z",
        events: [{ payload: { text: "private transcript" } }],
      }],
    });

    const result = await harness.service.listSessions(createSender(34), {
      runtimeId: "codex",
      discoverNative: true,
      limit: 25,
    }, "/workspace");

    expect(result).toMatchObject({
      discovery: { runtimeId: "codex", status: "complete", nextCursor: null },
      sessions: [expect.objectContaining({
        runtimeId: "codex",
        providerSessionId: "native-external",
        origin: "native-discovery",
      })],
    });
    expect(harness.persistence.upsertNative).toHaveBeenCalledWith(expect.not.objectContaining({ events: expect.anything() }));
  });

  it("rejects a model that is not in the inspected connected-provider catalog", async () => {
    const harness = createServiceHarness();
    const owner = createSender(32);
    const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");

    await expect(harness.service.startTurn(owner, {
      sessionId: snapshot.session.id,
      prompt: "Use an injected model",
      model: "unconnected/hidden-model",
    })).rejects.toThrow(/no longer available from a connected provider/i);
    expect(harness.adapters[0].startTurn).not.toHaveBeenCalled();
  });

  it("does not resurrect a turn that completed before turn/start returned", async () => {
    const harness = createServiceHarness();
    const owner = createSender(31);
    const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    const adapter = harness.adapters[0];
    adapter.startTurn.mockImplementationOnce(async () => {
      adapter.emit({
        type: "turn.started",
        providerSessionId: "thread-1",
        turnId: "turn-fast",
        payload: { status: "running" },
      });
      adapter.emit({
        type: "turn.completed",
        providerSessionId: "thread-1",
        turnId: "turn-fast",
        payload: { status: "completed" },
      });
      return { turnId: "turn-fast" };
    });

    await harness.service.startTurn(owner, { sessionId: snapshot.session.id, prompt: "Quick" });

    const replay = harness.service.replay(owner, { sessionId: snapshot.session.id, afterSequence: 0 });
    expect(replay.session.activeTurnId).toBeNull();
    expect(replay.session.terminalState).toBe("completed");
    expect(replay.events.filter((event) => event.type === "turn.started")).toHaveLength(1);
    expect(replay.events.find((event) => event.type === "turn.completed")?.payload.durationMs).toEqual(expect.any(Number));
  });

  it("fails pending approvals closed without fabricating a terminal outcome on provider exit", async () => {
    const harness = createServiceHarness();
    const owner = createSender(4);
    const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await harness.service.startTurn(owner, { sessionId: snapshot.session.id, prompt: "Run" });
    const adapter = harness.adapters[0];
    adapter.emit({
      type: "approval.requested",
      providerSessionId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      payload: { requestId: "codex:1", kind: "command", availableDecisions: ["accept", "decline", "cancel"] },
    });
    adapter.exit({ expected: false, diagnostics: "token=secret-value" });
    const replay = harness.service.replay(owner, { sessionId: snapshot.session.id, afterSequence: 0 }, "/workspace");
    const events = replay.events;
    expect(events.some((event) => event.type === "approval.resolved" && event.payload.decision === "cancel")).toBe(true);
    expect(events.some((event) => event.type === "turn.failed")).toBe(false);
    expect(replay.control.execution).toMatchObject({ status: "outcome-unknown", uncertainTurnId: "turn-1", certainty: "unknown" });
    expect(JSON.stringify(events)).not.toContain("secret-value");
    expect(adapter.disposed).toBe(true);
    expect(harness.service.getSessionCount()).toBe(0);
  });

  it("resumes immediately from the retired in-memory snapshot after provider exit", async () => {
    const harness = createServiceHarness();
    const owner = createSender(41);
    const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    harness.adapters[0].exit({ expected: false, diagnostics: "provider crashed" });
    expect(harness.service.getSessionCount()).toBe(0);
    expect(harness.service.getRetainedSessionCount()).toBe(1);
    expect(harness.adapters[0].disposed).toBe(true);

    const resumed = await harness.service.resumeSession(owner, { sessionId: created.session.id }, "/workspace");

    expect(resumed.session.id).toBe(created.session.id);
    expect(harness.adapters).toHaveLength(2);
    expect(harness.adapters[1].resumeSession).toHaveBeenCalledWith({ threadId: "thread-1", model: "gpt-5" });
    expect(harness.service.getSessionCount()).toBe(1);
  });

  it("discards stale native-session metadata and falls back to a clean session", async () => {
    const harness = createServiceHarness({
      resumeSessionError: new AgentProviderSessionUnavailableError("The saved Codex thread is gone."),
    });
    const owner = createSender(43);
    const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await harness.service.startTurn(owner, { sessionId: created.session.id, prompt: "Make this conversation durable" });
    await harness.service.closeSessionsForWindow(owner.id);

    await expect(harness.service.resumeSession(owner, { runtimeId: "codex" }, "/workspace"))
      .resolves.toBeNull();

    expect(harness.persistence.markUnavailable).toHaveBeenCalledWith(created.session.id);
    expect(harness.service.getSessionCount()).toBe(0);
    await expect(harness.service.resumeSession(owner, { runtimeId: "codex" }, "/workspace"))
      .resolves.toBeNull();
  });

  it("does not discard a retired snapshot when a different requested session is missing", async () => {
    const harness = createServiceHarness();
    const owner = createSender(42);
    await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    harness.adapters[0].exit({ expected: false, diagnostics: "provider crashed" });

    const missing = await harness.service.resumeSession(owner, { sessionId: "missing-session" }, "/workspace");

    expect(missing).toBeNull();
    expect(harness.service.getRetainedSessionCount()).toBe(1);
    const resumed = await harness.service.resumeSession(owner, {}, "/workspace");
    expect(resumed).not.toBeNull();
  });

  it("opens an exact History target with a structured result", async () => {
    const harness = createServiceHarness({
      nativeSessions: [{
        providerSessionId: "native-history",
        title: "Saved chat",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:01.000Z",
      }],
    });
    const owner = createSender(44);
    const listed = await harness.service.listSessions(owner, {
      runtimeId: "codex",
      discoverNative: true,
    }, "/workspace");
    const sessionId = listed.sessions[0].id;

    await expect(harness.service.openSession(owner, {
      sessionId,
      runtimeId: "codex",
    }, "/workspace")).resolves.toMatchObject({
      status: "opened",
      snapshot: { session: { id: sessionId } },
    });
  });

  it("classifies a missing exact History target without throwing across IPC", async () => {
    const harness = createServiceHarness();

    await expect(harness.service.openSession(createSender(45), {
      sessionId: "missing-session",
      runtimeId: "codex",
    }, "/workspace")).resolves.toEqual({
      status: "failed",
      error: {
        code: "SESSION_NOT_FOUND",
        message: "This saved Agent session is no longer available.",
        retryable: false,
      },
    });
  });

  it("does not expose or open an unverified legacy locator", async () => {
    const harness = createServiceHarness();
    await harness.persistence.save({
      sessionId: "legacy-empty-session",
      workspaceRoot: "/workspace",
      runtimeId: "codex",
      providerSessionId: "thread-without-rollout",
      title: "Codex session",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
      availability: "unverified",
    });

    await expect(harness.service.listSessions(createSender(46), {
      runtimeId: "codex",
      discoverNative: false,
    }, "/workspace")).resolves.toMatchObject({ sessions: [] });
    await expect(harness.service.openSession(createSender(46), {
      sessionId: "legacy-empty-session",
      runtimeId: "codex",
    }, "/workspace")).resolves.toMatchObject({
      status: "failed",
      error: { code: "SESSION_NOT_FOUND", retryable: false },
    });
    expect(harness.adapters).toHaveLength(0);
  });

  it("hydrates native history when resume emitted only lifecycle or diagnostic events", async () => {
    const historicalEvents = [
      { type: "turn.started", providerSessionId: "native-history", turnId: "turn-1", payload: { status: "running", restored: true, prompt: "hello" } },
      { type: "assistant.completed", providerSessionId: "native-history", turnId: "turn-1", itemId: "answer-1", payload: { text: "hi" } },
      { type: "turn.completed", providerSessionId: "native-history", turnId: "turn-1", payload: { status: "completed", restored: true } },
    ];
    const harness = createServiceHarness({
      nativeSessions: [{
        providerSessionId: "native-history",
        title: "Saved chat",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:01.000Z",
      }],
      resumeEvents: [
        { type: "session.resumed", providerSessionId: "native-history", payload: { title: "Saved chat" } },
        { type: "provider.warning", providerSessionId: "native-history", payload: { message: "operator diagnostic" } },
      ],
      historicalEvents,
    });
    const owner = createSender(47);
    const listed = await harness.service.listSessions(owner, {
      runtimeId: "codex",
      discoverNative: true,
    }, "/workspace");

    const opened = await harness.service.openSession(owner, {
      sessionId: listed.sessions[0].id,
      runtimeId: "codex",
    }, "/workspace");

    expect(opened).toMatchObject({ status: "opened" });
    expect(harness.adapters[1].readHistory).toHaveBeenCalledOnce();
    expect(opened.snapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "turn.started", payload: expect.objectContaining({ prompt: "hello" }) }),
      expect.objectContaining({ type: "assistant.completed", payload: { text: "hi" } }),
    ]));
  });

  it("reconciles an unconfirmed persisted turn with the native terminal object on resume", async () => {
    const harness = createServiceHarness({
      historicalEvents: [
        { type: "turn.started", providerSessionId: "thread-1", turnId: "turn-1", payload: { status: "running", restored: true } },
        { type: "assistant.completed", providerSessionId: "thread-1", turnId: "turn-1", itemId: "answer-1", payload: { text: "done" } },
        { type: "turn.completed", providerSessionId: "thread-1", turnId: "turn-1", payload: { status: "completed", restored: true } },
      ],
    });
    const owner = createSender(48);
    const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await harness.service.startTurn(owner, { sessionId: created.session.id, prompt: "Run" }, "/workspace");
    await harness.service.closeSession(owner, { sessionId: created.session.id, removePersistence: false }, "/workspace");

    const resumed = await harness.service.resumeSession(owner, { sessionId: created.session.id }, "/workspace");

    expect(harness.adapters[1].readHistory).toHaveBeenCalledOnce();
    expect(resumed.control.execution).toMatchObject({
      status: "ended",
      activeTurnId: null,
      uncertainTurnId: null,
      nativeOutcome: "completed",
      certainty: "confirmed",
    });
  });

  it("rejects stale approvals and bounds retained replay for a slow renderer", async () => {
    const harness = createServiceHarness();
    const owner = createSender(5);
    const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await harness.service.startTurn(owner, { sessionId: snapshot.session.id, prompt: "Run" });
    const adapter = harness.adapters[0];
    adapter.emit({
      type: "approval.requested",
      providerSessionId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      payload: { requestId: "codex:2", kind: "command", availableDecisions: ["accept", "decline", "cancel"] },
    });
    expect(harness.service.resolveApproval(owner, {
      sessionId: snapshot.session.id,
      turnId: "turn-1",
      requestId: "codex:2",
      decision: "decline",
    })).toMatchObject({ decision: "decline" });
    expect(() => harness.service.resolveApproval(owner, {
      sessionId: snapshot.session.id,
      turnId: "turn-1",
      requestId: "codex:2",
      decision: "accept",
    })).toThrow(/stale/i);

    for (let index = 0; index < 1_100; index += 1) {
      adapter.emit({ type: "provider.warning", payload: { message: `warning ${index}` } });
    }
    const replay = harness.service.replay(owner, { sessionId: snapshot.session.id, afterSequence: 0 });
    expect(replay.events.length).toBeLessThanOrEqual(1_000);
    expect(replay.firstAvailableSequence).toBeGreaterThan(1);
  });

  it("deduplicates blocking requests replayed during runtime reconciliation", async () => {
    const harness = createServiceHarness();
    const owner = createSender(51);
    const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await harness.service.startTurn(owner, { sessionId: snapshot.session.id, prompt: "Run" });
    const adapter = harness.adapters[0];
    const approval = {
      type: "approval.requested",
      providerSessionId: "thread-1",
      turnId: "turn-1",
      itemId: "item-approval",
      payload: { requestId: "runtime:approval", kind: "command", availableDecisions: ["accept", "decline", "cancel"] },
    };
    const question = {
      type: "question.requested",
      providerSessionId: "thread-1",
      turnId: "turn-1",
      itemId: "item-question",
      payload: { requestId: "runtime:question", questions: [{ question: "Continue?", options: [] }] },
    };

    adapter.emit(approval);
    adapter.emit(approval);
    adapter.emit(question);
    adapter.emit(question);

    const events = harness.service.replay(owner, { sessionId: snapshot.session.id, afterSequence: 0 }).events;
    expect(events.filter((event) => event.type === "approval.requested")).toHaveLength(1);
    expect(events.filter((event) => event.type === "question.requested")).toHaveLength(1);
  });

  it("closes every adapter during app-level cleanup", async () => {
    const harness = createServiceHarness();
    await harness.service.createSession(createSender(6), { runtimeId: "codex" }, "/workspace-a");
    await harness.service.createSession(createSender(7), { runtimeId: "codex" }, "/workspace-b");
    await harness.service.closeAll();
    expect(harness.adapters.every((adapter) => adapter.disposed)).toBe(true);
    expect(harness.service.getSessionCount()).toBe(0);
  });

  it("fails a pending approval closed then confirms the interrupt once the provider acknowledges it", async () => {
    const harness = createServiceHarness();
    const owner = createSender(10);
    const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await harness.service.startTurn(owner, { sessionId: snapshot.session.id, prompt: "Run" });
    const adapter = harness.adapters[0];
    adapter.emit({
      type: "approval.requested",
      providerSessionId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      payload: { requestId: "codex:interrupt", kind: "command", availableDecisions: ["accept", "decline", "cancel"] },
    });
    adapter.interruptTurn.mockImplementation(async () => {
      adapter.emit({
        type: "turn.interrupted",
        providerSessionId: "thread-1",
        turnId: "turn-1",
        payload: { status: "interrupted" },
      });
    });

    await harness.service.interruptTurn(owner, { sessionId: snapshot.session.id, turnId: "turn-1" });

    const replay = harness.service.replay(owner, { sessionId: snapshot.session.id, afterSequence: 0 });
    expect(replay.events.some((event) => (
      event.type === "approval.resolved" && event.payload.decision === "cancel" && event.payload.requestId === "codex:interrupt"
    ))).toBe(true);
    expect(replay.events.filter((event) => event.type === "turn.interrupted")).toHaveLength(1);
  });

  it("retires the provider instead of claiming an unconfirmed interrupt succeeded", async () => {
    vi.useFakeTimers();
    try {
      const harness = createServiceHarness();
      const owner = createSender(11);
      const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
      await harness.service.startTurn(owner, { sessionId: snapshot.session.id, prompt: "Run" });

      await harness.service.interruptTurn(owner, { sessionId: snapshot.session.id, turnId: "turn-1" });
      // The fake adapter acknowledges the interrupt request but never emits the
      // authoritative turn/completed notification.
      await vi.advanceTimersByTimeAsync(5_100);

      const replay = harness.service.replay(owner, { sessionId: snapshot.session.id, afterSequence: 0 }, "/workspace");
      const events = replay.events;
      expect(events.filter((event) => event.type === "turn.interrupted")).toHaveLength(0);
      expect(events.some((event) => event.type === "turn.failed")).toBe(false);
      expect(replay.control.execution).toMatchObject({ status: "outcome-unknown", uncertainTurnId: "turn-1", certainty: "unknown" });
      expect(harness.adapters[0].disposed).toBe(true);
      expect(harness.service.getSessionCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fabricate a terminal state when the interrupt request itself fails", async () => {
    vi.useFakeTimers();
    try {
      const harness = createServiceHarness();
      const owner = createSender(12);
      const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
      await harness.service.startTurn(owner, { sessionId: snapshot.session.id, prompt: "Run" });
      harness.adapters[0].emit({
        type: "approval.requested",
        providerSessionId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        payload: { requestId: "codex:still-actionable", kind: "command", availableDecisions: ["accept", "decline", "cancel"] },
      });
      harness.adapters[0].interruptTurn.mockRejectedValueOnce(new Error("transport unavailable"));

      await expect(harness.service.interruptTurn(owner, {
        sessionId: snapshot.session.id,
        turnId: "turn-1",
      })).rejects.toThrow(/transport unavailable/i);
      await vi.advanceTimersByTimeAsync(5_100);

      const replay = harness.service.replay(owner, { sessionId: snapshot.session.id, afterSequence: 0 });
      expect(replay.session.activeTurnId).toBe("turn-1");
      expect(replay.events.some((event) => ["turn.failed", "turn.interrupted"].includes(event.type))).toBe(false);
      expect(replay.events.some((event) => (
        event.type === "approval.resolved" && event.payload.requestId === "codex:still-actionable"
      ))).toBe(false);
      expect(() => harness.service.resolveApproval(owner, {
        sessionId: snapshot.session.id,
        turnId: "turn-1",
        requestId: "codex:still-actionable",
        decision: "decline",
      })).not.toThrow();
      expect(harness.service.getSessionCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps only one renderer-destroyed listener per owner and removes it after the final session", async () => {
    const harness = createServiceHarness();
    const owner = Object.assign(new EventEmitter(), {
      id: 13,
      isDestroyed: () => false,
      send: vi.fn(),
    });

    const first = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace-a");
    const second = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace-b");
    expect(owner.listenerCount("destroyed")).toBe(1);

    await harness.service.closeSession(owner, { sessionId: first.session.id, removePersistence: true });
    expect(owner.listenerCount("destroyed")).toBe(1);
    await harness.service.closeSession(owner, { sessionId: second.session.id, removePersistence: true });
    expect(owner.listenerCount("destroyed")).toBe(0);
  });

  it("scrubs private snapshot paths and data URLs from normalized renderer events", async () => {
    const harness = createServiceHarness({
      capabilities: {
        manualApprovals: true,
        attachments: true,
        referenceInputs: semanticReferenceCapabilities(),
      },
    });
    const owner = createSender(61);
    const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    const privatePath = "/private/staging/ref.snapshot";
    const snapshotUrl = "data:image/png;base64,cHJpdmF0ZQ==";
    await harness.service.startTurn(owner, {
      sessionId: snapshot.session.id,
      prompt: "Inspect",
      references: [{
        authorized: true,
        id: "ref-private",
        kind: "staged-attachment",
        path: privatePath,
        displayName: "photo.png",
        mime: "image/png",
        size: 7,
        snapshotUrl,
      }],
    });
    harness.adapters[0].emit({
      type: "provider.warning",
      turnId: "turn-1",
      payload: { message: `native echo ${privatePath} ${snapshotUrl}` },
    });

    const serialized = JSON.stringify(harness.service.replay(owner, {
      sessionId: snapshot.session.id,
      afterSequence: 0,
    }, "/workspace").events);
    expect(serialized).not.toContain(privatePath);
    expect(serialized).not.toContain(snapshotUrl);
    expect(serialized).toContain("[attachment:photo.png]");
  });

  it("compiles an external file mention for the Harness while persisting only display-safe prompt data", async () => {
    const referenceInputs = semanticReferenceCapabilities();
    referenceInputs.attachments.text = { accepted: true };
    const harness = createServiceHarness({ capabilities: { referenceInputs } });
    const owner = createSender(66);
    const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace-a");
    const privatePath = "/private/staging/immutable.snapshot";
    const prompt = "Review @notes.md in this turn";

    await harness.service.startTurn(owner, {
      sessionId: snapshot.session.id,
      prompt,
      promptMentions: [{ referenceId: "ref-notes", start: 7, end: 16 }],
      references: [{
        authorized: true,
        id: "ref-notes",
        kind: "staged-attachment",
        path: privatePath,
        displayName: "notes.md",
        mime: "text/markdown",
        size: 12,
      }],
    });

    expect(harness.adapters[0].startTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: `Review \`${privatePath}\` in this turn`,
      references: [expect.objectContaining({ id: "ref-notes", inlineMentioned: true })],
    }));
    const started = harness.service.replay(owner, {
      sessionId: snapshot.session.id,
      afterSequence: 0,
    }, "/workspace-a").events.find((event) => event.type === "turn.started");
    expect(started.payload).toMatchObject({
      prompt,
      promptMentions: [{ referenceId: "ref-notes", start: 7, end: 16 }],
      referenceDisplays: [{ id: "ref-notes", displayName: "notes.md" }],
    });
    expect(JSON.stringify(started)).not.toContain(privatePath);
  });

  it("rejects references that did not pass main-process authorization", async () => {
    const harness = createServiceHarness();
    const owner = createSender(64);
    const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await expect(harness.service.startTurn(owner, {
      sessionId: snapshot.session.id,
      prompt: "Read it",
      references: [{ kind: "workspace-entry", path: "/workspace/raw.txt" }],
    })).rejects.toThrow(/authorized by the main process/i);
  });

  it("releases attachment grants on window and application lifecycle cleanup", async () => {
    const attachmentStore = { revokeOwner: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
    const harness = createServiceHarness({ attachmentStore });
    await harness.service.closeSessionsForWindow(62);
    expect(attachmentStore.revokeOwner).toHaveBeenCalledWith(62);
    await harness.service.closeAll();
    expect(attachmentStore.close).toHaveBeenCalledTimes(1);
  });

  it("retains local snapshots for the native turn and releases them at terminal acceptance", async () => {
    const attachmentStore = { revoke: vi.fn(async () => ({ revoked: 1 })) };
    const harness = createServiceHarness({ attachmentStore });
    const owner = createSender(63);
    const snapshot = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    await harness.service.startTurn(owner, {
      sessionId: snapshot.session.id,
      prompt: "Inspect",
      privateReferenceLease: { leaseId: "lease-test", tokens: ["a".repeat(43)] },
    });
    expect(attachmentStore.revoke).not.toHaveBeenCalled();
    harness.adapters[0].emit({
      type: "turn.completed",
      providerSessionId: "thread-1",
      turnId: "turn-1",
      payload: { status: "completed" },
    });
    await vi.waitFor(() => expect(attachmentStore.revoke).toHaveBeenCalledWith({
      ownerId: owner.id,
      workspaceRoot: "/workspace",
      tokens: ["a".repeat(43)],
    }));
  });
});


describe("History discovery and active Chat isolation", () => {
  it.each(["archiveSession", "deleteSession"])("keeps %s workspace and ownership checks after extracting list queries", async (method) => {
    const harness = createServiceHarness();
    const owner = createSender(93);
    const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    const request = { sessionId: created.session.id };
    await expect(harness.service[method](owner, request, "/different-workspace")).rejects.toThrow(/workspace/);
    await expect(harness.service[method](createSender(94), request, "/workspace")).rejects.toThrow();
    await expect(harness.service[method](owner, request, "/workspace")).resolves.toMatchObject({ sessionId: request.sessionId });
    expect(harness.service.getSessionCount()).toBe(0);
    await harness.service.closeAll();
  });

  it("keeps an active turn, replay and ownership intact when the catalog says unavailable", async () => {
    const harness = createServiceHarness();
    const owner = createSender(91);
    const created = await harness.service.createSession(owner, { runtimeId: "codex" }, "/workspace");
    const sessionId = created.session.id;
    await harness.service.startTurn(owner, { sessionId, prompt: "Continue the current task" });
    const before = harness.service.replay(owner, { sessionId });
    await harness.persistence.markUnavailable(sessionId);
    await harness.service.listSessions(owner, { runtimeId: "codex", discoverNative: true }, "/workspace");
    expect(harness.service.replay(owner, { sessionId })).toEqual(before);
    expect(harness.adapters[0].disposed).toBe(false);
    expect(harness.adapters[1].disposed).toBe(true);
    expect(harness.service.getSessionCount()).toBe(1);
    await expect(harness.service.openSession(owner, { sessionId, runtimeId: "codex" }, "/workspace"))
      .resolves.toMatchObject({ status: "opened", snapshot: { session: { id: sessionId } } });
    for (const [sender, runtimeId, root] of [[createSender(92), "codex", "/workspace"],
      [owner, "cursor", "/workspace"], [owner, "codex", "/different-workspace"]]) {
      await expect(harness.service.openSession(sender, { sessionId, runtimeId }, root)).resolves.toMatchObject({ status: "failed" });
    }
    expect(harness.adapters).toHaveLength(2);
    expect(harness.adapters[0].resumeSession).not.toHaveBeenCalled();
    await harness.service.closeAll();
  });
});
