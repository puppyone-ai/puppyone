import { finalizeDisplay } from "../../../support/agent/agentDisplayFixture";
import { describe, expect, it } from "vitest";
import { createAgentProjection, type AgentPart, type TimelineRow } from "../../../support/agent/agentDisplayFixture";
import {
  agentTimelineLimits,
  agentTimelineSpacing,
  buildAgentTimelineLayout,
  visibleAgentTimelineRange,
} from "../../../../src/features/desktop-agent/ui/transcript/transcript-layout";
import { buildAgentTimeline } from "../../../../src/features/desktop-agent/ui/transcript/transcript-rows";

describe("Desktop Agent timeline layout policy", () => {
  it("uses one deterministic rhythm for work flow and turn handoffs", () => {
    const rows = [
      row("user:one", "user", "turn:one", 1, 40),
      row("assistant:one", "assistant", "turn:one", 2, 80),
      row("turn-summary:one", "turn-summary", "turn:one", 3, 20),
      row("user:two", "user", "turn:two", 4, 40),
    ];

    const layout = buildAgentTimelineLayout(rows, {});

    expect(layout.gaps).toEqual([
      agentTimelineSpacing.turnHandoff,
      agentTimelineSpacing.workHandoff,
      agentTimelineSpacing.turnHandoff,
      agentTimelineSpacing.turnHandoff,
    ]);
    expect(layout.offsets).toEqual([0, 64, 152, 196, 260]);
  });

  it("recomputes the handoff when a new user turn is appended after a settled summary", () => {
    const settled = [
      row("assistant:one", "assistant", "turn:one", 1, 40),
      row("turn-summary:one", "turn-summary", "turn:one", 2, 20),
    ];
    const measurements = {
      "row:assistant:one": 40,
      "row:turn-summary:one": 20,
    };

    const before = buildAgentTimelineLayout(settled, measurements);
    const after = buildAgentTimelineLayout([
      ...settled,
      row("user:two", "user", "turn:two", 3, 40),
    ], measurements);

    expect(before.gaps[1]).toBe(agentTimelineSpacing.workHandoff);
    expect(after.gaps[1]).toBe(agentTimelineSpacing.turnHandoff);
    expect(after.offsets[2]).toBe(92);
  });

  it("keeps semantic spacing independent from content remeasurement", () => {
    const rows = [
      row("assistant:one", "assistant", "turn:one", 1, 40),
      row("turn-summary:one", "turn-summary", "turn:one", 2, 20),
      row("user:two", "user", "turn:two", 3, 40),
    ];
    const compactSummary = buildAgentTimelineLayout(rows, { "row:turn-summary:one": 20 });
    const wrappedSummary = buildAgentTimelineLayout(rows, { "row:turn-summary:one": 56 });

    expect(compactSummary.gaps).toEqual(wrappedSummary.gaps);
    expect(wrappedSummary.offsets[2] - compactSummary.offsets[2]).toBe(36);
    expect(
      wrappedSummary.offsets[2]
        - wrappedSummary.offsets[1]
        - 56,
    ).toBe(agentTimelineSpacing.turnHandoff);
  });

  it("removes non-visual usage state before it can affect row adjacency", () => {
    const projection = createAgentProjection();
    const assistant: AgentPart = {
      id: "assistant:one",
      turnId: "turn:one",
      itemId: "message:one",
      kind: "assistant",
      text: "Done",
      streaming: false,
      terminalState: "completed",
      sequence: 1,
    };
    const usage: AgentPart = {
      id: "usage:current",
      turnId: "turn:one",
      itemId: null,
      kind: "usage",
      usage: { outputTokens: 12 },
      sequence: 2,
    };
    const user: AgentPart = {
      id: "user:two",
      turnId: "turn:two",
      itemId: null,
      kind: "user",
      text: "Next request",
      streaming: false,
      terminalState: null,
      sequence: 4,
    };
    projection.parts = [assistant, usage, user];
    projection.rows = projection.parts.map((part) => row(
      part.id,
      part.kind,
      part.turnId,
      part.sequence,
      part.kind === "assistant" ? 40 : 36,
    ));
    projection.turns = [{
      id: "turn:one",
      status: "completed",
      startedAtSequence: 1,
      startedAtMs: 0,
      completedAtSequence: 3,
      durationMs: 7_000,
      partIds: [assistant.id, usage.id],
    }];

    const timeline = buildAgentTimeline(finalizeDisplay(projection), 34);
    const layout = buildAgentTimelineLayout(timeline.rows, {
      "row:assistant:one": 40,
      "row:turn-summary:turn:one": 20,
      "row:user:two": 40,
    });

    expect(timeline.rows.map((entry) => entry.kind)).toEqual(["assistant", "turn-summary", "user"]);
    expect(timeline.rows.find((entry) => entry.kind === "turn-summary")?.estimatedHeight).toBe(34);
    expect(timeline.rows.some((entry) => entry.partId === usage.id)).toBe(false);
    expect(layout.gaps[1]).toBe(agentTimelineSpacing.turnHandoff);
    expect(layout.offsets[2] - layout.offsets[1] - 20).toBe(agentTimelineSpacing.turnHandoff);
  });

  it("retains full-timeline gaps when the mounted window crosses a virtualization boundary", () => {
    const rows = Array.from({ length: 400 }, (_, index) => row(
      `user:${index}`,
      "user",
      `turn:${index}`,
      index + 1,
      40,
    ));
    const layout = buildAgentTimelineLayout(rows, {});
    const range = visibleAgentTimelineRange(layout.offsets, rows.length, 6_000, 640);

    expect(range.end - range.start).toBeLessThanOrEqual(agentTimelineLimits.maxMountedRows);
    expect(range.start).toBeGreaterThan(0);
    expect(layout.gaps[range.start - 1]).toBe(agentTimelineSpacing.turnHandoff);
    expect(layout.gaps[range.end - 1]).toBe(agentTimelineSpacing.turnHandoff);
  });
});

function row(
  partId: string,
  kind: TimelineRow["kind"],
  turnId: string | null,
  sequence: number,
  estimatedHeight: number,
): TimelineRow {
  return {
    id: `row:${partId}`,
    partId,
    turnId,
    kind,
    sequence,
    estimatedHeight,
  };
}
