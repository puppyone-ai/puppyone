import { describe, expect, it } from "vitest";
import {
  collectWorkbenchSplitLeaves,
  createWorkbenchSplit,
  extractWorkbenchSplitLeaf,
  moveWorkbenchSplitLeafToEdge,
  updateWorkbenchSplitRatio,
  type WorkbenchSplitLeaf,
  type WorkbenchSplitNode,
} from "@puppyone/shared-ui";

type Leaf = WorkbenchSplitLeaf<"test">;
type Node = WorkbenchSplitNode<Leaf>;

describe("Workbench split tree model", () => {
  it("extracts a nested leaf and collapses its redundant parent", () => {
    const root = split("outer", leaf("a"), split("inner", leaf("b"), leaf("c"), "vertical"));
    const result = extractWorkbenchSplitLeaf(root, "b");

    expect(result.leaf).toBe(find(root, "b"));
    expect(result.root).toMatchObject({
      id: "outer",
      first: { id: "a" },
      second: { id: "c" },
    });
    expect(collectWorkbenchSplitLeaves(result.root! as Node).map(({ id }) => id))
      .toEqual(["a", "c"]);
  });

  it("moves a leaf without duplication and preserves unaffected split identity", () => {
    const inner = split("inner", leaf("b"), leaf("c"), "vertical", 0.62);
    const root = split("outer", leaf("a"), inner);
    const result = moveWorkbenchSplitLeafToEdge(
      root,
      "c",
      "a",
      "vertical",
      "first",
      "new-split",
    );

    expect(result.moved).toBe(true);
    expect(collectWorkbenchSplitLeaves(result.root).map(({ id }) => id))
      .toEqual(["c", "a", "b"]);
    expect(result.root).toMatchObject({
      id: "outer",
      second: { id: "b" },
    });
  });

  it("returns the same root for a no-op sibling placement", () => {
    const root = split("root", leaf("a"), leaf("b"));
    const result = moveWorkbenchSplitLeafToEdge(
      root,
      "b",
      "a",
      "horizontal",
      "second",
      "unused",
    );
    expect(result).toMatchObject({ moved: false });
    expect(result.root).toBe(root);
  });

  it("changes only the requested ratio", () => {
    const inner = split("inner", leaf("b"), leaf("c"), "vertical", 0.62);
    const root = split("outer", leaf("a"), inner);
    const updated = updateWorkbenchSplitRatio(root, "inner", 0.4);

    expect(updated).not.toBe(root);
    expect(updated).toMatchObject({
      id: "outer",
      second: { id: "inner", ratio: 0.4 },
    });
    expect(updateWorkbenchSplitRatio(updated, "missing", 0.2)).toBe(updated);
  });
});

function leaf(id: string): Leaf {
  return Object.freeze({ kind: "test", id });
}

function split(
  id: string,
  first: Node,
  second: Node,
  direction: "horizontal" | "vertical" = "horizontal",
  ratio = 0.5,
): Node {
  return createWorkbenchSplit({ id, direction, ratio, first, second });
}

function find(node: Node, id: string): Leaf | null {
  return collectWorkbenchSplitLeaves(node).find((item) => item.id === id) ?? null;
}
