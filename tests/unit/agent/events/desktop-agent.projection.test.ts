import { describe, expect, it } from "vitest";
import {
  agentProjectionLimits,
  applyAgentEvent,
  applyAgentEvents,
  createAgentProjection,
} from "../../../support/agent/agentDisplayFixture";
import type { AgentEvent, AgentEventType } from "../../../../src/features/desktop-agent/agentTypes";
import { buildAgentTimeline } from "../../../../src/features/desktop-agent/ui/transcript/transcript-rows";

describe("Desktop Agent transcript projection", () => {
  it("concatenates assistant deltas and lets completed content finalize authoritatively", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: "Fix the test" }, "turn-1"),
      event(2, "assistant.delta", { delta: "I found " }, "turn-1", "message-1"),
      event(3, "assistant.delta", { delta: "the issue." }, "turn-1", "message-1"),
      event(4, "assistant.completed", { text: "I found and fixed the issue." }, "turn-1", "message-1"),
      event(5, "turn.completed", { status: "completed" }, "turn-1"),
    ]);

    expect(projection.messages).toHaveLength(2);
    expect(projection.messages[0]).toMatchObject({ role: "user", text: "Fix the test" });
    expect(projection.messages[1]).toMatchObject({
      role: "assistant",
      text: "I found and fixed the issue.",
      streaming: false,
      terminalState: "completed",
    });
    expect(projection.turns[0]).toMatchObject({
      status: "completed",
      startedAtMs: 1_000,
      userWaitStartedAtMs: null,
      userWaitDurationMs: 0,
      durationMs: 4_000,
    });
  });

  it("confirms the optimistic prompt by native identity and preserves same-turn follow-ups", () => {
    const events = [
      event(1, "turn.started", { prompt: "Initial", userMessageId: "user-initial" }, "turn-user"),
      event(2, "user.message", { text: "Initial\nProvider-compiled context", clientUserMessageId: "user-initial" }, "turn-user", "user-initial"),
      event(3, "user.message", { text: "Follow up" }, "turn-user", "user-followup"),
      event(4, "user.message", { text: "Follow up" }, "turn-user", "user-followup"),
    ] satisfies AgentEvent[];
    const projection = applyAgentEvents(createAgentProjection(), events);

    expect(projection.messages.filter((message) => message.role === "user")).toEqual([
      expect.objectContaining({
        id: "user:user-initial",
        itemId: "user-initial",
        text: "Initial",
        sequence: 1,
        updatedSequence: 2,
      }),
      expect.objectContaining({
        id: "user:user-followup",
        itemId: "user-followup",
        text: "Follow up",
        sequence: 3,
        updatedSequence: 4,
      }),
    ]);
    expect(buildAgentTimeline(projection).rows.map((row) => row.kind)).toEqual(["user", "user"]);
  });

  it("does not interpret a recoverable content diagnostic as live connection state", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: "Hello" }, "turn-warning"),
      event(2, "provider.warning", {
        message: "Optional content could not be displayed.",
        recoverable: true,
      }, "turn-warning", "content-warning"),
    ]);

    expect(projection.connectionStatus).toBeNull();
    expect(projection.activities).toEqual([
      expect.objectContaining({ kind: "warning", label: "Optional content could not be displayed." }),
    ]);
  });

  it("keeps first-observed timeline order immutable while blocks stream and settle", () => {
    const events = [
      event(1, "turn.started", { prompt: "Inspect it" }, "turn-order"),
      event(2, "assistant.delta", { delta: "I will inspect it." }, "turn-order", "assistant-order"),
      event(3, "tool.started", { kind: "command", label: "List", status: "running" }, "turn-order", "tool-order"),
      event(4, "approval.requested", {
        requestId: "approval-order",
        kind: "command",
        title: "List files",
      }, "turn-order", "tool-order"),
      event(5, "approval.resolved", { requestId: "approval-order", decision: "accept" }, "turn-order", "tool-order"),
      event(6, "tool.completed", { kind: "command", label: "List", status: "completed" }, "turn-order", "tool-order"),
      event(7, "assistant.completed", { text: "Inspection complete." }, "turn-order", "assistant-order"),
      event(8, "turn.completed", { status: "completed" }, "turn-order"),
    ] satisfies AgentEvent[];

    const waiting = applyAgentEvents(createAgentProjection(), events.slice(0, 4));
    const live = applyAgentEvents(createAgentProjection(), events.slice(0, 7));
    const settled = applyAgentEvent(live, events[7]);
    const replayed = applyAgentEvents(createAgentProjection(), events);
    const visibleKinds = (projection: typeof settled) => buildAgentTimeline(projection).rows
      .filter((row) => row.kind !== "turn-summary")
      .map((row) => row.kind);

    expect(visibleKinds(waiting)).toEqual(["user", "assistant", "command"]);
    expect(waiting.approvals).toEqual([expect.objectContaining({ requestId: "approval-order" })]);
    expect(visibleKinds(live)).toEqual(["user", "assistant", "command", "assistant"]);
    expect(visibleKinds(settled)).toEqual(["user", "assistant", "command", "assistant"]);
    expect(visibleKinds(replayed)).toEqual(["user", "assistant", "command", "assistant"]);
    expect(live.parts.filter((part) => part.kind === "assistant")).toEqual([
      expect.objectContaining({
        sequence: 2,
        updatedSequence: 2,
        text: "I will inspect it.",
        streaming: false,
      }),
      expect.objectContaining({
        sequence: 7,
        updatedSequence: 7,
        text: "Inspection complete.",
      }),
    ]);
    expect(live.parts.find((part) => part.kind === "command")).toMatchObject({
      sequence: 3,
      updatedSequence: 6,
      status: "completed",
    });
    expect(live.parts.find((part) => part.kind === "permission")).toMatchObject({
      sequence: 4,
      updatedSequence: 5,
      state: "resolved",
    });
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(settled));
    expect(settled.turns[0]).toMatchObject({
      userWaitStartedAtMs: null,
      userWaitDurationMs: 1_000,
    });
  });

  it("keeps a native assistant item segmented when its authoritative completion spans a tool", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: "Inspect" }, "turn-segments"),
      event(2, "assistant.delta", { delta: "Before tool. " }, "turn-segments", "native-message"),
      event(3, "tool.started", { kind: "command", label: "List", status: "running" }, "turn-segments", "tool"),
      event(4, "tool.completed", { kind: "command", label: "List", status: "completed" }, "turn-segments", "tool"),
      event(5, "assistant.delta", { delta: "After " }, "turn-segments", "native-message"),
      event(6, "assistant.delta", { delta: "tool." }, "turn-segments", "native-message"),
      event(7, "assistant.completed", { text: "Before tool. After tool." }, "turn-segments", "native-message"),
    ]);

    expect(projection.messages.filter((message) => message.role === "assistant").map((message) => message.text))
      .toEqual(["Before tool. ", "After tool."]);
    expect(buildAgentTimeline(projection).rows.map((row) => row.kind))
      .toEqual(["user", "assistant", "command", "assistant"]);
  });

  it("seals rather than erases assistant text when a late completion adds nothing after a tool", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: "Inspect" }, "turn-seal"),
      event(2, "assistant.delta", { delta: "I will inspect." }, "turn-seal", "native-message"),
      event(3, "tool.started", { kind: "command", label: "List", status: "running" }, "turn-seal", "tool"),
      event(4, "tool.completed", { kind: "command", label: "List", status: "completed" }, "turn-seal", "tool"),
      event(5, "assistant.completed", { text: "I will inspect." }, "turn-seal", "native-message"),
    ]);

    expect(projection.messages.filter((message) => message.role === "assistant")).toEqual([
      expect.objectContaining({ text: "I will inspect.", streaming: false, sequence: 2, updatedSequence: 5 }),
    ]);
    expect(buildAgentTimeline(projection).rows.map((row) => row.kind))
      .toEqual(["user", "assistant", "command"]);
  });

  it("prefers the provider's normalized turn duration over envelope timing", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: "Measure" }, "turn-duration"),
      event(9, "turn.completed", { status: "completed", durationMs: 2_450 }, "turn-duration"),
    ]);

    expect(projection.turns[0]?.durationMs).toBe(2_450);
  });

  it("keeps usage metadata out of visible transcript rows", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: "Measure" }, "turn-usage"),
      event(2, "usage.updated", { inputTokens: 20, outputTokens: 5 }, "turn-usage"),
    ]);

    expect(projection.usage).toEqual({ inputTokens: 20, outputTokens: 5 });
    expect(projection.parts.find((part) => part.kind === "usage")).toMatchObject({
      usage: { inputTokens: 20, outputTokens: 5 },
    });
    expect(projection.rows.some((row) => row.kind === "usage")).toBe(false);
  });

  it("ignores duplicates, marks gaps, and keeps partial assistant text after interruption", () => {
    let projection = applyAgentEvent(createAgentProjection(), event(1, "turn.started", { prompt: "Go" }, "turn-1"));
    projection = applyAgentEvent(projection, event(3, "assistant.delta", { delta: "Partial" }, "turn-1", "message-1"));
    projection = applyAgentEvent(projection, event(3, "assistant.delta", { delta: " duplicate" }, "turn-1", "message-1"));
    projection = applyAgentEvent(projection, event(4, "turn.interrupted", {}, "turn-1"));

    expect(projection.history.coverage).toBe("not-requested");
    expect(projection.displayWindow.truncated).toBe(false);
    expect(projection.missingRanges).toEqual([{ from: 2, to: 2 }]);
    expect(projection.messages[1]).toMatchObject({ text: "Partial", terminalState: "interrupted" });
  });

  it("tracks tool lifecycle, bounded command output, and stale approval removal", () => {
    const largeOutput = "x".repeat(80 * 1024);
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "tool.started", { kind: "command", label: "npm test", status: "running" }, "turn-1", "tool-1"),
      event(2, "command.output.delta", { delta: largeOutput }, "turn-1", "tool-1"),
      event(3, "approval.requested", {
        requestId: "codex:7",
        kind: "command",
        title: "Run command",
        availableDecisions: ["accept", "decline"],
      }, "turn-1", "tool-1"),
      event(4, "tool.completed", { kind: "command", label: "npm test", status: "completed" }, "turn-1", "tool-1"),
      event(5, "approval.resolved", { requestId: "codex:7", decision: "decline" }, "turn-1", "tool-1"),
    ]);

    expect(projection.activities[0]).toMatchObject({ status: "completed", label: "npm test" });
    expect(projection.activities[0].output.length).toBe(64 * 1024);
    expect(projection.approvals).toEqual([]);
  });

  it("keeps the first command output delta even without a preceding tool event", () => {
    const projection = applyAgentEvent(
      createAgentProjection(),
      event(1, "command.output.delta", { delta: "first output" }, "turn-1", "tool-1"),
    );
    expect(projection.activities[0]?.output).toBe("first output");
  });

  it("preserves canonical tool identity and upgrades legacy arguments to structured input", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "tool.started", {
        kind: "read",
        tool: "read",
        label: "Read file",
        path: "src/App.tsx",
        arguments: { file_path: "src/App.tsx" },
        status: "running",
      }, "turn-tools", "read-1"),
      event(2, "tool.completed", {
        kind: "read",
        tool: "read",
        label: "Read file",
        status: "completed",
        outputPreview: "export function App() {}",
      }, "turn-tools", "read-1"),
    ]);

    expect(projection.activities[0]).toMatchObject({
      kind: "tool",
      status: "completed",
      detail: {
        tool: "read",
        path: "src/App.tsx",
        input: { file_path: "src/App.tsx" },
        outputPreview: "export function App() {}",
      },
    });
  });

  it("does not project empty file-change placeholders and removes a cleared session diff", () => {
    let projection = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: "Inspect" }, "turn-file"),
      event(2, "file.change.updated", { status: "completed", changes: [] }, "turn-file", "session-diff"),
    ]);
    expect(projection.activities.filter((activity) => activity.kind === "file-change")).toHaveLength(0);
    expect(projection.parts.filter((part) => part.kind === "file-change")).toHaveLength(0);

    projection = applyAgentEvent(projection, event(3, "file.change.updated", {
      status: "completed",
      changes: [{ path: "src/app.ts", additions: 2, deletions: 1 }],
    }, "turn-file", "session-diff"));
    expect(projection.activities.filter((activity) => activity.kind === "file-change")).toHaveLength(1);

    projection = applyAgentEvent(projection, event(4, "file.change.updated", {
      status: "completed",
      changes: [],
    }, "turn-file", "session-diff"));
    expect(projection.activities.filter((activity) => activity.kind === "file-change")).toHaveLength(0);
    expect(projection.parts.filter((part) => part.kind === "file-change")).toHaveLength(0);
    expect(projection.rows.some((row) => row.partId === "activity:session-diff")).toBe(false);
  });

  it("bounds streamed messages and reasoning before they reach renderer state", () => {
    const oversized = "x".repeat(agentProjectionLimits.maxMessageText * 2);
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: oversized }, "turn-bound"),
      event(2, "assistant.delta", { delta: oversized }, "turn-bound", "message-bound"),
      event(3, "assistant.delta", { delta: oversized }, "turn-bound", "message-bound"),
      event(4, "reasoning.summary.delta", { delta: oversized }, "turn-bound", "reasoning-bound"),
      event(5, "reasoning.summary.delta", { delta: oversized }, "turn-bound", "reasoning-bound"),
    ]);

    expect(projection.messages[0].text).toHaveLength(agentProjectionLimits.maxMessageText);
    expect(projection.messages[1].text).toHaveLength(agentProjectionLimits.maxMessageText);
    expect(String(projection.activities[0].detail.delta)).toHaveLength(agentProjectionLimits.maxActivityText);
  });

  it("renders legacy nested provider errors as readable text", () => {
    const projection = applyAgentEvent(createAgentProjection(), event(1, "provider.error", {
      message: JSON.stringify({
        type: "error",
        error: { message: "Invalid value: 'max'. Use 'xhigh'.", param: "reasoning.effort" },
        status: 400,
      }),
    }, "turn-1"));

    expect(projection.activities[0].label).toBe("Invalid value: 'max'. Use 'xhigh'.");
  });

  it("drops legacy lifecycle-only system-error notices and keeps the actionable diagnostic", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "provider.error", { message: "Codex thread entered a system error state." }, "turn-1"),
      event(2, "provider.error", { message: "Invalid value: 'max'. Supported value is 'xhigh'." }, "turn-1"),
    ]);

    expect(projection.activities.map((activity) => activity.label)).toEqual([
      "Invalid value: 'max'. Supported value is 'xhigh'.",
    ]);
    expect(projection.parts.filter((part) => part.kind === "error")).toHaveLength(1);
  });

  it("normalizes unrecognized provider activity status to a neutral unknown state", () => {
    const projection = applyAgentEvent(createAgentProjection(), event(1, "provider.activity", {
      label: "Future provider activity",
      status: "teleporting",
    }, "turn-1", "activity-1"));

    expect(projection.activities[0]).toMatchObject({ status: "unknown" });
    expect(projection.parts.find((part) => part.kind === "tool")).toMatchObject({ status: "unknown" });
  });

  it("keeps connection recovery as one replaceable live state outside transcript history", () => {
    const recovering = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: "Hello" }, "turn-1"),
      event(2, "provider.connection.updated", {
        state: "reconnecting",
        message: "Reconnecting… 2/5",
        attempt: 2,
        maxAttempts: 5,
      }, "turn-1"),
      event(3, "provider.connection.updated", {
        state: "reconnecting",
        message: "Reconnecting… 3/5",
        attempt: 3,
        maxAttempts: 5,
      }, "turn-1"),
      event(4, "provider.connection.updated", {
        state: "fallback",
        message: "Switching connection transport.",
      }, "turn-1"),
    ]);

    expect(recovering.connectionStatus).toMatchObject({
      state: "fallback",
      message: "Switching connection transport.",
      turnId: "turn-1",
      sequence: 4,
    });
    expect(recovering.activities).toHaveLength(0);
    expect(recovering.parts.filter((part) => part.kind === "warning")).toHaveLength(0);
    expect(recovering.rows.filter((row) => row.kind === "warning")).toHaveLength(0);

    const progressed = applyAgentEvent(recovering, event(5, "assistant.delta", { delta: "Recovered" }, "turn-1", "assistant-1"));
    expect(progressed.connectionStatus?.state).toBe("fallback");
    expect(applyAgentEvent(progressed, event(6, "turn.completed", {}, "turn-1")).connectionStatus).toBeNull();
    expect(progressed.messages.find((message) => message.role === "assistant")?.text).toBe("Recovered");
  });

  it("migrates legacy retry and transport-fallback warnings without retaining historical cards", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: "Hello" }, "turn-1"),
      event(2, "provider.warning", { message: "Reconnecting… 2/5", recoverable: true }, "turn-1", "retry-2"),
      event(3, "provider.warning", { message: "Reconnecting… 3/5", recoverable: true }, "turn-1", "retry-3"),
      event(4, "provider.warning", {
        message: "Falling back from WebSockets to HTTPS transport. request timed out",
      }, "turn-1", "fallback"),
    ], { legacyProviderConnectionWarnings: true });

    expect(projection.connectionStatus).toBeNull();
    expect(projection.activities).toHaveLength(0);
    expect(projection.parts.filter((part) => part.kind === "warning")).toHaveLength(0);
    expect(projection.rows.filter((row) => row.kind === "warning")).toHaveLength(0);
  });

  it.each(["turn.completed", "turn.failed", "turn.interrupted"] as const)("clears live connection state on %s", (type) => {
    const recovering = applyAgentEvent(createAgentProjection(), event(1, "provider.connection.updated", {
      state: "reconnecting",
      message: "Reconnecting… 5/5",
    }, "turn-1"));

    expect(applyAgentEvent(recovering, event(2, type, { status: type.slice(5) }, "turn-1")).connectionStatus).toBeNull();
  });

  it.each([
    ["turn.completed", "completed"],
    ["turn.failed", "failed"],
    ["turn.interrupted", "interrupted"],
  ] as const)("settles orphaned live activity and blocking state on %s", (type, expectedStatus) => {
    const running = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: "Run it" }, "turn-1"),
      event(2, "tool.started", { kind: "command", label: "Long command", status: "running" }, "turn-1", "tool-1"),
      event(3, "approval.requested", { requestId: "approval-1", kind: "command" }, "turn-1", "tool-1"),
      event(4, "question.requested", { requestId: "question-1", questions: [] }, "turn-1", "question-1"),
    ]);

    const settled = applyAgentEvent(running, event(5, type, { status: expectedStatus }, "turn-1"));
    expect(settled.activities[0]?.status).toBe("unknown");
    expect(settled.parts.find((part) => part.kind === "command")).toMatchObject({ status: "unknown" });
    expect(settled.parts.find((part) => part.kind === "permission")).toMatchObject({ state: "resolved" });
    expect(settled.parts.find((part) => part.kind === "question")).toMatchObject({ state: "resolved" });
    expect(settled.approvals).toHaveLength(0);
    expect(settled.questions).toHaveLength(0);
  });

  it("collapses duplicate provider terminal errors for the same turn", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: "Hello" }, "turn-1"),
      event(2, "provider.warning", { message: "API key not valid. Please pass a valid API key." }, "turn-1", "retry-1"),
      event(3, "provider.error", { message: "API key not valid. Please pass a valid API key." }, "turn-1", "assistant-1"),
      event(4, "turn.failed", { status: "failed", message: "API key not valid." }, "turn-1"),
      event(5, "provider.error", { message: "API key not valid. Please pass a valid API key." }, null, "assistant-2"),
    ]);

    expect(projection.activities.filter((activity) => activity.kind === "error")).toHaveLength(1);
    expect(projection.activities.filter((activity) => activity.kind === "warning")).toHaveLength(0);
    expect(projection.parts.filter((part) => part.kind === "error")).toHaveLength(1);
    expect(projection.activities.find((activity) => activity.kind === "error")?.label)
      .toBe("API key not valid. Please pass a valid API key.");
  });

  it("does not merge the same provider failure across separate turns", () => {
    const projection = applyAgentEvents(createAgentProjection(), [
      event(1, "turn.started", { prompt: "First" }, "turn-1"),
      event(2, "provider.error", { message: "API key not valid." }, "turn-1", "assistant-1"),
      event(3, "turn.failed", { status: "failed" }, "turn-1"),
      event(4, "turn.started", { prompt: "Second" }, "turn-2"),
      event(5, "provider.error", { message: "API key not valid." }, "turn-2", "assistant-2"),
    ]);

    expect(projection.activities.filter((activity) => activity.kind === "error")).toHaveLength(2);
    expect(new Set(projection.activities.map((activity) => activity.turnId))).toEqual(new Set(["turn-1", "turn-2"]));
  });

  it("keeps sanitized reference display identity stable across committed projection and replay", () => {
    const started = event(1, "turn.started", {
      prompt: "Review these",
      referenceDisplays: [
        { id: "workspace-a", kind: "workspace-file", displayName: "a.md", relativePath: "docs/a.md" },
        { id: "attachment-b", kind: "attachment", displayName: "capture.png", mime: "image/png", size: 128 },
      ],
    }, "turn-reference");
    const committed = applyAgentEvent(createAgentProjection(), started);
    const replayed = applyAgentEvents(createAgentProjection(), [started]);

    expect(committed.messages[0]).toMatchObject({
      role: "user",
      references: [
        { id: "workspace-a", relativePath: "docs/a.md" },
        { id: "attachment-b", displayName: "capture.png", size: 128 },
      ],
    });
    expect(committed.parts.find((part) => part.kind === "user")).toMatchObject({ references: committed.messages[0].references });
    expect(replayed.messages[0].references).toEqual(committed.messages[0].references);
    expect(JSON.stringify(committed)).not.toMatch(/token|snapshotUrl|data:image|\/private\//);
  });
});

function event(
  sequence: number,
  type: AgentEventType,
  payload: Record<string, unknown>,
  turnId: string | null = null,
  itemId: string | null = null,
): AgentEvent {
  return {
    schemaVersion: 1,
    sequence,
    sessionId: "session-1",
    provider: "codex",
    providerSessionId: "thread-1",
    turnId,
    itemId,
    emittedAt: new Date(sequence * 1000).toISOString(),
    type,
    payload,
  };
}
