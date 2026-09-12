import { NodeType, Tree } from "@lezer/common";
import { describe, expect, it } from "vitest";
import { getChangedSyntaxProjectionRange } from "../../../../../../packages/shared-ui/src/editor/markdown/core/projection/syntaxProjectionRange";
const documentType = NodeType.define({ id: 0, name: "Document", top: true });
const blockType = NodeType.define({ id: 1, name: "Paragraph" });
const block = (length: number) => new Tree(blockType, [], [], length);
const document = (children: Tree[], positions: number[], length: number) => new Tree(documentType, children, positions, length);

describe("background syntax projection ranges", () => {
  it("preserves reused prefix blocks and includes the replaced partial tail", () => {
    const prefix = block(100);
    const previous = document([prefix, block(20)], [0, 101], 121);
    const next = document([prefix, block(80), block(30)], [0, 101, 182], 212);
    expect(getChangedSyntaxProjectionRange(previous, next)).toEqual({ from: 101, to: 212 });
  });
  it("covers disappearing syntax and changes inside equal-length trees", () => {
    const previous = document([block(40)], [0], 40);
    expect(getChangedSyntaxProjectionRange(previous, document([block(40)], [0], 40))).toEqual({ from: 0, to: 40 });
    expect(getChangedSyntaxProjectionRange(previous, document([], [], 0))).toEqual({ from: 0, to: 40 });
  });
  it("invalidates from the start when the root grammar changes", () => {
    const child = block(40);
    expect(getChangedSyntaxProjectionRange(document([child], [20], 60), new Tree(blockType, [child], [20], 60)))
      .toEqual({ from: 0, to: 60 });
  });
  it("does not rebuild a shared tree or identical immutable children", () => {
    const child = block(40);
    const previous = document([child], [0], 40);
    expect(getChangedSyntaxProjectionRange(previous, previous)).toBeNull();
    expect(getChangedSyntaxProjectionRange(previous, document([child], [0], 40))).toBeNull();
  });
});
