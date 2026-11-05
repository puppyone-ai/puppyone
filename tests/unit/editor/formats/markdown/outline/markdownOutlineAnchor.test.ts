import { describe, expect, it } from "vitest";
import { findOutlineHeadingIndexForAnchor } from "../../../../../../src/shared-ui/editor/markdown/core/interaction/markdownHeadingOutline";

const headings = [
  { from: 0, level: 1, title: "证据", plainTitle: "证据" },
  { from: 20, level: 2, title: "细 节", plainTitle: "细 节" },
  { from: 40, level: 2, title: "**重写**", plainTitle: "重写" },
];

describe("findOutlineHeadingIndexForAnchor", () => {
  it("matches a plain fragment", () => {
    expect(findOutlineHeadingIndexForAnchor(headings, "证据")).toBe(0);
  });

  it("decodes a percent-encoded fragment and collapses whitespace", () => {
    expect(findOutlineHeadingIndexForAnchor(headings, "%E7%BB%86%20%20%E8%8A%82")).toBe(1);
  });

  it("matches the reader-facing text of a styled heading", () => {
    expect(findOutlineHeadingIndexForAnchor(headings, "重写")).toBe(2);
  });

  it("returns -1 for an unknown or empty anchor", () => {
    expect(findOutlineHeadingIndexForAnchor(headings, "不存在")).toBe(-1);
    expect(findOutlineHeadingIndexForAnchor(headings, "  ")).toBe(-1);
  });
});
