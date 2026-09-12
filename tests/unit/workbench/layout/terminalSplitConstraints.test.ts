import { describe, expect, it } from "vitest";
import { createWorkbenchSplit } from "@puppyone/shared-ui";
import {
  canPlaceTerminalSplit,
  terminalLeafMinimumSize,
  terminalSplitNodeMinimumSize,
  terminalSplitRatioBounds,
} from "../../../../src/features/desktop-terminal/model/terminalSplitConstraints";
import type { DesktopTerminalLayoutLeaf } from "../../../../src/features/desktop-terminal/model/terminalSessions";

describe("Terminal split constraints", () => {
  it("propagates mixed-axis minimums recursively", () => {
    const right = createWorkbenchSplit({
      id: "right",
      direction: "vertical",
      ratio: 0.5,
      first: leaf("b"),
      second: leaf("c"),
    });
    const root = createWorkbenchSplit({
      id: "root",
      direction: "horizontal",
      ratio: 0.5,
      first: leaf("a"),
      second: right,
    });

    expect(terminalSplitNodeMinimumSize(root, () => ({ width: 100, height: 80 })))
      .toEqual({ width: 201, height: 161 });
  });

  it("admits a split from measured cell-grid minimums rather than pane count", () => {
    const minimum = terminalLeafMinimumSize({ width: 172, height: 128 });
    expect(minimum).toEqual({ width: 188, height: 196 });
    expect(canPlaceTerminalSplit(
      { width: 377, height: 200 },
      "right",
      minimum,
      minimum,
    )).toBe(true);
    expect(canPlaceTerminalSplit(
      { width: 376, height: 200 },
      "right",
      minimum,
      minimum,
    )).toBe(false);
    expect(canPlaceTerminalSplit(
      { width: 300, height: 393 },
      "bottom",
      minimum,
      minimum,
    )).toBe(true);
    expect(canPlaceTerminalSplit(
      { width: 300, height: 392 },
      "bottom",
      minimum,
      minimum,
    )).toBe(false);
  });

  it("derives resize bounds from each recursive child minimum", () => {
    expect(terminalSplitRatioBounds(
      "horizontal",
      601,
      1,
      { width: 200, height: 100 },
      { width: 100, height: 100 },
    )).toEqual({ minimum: 0.333, maximum: 0.833 });

    expect(terminalSplitRatioBounds(
      "horizontal",
      201,
      1,
      { width: 200, height: 100 },
      { width: 100, height: 100 },
    )).toEqual({ minimum: 0.667, maximum: 0.667 });
  });
});

function leaf(groupId: string): DesktopTerminalLayoutLeaf {
  return Object.freeze({ kind: "group", id: groupId, groupId });
}
