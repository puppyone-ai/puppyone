import { describe, expect, it } from "vitest";
import {
  STICKY_LIST_END_FADE_THRESHOLDS,
  resolveStickyListEndFade,
  resolveStickyListEndMotionOffset,
} from "../../../../packages/shared-ui/src/data/explorer/stickyListEndMotion";

// Scrollport-bottom pin at content y=500 for every motion case below.
const pinnedTop = 500;

describe("sticky list-end motion", () => {
  it("travels with the rows while the tree fits before and after", () => {
    expect(resolveStickyListEndMotionOffset({ flowTop: 200, flowOffsetY: 102, pinnedTop })).toBe(102);
    expect(resolveStickyListEndMotionOffset({ flowTop: 300, flowOffsetY: -102, pinnedTop })).toBe(-102);
  });

  it("glides up from the pinned edge when a collapse makes the tree fit", () => {
    // The rows' previous end was far below the viewport; the band was pinned at 500.
    expect(resolveStickyListEndMotionOffset({ flowTop: 260, flowOffsetY: 900, pinnedTop })).toBe(240);
  });

  it("glides down to the pinned edge when an expansion makes the tree overflow", () => {
    expect(resolveStickyListEndMotionOffset({ flowTop: 1100, flowOffsetY: -800, pinnedTop })).toBe(-200);
  });

  it("stays still while it remains pinned", () => {
    expect(resolveStickyListEndMotionOffset({ flowTop: 1400, flowOffsetY: 300, pinnedTop })).toBe(0);
    expect(resolveStickyListEndMotionOffset({ flowTop: 1400, flowOffsetY: -300, pinnedTop })).toBe(0);
  });
});

describe("sticky list-end fade", () => {
  it("maps how much of the sentinel is clipped to how strongly rows fade", () => {
    expect(resolveStickyListEndFade(1)).toBe(0);
    expect(resolveStickyListEndFade(0.25)).toBe(0.75);
    expect(resolveStickyListEndFade(0)).toBe(1);
    // Defensive clamping for out-of-range observer reports.
    expect(resolveStickyListEndFade(1.02)).toBe(0);
    expect(resolveStickyListEndFade(-0.1)).toBe(1);
  });

  it("observes both edges and evenly spaced steps between them", () => {
    expect(STICKY_LIST_END_FADE_THRESHOLDS[0]).toBe(0);
    expect(STICKY_LIST_END_FADE_THRESHOLDS.at(-1)).toBe(1);
    expect(STICKY_LIST_END_FADE_THRESHOLDS).toHaveLength(21);
  });
});
