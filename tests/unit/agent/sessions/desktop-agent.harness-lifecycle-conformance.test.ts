import { describe, expect, it } from "vitest";
import { LIVE_AGENT_ACTIVITY_STATUSES } from "../../../../electron/main/agent/domain/transcript/turn-lifecycle.mjs";
import type { AgentEvent } from "../../../../src/features/desktop-agent/agentTypes";
import { buildAgentTimeline } from "../../../../src/features/desktop-agent/ui/transcript/transcript-rows";
import {
  applyAgentEvents,
  createAgentProjection,
} from "../../../support/agent/agentDisplayFixture";
import { defineAgentEvent, type AgentEventPayloadMap } from "../../../support/agent/agentEventFixture";

const harnessFixtures = [
  {
    runtimeId: "codex",
    events: [
      event("codex", 1, "turn.started", { prompt: "Inspect it" }),
      event("codex", 2, "reasoning.summary.delta", { delta: "", boundary: true }, "reasoning-1"),
      event("codex", 3, "assistant.delta", { delta: "Done" }, "assistant-1"),
      event("codex", 4, "assistant.completed", { text: "Done" }, "assistant-1"),
    ],
  },
  {
    runtimeId: "cursor",
    events: [
      event("cursor", 1, "turn.started", { prompt: "?" }),
      event("cursor", 2, "reasoning.summary.delta", { delta: "", boundary: true, status: "working" }, "cursor-thought-1"),
      event("cursor", 3, "assistant.delta", { delta: "I'm here." }, "cursor-message-1"),
      event("cursor", 4, "assistant.completed", { text: "I'm here." }, "cursor-message-1"),
    ],
  },
  {
    runtimeId: "claude",
    events: [
      event("claude", 1, "turn.started", { prompt: "Inspect it" }),
      event("claude", 2, "reasoning.summary.delta", { delta: "", boundary: true }, "claude-thinking-1"),
      event("claude", 3, "tool.started", { kind: "read", tool: "read", label: "Read file", status: "running" }, "tool-1"),
      event("claude", 4, "tool.completed", { kind: "read", tool: "read", label: "Read file", status: "completed" }, "tool-1"),
      event("claude", 5, "assistant.completed", { text: "Done" }, "claude-message-1"),
    ],
  },
  {
    runtimeId: "opencode",
    events: [
      event("opencode", 1, "turn.started", { prompt: "Inspect it" }),
      event("opencode", 2, "reasoning.summary.delta", { delta: "", boundary: true, status: "working" }, "opencode-thought-1"),
      event("opencode", 3, "plan.updated", { steps: [{ step: "Inspect", status: "in-progress" }] }, "current-plan"),
      event("opencode", 4, "assistant.completed", { text: "Done" }, "opencode-message-1"),
    ],
  },
  {
    runtimeId: "pi",
    events: [
      event("pi", 1, "turn.started", { prompt: "Inspect it" }),
      event("pi", 2, "reasoning.summary.delta", { delta: "", boundary: true }, "pi-reasoning-1"),
      event("pi", 3, "tool.started", { kind: "command", tool: "bash", label: "Run command", status: "running" }, "pi-tool-1"),
      event("pi", 4, "tool.completed", { kind: "command", tool: "bash", label: "Run command", status: "completed" }, "pi-tool-1"),
      event("pi", 5, "assistant.completed", { text: "Done" }, "pi-message-1"),
    ],
  },
] satisfies Array<{ runtimeId: string; events: AgentEvent[] }>;

const terminalScenarios = [
  { terminalType: "turn.completed", expectedStatus: "completed" },
  { terminalType: "turn.failed", expectedStatus: "failed" },
  { terminalType: "turn.interrupted", expectedStatus: "interrupted" },
] as const;

describe("Desktop Agent normalized Harness lifecycle conformance", () => {
  const cases = harnessFixtures.flatMap((fixture) => terminalScenarios.map((terminal) => ({ ...fixture, ...terminal })));

  it("defines the complete shared set of live activity states", () => {
    expect([...LIVE_AGENT_ACTIVITY_STATUSES]).toEqual([
      "queued",
      "running",
      "pending",
      "in-progress",
      "waiting-for-user",
    ]);
  });

  it.each(cases)("settles every $runtimeId child on $terminalType", ({ runtimeId, events, terminalType, expectedStatus }) => {
    const sequence = Math.max(...events.map((entry) => entry.sequence)) + 1;
    const pendingTurnState = [
      event(runtimeId, sequence, "provider.connection.updated", {
        state: "reconnecting",
        message: "Reconnecting",
        attempt: 1,
        maxAttempts: 5,
      }),
      event(runtimeId, sequence + 1, "approval.requested", {
        requestId: `${runtimeId}-approval`,
        kind: "command",
      }, `${runtimeId}-approval`),
      event(runtimeId, sequence + 2, "question.requested", {
        requestId: `${runtimeId}-question`,
        questions: [],
      }, `${runtimeId}-question`),
    ];
    const terminal = event(runtimeId, sequence + pendingTurnState.length, terminalType, { status: expectedStatus });
    const projection = applyAgentEvents(createAgentProjection(), [...events, ...pendingTurnState, terminal]);
    const turn = projection.turns.find((entry) => entry.id === "turn-1");
    const liveActivities = projection.activities.filter((activity) => LIVE_AGENT_ACTIVITY_STATUSES.has(activity.status));
    const liveParts = projection.parts.filter((part) => (
      "status" in part && typeof part.status === "string" && LIVE_AGENT_ACTIVITY_STATUSES.has(part.status)
    ));

    expect(turn).toMatchObject({ status: expectedStatus });
    expect(projection.runningTurnId).toBeNull();
    expect(projection.connectionStatus).toBeNull();
    expect(projection.approvals).toHaveLength(0);
    expect(projection.questions).toHaveLength(0);
    expect(projection.parts.find((part) => part.kind === "permission")).toMatchObject({ state: "resolved" });
    expect(projection.parts.find((part) => part.kind === "question")).toMatchObject({ state: "resolved" });
    expect(liveActivities).toEqual([]);
    expect(liveParts).toEqual([]);
    expect(projection.parts.filter((part) => part.kind === "reasoning")).toEqual([
      expect.objectContaining({ turnId: "turn-1", status: expectedStatus }),
    ]);
    expect(projection.parts.find((part) => part.kind === "assistant")).toMatchObject({
      streaming: false,
      terminalState: expectedStatus,
    });
  });

  it.each(harnessFixtures)("keeps $runtimeId semantic rows stable across later completion events", ({ runtimeId }) => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(runtimeId, 1, "turn.started", { prompt: "Inspect it" }),
      event(runtimeId, 2, "assistant.delta", { delta: "Inspecting" }, "shared-message"),
      event(runtimeId, 3, "tool.started", {
        kind: "command",
        tool: "shell",
        label: "List",
        status: "running",
      }, "shared-tool"),
      event(runtimeId, 4, "tool.completed", {
        kind: "command",
        tool: "shell",
        label: "List",
        status: "completed",
      }, "shared-tool"),
      event(runtimeId, 5, "assistant.completed", { text: "Done" }, "shared-message"),
      event(runtimeId, 6, "turn.completed", { status: "completed" }),
    ]);
    const timeline = buildAgentTimeline(projection);

    expect(timeline.rows.map((row) => row.kind)).toEqual([
      "user",
      "assistant",
      "command",
      "assistant",
      "turn-summary",
    ]);
    expect(timeline.rows.filter((row) => row.kind === "assistant")).toEqual([
      expect.objectContaining({ sequence: 2, updatedSequence: 2 }),
      expect.objectContaining({ sequence: 5, updatedSequence: 5 }),
    ]);
    expect(timeline.rows.find((row) => row.kind === "command")).toMatchObject({
      sequence: 3,
      updatedSequence: 4,
    });
  });
});

function event<T extends AgentEvent["type"]>(
  provider: string,
  sequence: number,
  type: T,
  payload: AgentEventPayloadMap[T] & Record<string, unknown>,
  itemId: string | null = null,
): AgentEvent<T> {
  return defineAgentEvent<T>({
    schemaVersion: 1,
    sequence,
    sessionId: `session-${provider}`,
    provider,
    providerSessionId: `${provider}-native-session`,
    turnId: "turn-1",
    itemId,
    emittedAt: new Date(sequence * 1000).toISOString(),
    type,
    payload,
  });
}
