import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  getBlockDragLabel,
  getEdgeScrollVelocity,
  pickDropBoundary,
} from "../../../../../../packages/shared-ui/src/editor/markdown/addons/block-drag/blockDragGeometry";
import type { MarkdownMovableBlockRef } from "../../../../../../packages/shared-ui/src/editor/markdown/core/syntax/markdownBlockBoundaries";

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

describe("getBlockDragLabel", () => {
  const label = (source: string) => {
    const state = EditorState.create({ doc: source });
    const block = { from: 0, to: source.length } as MarkdownMovableBlockRef;
    return getBlockDragLabel(state, block);
  };

  it("names a block by its text, not its Markdown markers", () => {
    expect(label("## Heading")).toBe("Heading");
    expect(label("- item")).toBe("item");
    expect(label("12. item")).toBe("item");
    expect(label("- [x] done")).toBe("done");
    expect(label("> quoted")).toBe("quoted");
  });

  it("skips a code fence for its first line of code", () => {
    expect(label("```js\nconst a = 1;\n```")).toBe("const a = 1;");
  });

  it("keeps a marker-only block recognizable", () => {
    expect(label("---")).toBe("---");
  });

  it("bounds a long line", () => {
    expect(label("x".repeat(500))).toHaveLength(80);
  });
});
