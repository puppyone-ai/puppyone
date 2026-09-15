import { describe, expect, it } from "vitest";
import {
  buildTabularProjectionItems,
  calculateFixedTabularWindow,
  calculateVelocityAwareTabularOverscan,
  calculateVariableTabularWindow,
  createTabularOffsets,
} from "../../../../../packages/shared-ui/src/editor/table/tabularWindow";

describe("bounded tabular projection", () => {
  it("keeps a fixed row window bounded while advancing through the logical model", () => {
    const initial = calculateFixedTabularWindow({
      count: 10_000,
      itemSize: 31,
      maximumItems: 78,
      overscanItems: 8,
      scrollOffset: 0,
      viewportSize: 620,
    });
    const scrolled = calculateFixedTabularWindow({
      count: 10_000,
      itemSize: 31,
      maximumItems: 78,
      overscanItems: 8,
      scrollOffset: 7_500 * 31,
      viewportSize: 620,
    });

    expect(initial).toEqual({ start: 0, end: 28 });
    expect(scrolled.start).toBeGreaterThan(7_400);
    expect(scrolled.end - scrolled.start).toBeLessThanOrEqual(78);
  });

  it("uses prefix geometry to bound variable-width columns", () => {
    const offsets = createTabularOffsets(Array.from({ length: 256 }, (_, index) => 96 + index % 4));
    const range = calculateVariableTabularWindow({
      offsets,
      maximumItems: 20,
      overscanSize: 280,
      scrollOffset: offsets[120],
      viewportSize: 700,
    });

    expect(range.start).toBeLessThanOrEqual(120);
    expect(range.end).toBeGreaterThan(120);
    expect(range.end - range.start).toBeLessThanOrEqual(20);
  });

  it("windows overflowing rows and columns even when they are below the safety cap", () => {
    expect(calculateFixedTabularWindow({
      count: 70,
      itemSize: 31,
      maximumItems: 80,
      overscanItems: 4,
      scrollOffset: 0,
      viewportSize: 310,
    })).toEqual({ start: 0, end: 14 });

    expect(calculateVariableTabularWindow({
      offsets: createTabularOffsets(Array.from({ length: 20 }, () => 96)),
      maximumItems: 60,
      overscanSize: 280,
      scrollOffset: 0,
      viewportSize: 700,
    })).toEqual({ start: 0, end: 11 });
  });

  it("allocates a directional row buffer without crossing the mounted-row cap", () => {
    const range = calculateFixedTabularWindow({
      count: 10_000,
      itemSize: 31,
      maximumItems: 80,
      overscanAfterItems: 20,
      overscanBeforeItems: 4,
      overscanItems: 4,
      scrollOffset: 300 * 31,
      viewportSize: 310,
    });

    expect(range).toEqual({ start: 296, end: 330 });
    expect(range.end - range.start).toBeLessThanOrEqual(80);
  });

  it("predicts two paint intervals in the scroll direction and clamps extreme velocity", () => {
    const forward = calculateVelocityAwareTabularOverscan({
      baseItems: 4,
      deltaOffset: 155,
      elapsedMs: 16,
      itemSize: 31,
      maximumLeadItems: 32,
      minimumLeadItems: 10,
      predictionHorizonMs: 32,
    });
    const backward = calculateVelocityAwareTabularOverscan({
      baseItems: 4,
      deltaOffset: -310,
      elapsedMs: 16,
      itemSize: 31,
      maximumLeadItems: 32,
      minimumLeadItems: 10,
      predictionHorizonMs: 32,
    });
    const extreme = calculateVelocityAwareTabularOverscan({
      baseItems: 4,
      deltaOffset: 10_000,
      elapsedMs: 4,
      itemSize: 31,
      maximumLeadItems: 32,
      minimumLeadItems: 10,
      predictionHorizonMs: 32,
    });

    expect(forward).toEqual({ beforeItems: 4, afterItems: 20 });
    expect(backward).toEqual({ beforeItems: 30, afterItems: 4 });
    expect(extreme).toEqual({ beforeItems: 4, afterItems: 32 });
  });

  it("keeps the next fast-scroll viewport inside the predicted render envelope", () => {
    const itemSize = 31;
    const viewportSize = 26 * itemSize;
    const currentOffset = 100 * itemSize;
    const nextFrameDelta = 20 * itemSize;
    const overscan = calculateVelocityAwareTabularOverscan({
      baseItems: 4,
      deltaOffset: nextFrameDelta,
      elapsedMs: 16,
      itemSize,
      maximumLeadItems: 32,
      minimumLeadItems: 10,
      predictionHorizonMs: 32,
    });
    const rendered = calculateFixedTabularWindow({
      count: 10_000,
      itemSize,
      maximumItems: 80,
      overscanAfterItems: overscan.afterItems,
      overscanBeforeItems: overscan.beforeItems,
      overscanItems: 4,
      scrollOffset: currentOffset,
      viewportSize,
    });
    const nextVisibleStart = Math.floor((currentOffset + nextFrameDelta) / itemSize);
    const nextVisibleEnd = Math.ceil(
      (currentOffset + nextFrameDelta + viewportSize) / itemSize,
    );

    expect(rendered.start).toBeLessThanOrEqual(nextVisibleStart);
    expect(rendered.end).toBeGreaterThanOrEqual(nextVisibleEnd);
  });

  it("represents offscreen geometry as gaps and keeps a pinned interaction item", () => {
    const items = buildTabularProjectionItems(
      500,
      { start: 200, end: 220 },
      [4],
      (start, end) => (end - start) * 31,
    );

    expect(items[0]).toEqual({ kind: "gap", start: 0, end: 4, size: 124 });
    expect(items[1]).toEqual({ kind: "item", index: 4 });
    expect(items.some((item) => item.kind === "item" && item.index === 200)).toBe(true);
    expect(items.at(-1)).toEqual({ kind: "gap", start: 220, end: 500, size: 8_680 });
    expect(items.filter((item) => item.kind === "item")).toHaveLength(21);
  });
});
