import { BlockType, Direction, type EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  getEdgeScrollVelocity,
  pickDropBoundary,
  readHandlePoint,
} from "../../../../../../src/shared-ui/editor/markdown/addons/block-drag/blockDragGeometry";

describe("pickDropBoundary", () => {
  const blocks = [{ top: 0, bottom: 100 }, { top: 120, bottom: 140 }, { top: 160, bottom: 400 }];
  const pick = (height: number) => pickDropBoundary(
    blocks.length,
    height,
    (index) => blocks[index].top,
    (index) => blocks[index].bottom,
  );

  it("splits each block at its midpoint", () => {
    expect(pick(49)).toBe(0);
    expect(pick(50)).toBe(1);
    expect(pick(129)).toBe(1);
    expect(pick(130)).toBe(2);
    expect(pick(279)).toBe(2);
    expect(pick(280)).toBe(3);
  });

  it("clamps outside the group", () => {
    expect(pick(-500)).toBe(0);
    expect(pick(9000)).toBe(3);
  });

  it("reads only logarithmically many blocks", () => {
    let reads = 0;
    const count = 100_000;
    const boundary = pickDropBoundary(count, 5_000_000, (index) => {
      reads += 1;
      return index * 100;
    }, (index) => index * 100 + 50);
    expect(boundary).toBe(50_000);
    expect(reads).toBeLessThanOrEqual(18);
  });
});

describe("getEdgeScrollVelocity", () => {
  it("rests outside the edge zones", () => {
    expect(getEdgeScrollVelocity(300, 0, 600)).toBe(0);
    expect(getEdgeScrollVelocity(48, 0, 600)).toBe(0);
    expect(getEdgeScrollVelocity(552, 0, 600)).toBe(0);
  });

  it("ramps with depth and caps past the edge", () => {
    expect(getEdgeScrollVelocity(24, 0, 600)).toBe(-420);
    expect(getEdgeScrollVelocity(576, 0, 600)).toBe(420);
    expect(getEdgeScrollVelocity(-200, 0, 600)).toBe(-840);
    expect(getEdgeScrollVelocity(900, 0, 600)).toBe(840);
  });
});

describe("readHandlePoint", () => {
  const surface = {
    documentOffset: 0,
    railLeft: 40,
    railRight: 900,
    originLeft: 0,
    originTop: 0,
    scaleX: 1,
    scaleY: 1,
  };
  const block = { from: 10, to: 12, kind: "paragraph", parentFrom: 0, parentTo: 20, parentName: "doc", depth: 1 } as const;

  function viewWith(type: BlockType, line: { top: number; height: number }, coords: { top: number; bottom: number; left: number }) {
    return {
      lineBlockAt: () => ({ ...line, type, from: 10, to: 12 }),
      coordsAtPos: () => ({ ...coords, right: coords.left }),
      defaultLineHeight: 20,
      textDirection: Direction.LTR,
    } as unknown as EditorView;
  }

  it("centers the handle on the first text row", () => {
    const point = readHandlePoint(
      viewWith(BlockType.Text, { top: 200, height: 20 }, { top: 204, bottom: 224, left: 300 }),
      surface,
      block,
    );
    expect(point.y).toBe(214);
  });

  it("aligns a widget block to the visible surface, skipping the line's block gap", () => {
    // The line box starts at 100 (padding), the widget itself at 132.
    const point = readHandlePoint(
      viewWith(BlockType.Widget, { top: 100, height: 420 }, { top: 132, bottom: 500, left: 300 }),
      surface,
      block,
    );
    expect(point.y).toBe(144);
  });

  it("falls back to the line box when no coordinates are available", () => {
    const view = {
      lineBlockAt: () => ({ top: 100, height: 400, type: BlockType.Widget, from: 10, to: 12 }),
      coordsAtPos: () => null,
      defaultLineHeight: 20,
      textDirection: Direction.LTR,
    } as unknown as EditorView;
    expect(readHandlePoint(view, surface, block).y).toBe(120);
  });
});
