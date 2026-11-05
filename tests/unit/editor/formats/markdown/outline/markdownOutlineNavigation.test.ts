import { describe, expect, it } from "vitest";
import { resolveActiveOutlineIndex } from "../../../../../../src/shared-ui/editor/markdown/core/interaction/markdownHeadingOutline";

const headings = [
  { from: 0, level: 1, title: "A", plainTitle: "A" },
  { from: 100, level: 2, title: "B", plainTitle: "B" },
  { from: 200, level: 2, title: "C", plainTitle: "C" },
];
const blockTop = (from: number) => from; // 位置即纵坐标，便于断言

describe("resolveActiveOutlineIndex", () => {
  it("returns the last heading scrolled past the activation marker", () => {
    expect(resolveActiveOutlineIndex(headings, 0, blockTop)).toBe(0);
    expect(resolveActiveOutlineIndex(headings, 90, blockTop)).toBe(1);
    expect(resolveActiveOutlineIndex(headings, 500, blockTop)).toBe(2);
  });

  it("returns -1 for an empty outline", () => {
    expect(resolveActiveOutlineIndex([], 0, blockTop)).toBe(-1);
  });
});
