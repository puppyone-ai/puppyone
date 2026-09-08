import { describe, expect, it } from "vitest";
import type { TimelineRow } from "../src/features/desktop-agent/domain/agent-projection-types";
import { buildAgentTimelineLayout } from "../src/features/desktop-agent/ui/transcript/transcript-layout";
import {
  captureAgentTimelineScrollAnchor,
  resolveAgentTimelineScrollAnchor,
} from "../src/features/desktop-agent/ui/transcript/transcript-viewport";

describe("Desktop Agent timeline viewport anchoring", () => {
  it("keeps the same visible row coordinate when many earlier rows reflow together", () => {
    const rows = [row("one"), row("two"), row("three"), row("four")];
    const before = buildAgentTimelineLayout(rows, {
      one: 40,
      two: 40,
      three: 40,
      four: 40,
    });
    const timelineTop = 12;
    const anchor = captureAgentTimelineScrollAnchor(rows, before, 130, timelineTop);

    expect(anchor).toEqual({ kind: "row", rowId: "three", offset: 22 });

    const after = buildAgentTimelineLayout(rows, {
      one: 68,
      two: 56,
      three: 72,
      four: 40,
    });
    const rowIndex = new Map(rows.map((entry, index) => [entry.id, index]));
    expect(resolveAgentTimelineScrollAnchor(anchor, after, rowIndex, timelineTop)).toBe(174);
  });

  it("retains an absolute viewport coordinate above the virtual canvas", () => {
    const rows = [row("one")];
    const layout = buildAgentTimelineLayout(rows, { one: 40 });
    const anchor = captureAgentTimelineScrollAnchor(rows, layout, 8, 20);

    expect(anchor).toEqual({ kind: "absolute", scrollTop: 8 });
    expect(resolveAgentTimelineScrollAnchor(anchor, layout, new Map([["one", 0]]), 24)).toBe(8);
  });

  it("preserves the nearest surviving row coordinate when the anchored row is filtered", () => {
    const beforeRows = [row("one"), row("two"), row("three")];
    const before = buildAgentTimelineLayout(beforeRows, { one: 40, two: 40, three: 40 });
    const anchor = captureAgentTimelineScrollAnchor(beforeRows, before, 70, 0);
    const rows = [beforeRows[0], beforeRows[2]];
    const after = buildAgentTimelineLayout(rows, { one: 40, three: 40 });
    const restored = resolveAgentTimelineScrollAnchor(anchor, after, new Map([["one", 0], ["three", 1]]), 0, beforeRows, before);
    expect(restored).toBe(22);
    expect(after.offsets[1] - restored!).toBe(before.offsets[2] - 70);
  });

  it("does not guess a replacement row when the anchored row disappears", () => {
    const rows = [row("one"), row("two")];
    const layout = buildAgentTimelineLayout(rows, { one: 40, two: 40 });
    const anchor = captureAgentTimelineScrollAnchor(rows, layout, 70, 0);

    expect(resolveAgentTimelineScrollAnchor(anchor, layout, new Map([["one", 0]]), 0)).toBeNull();
  });
});

function row(id: string): TimelineRow {
  return {
    id,
    partId: id,
    turnId: "turn:one",
    kind: "assistant",
    sequence: 1,
    estimatedHeight: 40,
  };
}
