import { describe, expect, it, vi } from "vitest";
import { AgentSessionController } from "../src/features/desktop-agent/application/AgentSessionController";
import type { AgentEvent, AgentSessionControl, AgentSessionSnapshot } from "../src/features/desktop-agent/domain/agent-contract";

describe("Renderer Agent session replica", () => {
  it("uses the snapshot/ACK feed and applies a frame emitted at the ACK boundary", async () => {
    let onFrame: ((frame: any) => void) | null = null;
    const initial = feedSnapshot(1, idleControl(1));
    const running = runningControl(2, "turn-A");
    const started = event(2, "turn.started", "turn-A");
    const bridge = {
      discoverAgentRuntimes: vi.fn(async () => inspection()),
      resumeAgentSession: vi.fn(async () => initial),
      attachAgentSession: vi.fn(async () => ({ subscriptionId: "subscription-1", snapshot: initial })),
      acknowledgeAgentSession: vi.fn(async () => {
        onFrame?.({
          type: "delta",
          subscriptionId: "subscription-1",
          streamId: "stream-1",
          baseRevision: 1,
          revision: 2,
          control: running,
          events: [started],
        });
        return { subscriptionId: "subscription-1", streamId: "stream-1", revision: 2, synchronized: true };
      }),
      detachAgentSession: vi.fn(async () => ({ subscriptionId: "subscription-1", detached: true })),
      onAgentSessionFrame: vi.fn((callback) => { onFrame = callback; return () => { onFrame = null; }; }),
      onAgentEvent: vi.fn(() => { throw new Error("legacy event feed must not be installed"); }),
      onAgentSessionExit: vi.fn(() => () => {}),
    };
    const controller = new AgentSessionController("/workspace", () => bridge as never);

    await controller.initialize();

    const state = controller.getSnapshot();
    expect(bridge.onAgentEvent).not.toHaveBeenCalled();
    expect(state.replicaStatus).toBe("live");
    expect(state.control?.revision).toBe(2);
    expect(state.projection.runningTurnId).toBe("turn-A");
    expect(state.phase).toBe("running");
    controller.dispose();
  });

  it("repairs a lost final terminal frame from the Main watermark", async () => {
    vi.useFakeTimers();
    try {
      const started = event(1, "turn.started", "turn-A");
      const completed = event(2, "turn.completed", "turn-A");
      const initial = {
        ...feedSnapshot(1, runningControl(1, "turn-A")),
        events: [started],
        timeline: { events: [started], partial: false, firstAvailableSequence: 1, lastSequence: 1 },
        session: { ...feedSnapshot(1, runningControl(1, "turn-A")).session, activeTurnId: "turn-A", terminalState: "running" as const },
      };
      const terminal = {
        ...feedSnapshot(2, completedControl(2)),
        events: [started, completed],
        timeline: { events: [started, completed], partial: false, firstAvailableSequence: 1, lastSequence: 2 },
        session: { ...feedSnapshot(2, completedControl(2)).session, lastSequence: 2, terminalState: "completed" as const },
      };
      let subscription = 0;
      const bridge = {
        discoverAgentRuntimes: vi.fn(async () => inspection()),
        resumeAgentSession: vi.fn(async () => initial),
        attachAgentSession: vi.fn(async () => {
          subscription += 1;
          return { subscriptionId: `subscription-${subscription}`, snapshot: subscription === 1 ? initial : terminal };
        }),
        acknowledgeAgentSession: vi.fn(async (request: any) => ({ ...request, synchronized: true })),
        readAgentSessionWatermark: vi.fn(async () => ({
          subscriptionId: "subscription-1",
          streamId: "stream-1",
          revision: 2,
          acknowledgedRevision: 1,
          resyncRequired: false,
        })),
        detachAgentSession: vi.fn(async (request: any) => ({ subscriptionId: request.subscriptionId, detached: true })),
        onAgentSessionFrame: vi.fn(() => () => {}),
        onAgentEvent: vi.fn(() => { throw new Error("legacy event feed must not be installed"); }),
        onAgentSessionExit: vi.fn(() => () => {}),
      };
      const controller = new AgentSessionController("/workspace", () => bridge as never);
      await controller.initialize();
      expect(controller.getSnapshot().projection.runningTurnId).toBe("turn-A");

      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(0);

      expect(bridge.attachAgentSession).toHaveBeenCalledTimes(2);
      expect(controller.getSnapshot()).toMatchObject({
        replicaStatus: "live",
        phase: "ready",
        projection: { runningTurnId: null, terminalState: "completed" },
        control: { revision: 2, execution: { activeTurnId: null, nativeOutcome: "completed" } },
      });
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

function idleControl(revision: number): AgentSessionControl {
  return {
    schemaVersion: 1,
    streamId: "stream-1",
    revision,
    sessionEpoch: "epoch-1",
    adapterGeneration: 1,
    runGeneration: 0,
    connection: { status: "connected", reason: null },
    execution: { status: "idle", activeTurnId: null, uncertainTurnId: null, startedAtMs: null, nativeOutcome: null, certainty: "confirmed" },
    interaction: { approvals: [], questions: [] },
    commands: [],
    queue: [],
    terminalTurns: [],
    pendingSubmission: null,
  };
}

function runningControl(revision: number, turnId: string): AgentSessionControl {
  return {
    ...idleControl(revision),
    runGeneration: 1,
    execution: { status: "active", activeTurnId: turnId, uncertainTurnId: null, startedAtMs: Date.now(), nativeOutcome: null, certainty: "confirmed" },
  };
}

function completedControl(revision: number): AgentSessionControl {
  return {
    ...idleControl(revision),
    runGeneration: 1,
    execution: { status: "ended", activeTurnId: null, uncertainTurnId: null, startedAtMs: null, nativeOutcome: "completed", certainty: "confirmed" },
    terminalTurns: ["turn-A"],
  };
}

function feedSnapshot(revision: number, control: AgentSessionControl): AgentSessionSnapshot {
  const events = [event(1, "session.resumed", null)];
  return {
    session: {
      id: "session-1", runtimeId: "codex", provider: "codex", providerSessionId: "thread-1", workspaceRoot: "/workspace",
      title: "Session", createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
      terminalState: "idle", selectedModel: "gpt-5", selectedEffort: null, selectedMode: null, activeTurnId: null, lastSequence: 1,
    },
    account: null,
    models: [{ id: "gpt-5", model: "gpt-5", displayName: "GPT-5", description: "", isDefault: true }],
    capabilities: { ...inspection().capabilities! },
    events,
    partial: false,
    firstAvailableSequence: 1,
    lastSequence: 1,
    cursor: { streamId: "stream-1", revision },
    control,
    timeline: { events, partial: false, firstAvailableSequence: 1, lastSequence: 1 },
  };
}

function event(sequence: number, type: AgentEvent["type"], turnId: string | null): AgentEvent {
  return {
    schemaVersion: 1, sequence, sessionId: "session-1", runtimeId: "codex", provider: "codex", providerSessionId: "thread-1",
    turnId, itemId: null, emittedAt: "2026-09-06T00:00:00.000Z", type, payload: {},
  } as AgentEvent;
}

function inspection() {
  return {
    selectedRuntimeId: "codex",
    runtime: { id: "codex", displayName: "Codex" },
    readiness: { provider: "codex", runtimeId: "codex", status: "ready" as const, code: "READY" as const, version: "1", minimumVersion: "1", message: "", selectable: true },
    account: null,
    providers: [],
    models: [{ id: "gpt-5", model: "gpt-5", displayName: "GPT-5", description: "", isDefault: true }],
    modes: [], commands: [],
    capabilities: {
      streamingText: true, structuredToolEvents: true, commandOutputStreaming: true, fileChangeEvents: true,
      manualApprovals: true, structuredQuestions: true, resume: true, fork: true, steer: true, queue: true,
      attachments: false, contextReferences: false, modelSelection: true, modeSelection: false, slashCommands: false,
      sessionHistory: true, usage: true, accountState: true, mcp: true, skills: true, compaction: true,
    },
    warnings: [],
  };
}
