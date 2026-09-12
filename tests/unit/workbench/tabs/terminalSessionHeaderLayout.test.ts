import { describe, expect, it } from "vitest";
import {
  resolveTerminalSessionHeaderLayout,
  TERMINAL_SESSION_HEADER_METRICS,
} from "../../../../src/features/desktop-terminal/model/terminalSessionHeaderLayout";

const sessionIds = ["a", "b", "c", "d", "e", "f"];

describe("Terminal Session Header adaptive layout", () => {
  it("uses equal full tabs and narrows them before compacting", () => {
    expect(resolve(900)).toMatchObject({
      mode: "full",
      activeTabWidth: 144,
      inactiveTabWidth: 144,
      hiddenSessionIds: [],
    });
    expect(resolve(650)).toMatchObject({
      mode: "full",
      activeTabWidth: 105,
      inactiveTabWidth: 105,
      hiddenSessionIds: [],
    });
  });

  it("keeps the active tab full while reducing every inactive tab to its icon", () => {
    const layout = resolve(420);
    expect(layout.mode).toBe("compact");
    expect(layout.activeTabWidth).toBe(144);
    expect(layout.inactiveTabWidth).toBe(TERMINAL_SESSION_HEADER_METRICS.compact);
    expect(layout.visibleSessionIds).toEqual(sessionIds);
    expect(layout.hiddenSessionIds).toEqual([]);
  });

  it("keeps the active tab and nearest icon tabs visible before overflowing", () => {
    const layout = resolve(250);
    expect(layout.mode).toBe("overflow");
    expect(layout.activeTabWidth).toBe(126);
    expect(layout.visibleSessionIds).toEqual(["b", "c", "d", "e"]);
    expect(layout.hiddenSessionIds).toEqual(["a", "f"]);
  });

  it("moves the visible window with the newly activated compact or hidden tab", () => {
    const layout = resolveTerminalSessionHeaderLayout({
      sessionIds,
      activeSessionId: "f",
      availableWidth: 188,
    });
    expect(layout.mode).toBe("overflow");
    expect(layout.visibleSessionIds).toEqual(["e", "f"]);
    expect(layout.hiddenSessionIds).toEqual(["a", "b", "c", "d"]);
  });

  it("preserves the visible window when activation moves between rendered tabs", () => {
    const initial = resolve(250);
    const next = resolveTerminalSessionHeaderLayout({
      sessionIds,
      activeSessionId: "e",
      availableWidth: 250,
      preferredVisibleSessionIds: initial.visibleSessionIds,
    });

    expect(initial.visibleSessionIds).toEqual(["b", "c", "d", "e"]);
    expect(next.visibleSessionIds).toEqual(initial.visibleSessionIds);
    expect(next.hiddenSessionIds).toEqual(["a", "f"]);
  });

  it("anchors activation to the physical edge implied by session direction", () => {
    const ids = ["left", "right", "tail"];
    const leftActive = resolveTerminalSessionHeaderLayout({
      sessionIds: ids,
      activeSessionId: "left",
      availableWidth: 206,
    });
    const rightActive = resolveTerminalSessionHeaderLayout({
      sessionIds: ids,
      activeSessionId: "right",
      availableWidth: 206,
      preferredVisibleSessionIds: leftActive.visibleSessionIds,
    });
    const left = Object.fromEntries(leftActive.tabBounds.map((bounds) => [bounds.sessionId, bounds]));
    const right = Object.fromEntries(rightActive.tabBounds.map((bounds) => [bounds.sessionId, bounds]));

    expect(leftActive.tabsWidth).toBe(206);
    expect(rightActive.tabsWidth).toBe(206);
    expect(left.left.inlineStart).toBe(right.left.inlineStart);
    expect(left.right.inlineStart + left.right.width)
      .toBe(right.right.inlineStart + right.right.width);
    expect(right.right.inlineStart).toBeLessThan(left.right.inlineStart);
  });

  function resolve(availableWidth: number) {
    return resolveTerminalSessionHeaderLayout({
      sessionIds,
      activeSessionId: "d",
      availableWidth,
    });
  }
});
