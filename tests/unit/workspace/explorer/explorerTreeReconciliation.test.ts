import { describe, expect, it } from "vitest";
import type { DataNode } from "@puppyone/shared-ui";
import { reconcileDataNodeLists, reconcileFolderChildren } from "../../../../src/shared-ui/data/explorer/explorerTreeReconciliation";

const file = (path: string, extra: Partial<DataNode> = {}): DataNode => ({ id: path, path, name: path.split("/").at(-1)!, type: "markdown", ...extra });
const folder = (path: string, children: DataNode[] | null | undefined, extra: Partial<DataNode> = {}): DataNode =>
  ({ id: path, path, name: path.split("/").at(-1)!, type: "folder", children, ...extra });
/** A provider returns fresh objects on every listing. */
const relist = (nodes: DataNode[]) => nodes.map((node) => ({ ...node, children: node.type === "folder" ? undefined : node.children }));

describe("explorer tree reconciliation", () => {
  const tree = [
    file("readme.md", { size: "7" }),
    folder("docs", [file("docs/a.md"), folder("docs/deep", [file("docs/deep/b.md")])]),
    folder("other", [file("other/c.md")]),
  ];

  it("returns the previous array and nodes when a listing did not change", () => {
    const next = reconcileDataNodeLists(tree, relist(tree));
    expect(next).toBe(tree);
  });

  it("keeps unchanged siblings and loaded descendants while accepting a metadata change", () => {
    const listed = relist(tree);
    listed[0] = { ...listed[0]!, size: "12" };
    const next = reconcileDataNodeLists(tree, listed);
    expect(next).not.toBe(tree);
    expect(next[0]).toMatchObject({ path: "readme.md", size: "12" });
    expect(next[1]).toBe(tree[1]);
    expect(next[2]).toBe(tree[2]);
  });

  it("accepts additions and removals but keeps the identity of nodes that stayed", () => {
    const listed = [...relist(tree).filter((node) => node.path !== "other"), file("new.md")];
    const next = reconcileDataNodeLists(tree, listed);
    expect(next.map((node) => node.path)).toEqual(["readme.md", "docs", "new.md"]);
    expect(next[0]).toBe(tree[0]);
    expect(next[1]).toBe(tree[1]);
  });

  it("re-lists one folder without touching the rest of the tree when nothing changed", () => {
    const docs = tree[1]!;
    expect(reconcileFolderChildren(tree, "docs", relist(docs.children!))).toBe(tree);
    expect(reconcileFolderChildren(tree, "docs/deep", relist((docs.children![1] as DataNode).children!))).toBe(tree);
  });

  it("replaces only the path from the root to a folder whose listing changed", () => {
    const next = reconcileFolderChildren(tree, "docs/deep", [file("docs/deep/b.md"), file("docs/deep/c.md")]);
    expect(next).not.toBe(tree);
    expect(next[0]).toBe(tree[0]);
    expect(next[2]).toBe(tree[2]);
    const docs = next[1]!;
    expect(docs).not.toBe(tree[1]);
    expect(docs.children![0]).toBe(tree[1]!.children![0]);
    expect(docs.children![1]!.children!.map((node) => node.path)).toEqual(["docs/deep/b.md", "docs/deep/c.md"]);
  });

  it("marks a never-loaded folder as loaded even when its listing is empty", () => {
    const unloaded = [folder("empty", null)];
    const next = reconcileFolderChildren(unloaded, "empty", []);
    expect(next).not.toBe(unloaded);
    expect(next[0]!.children).toEqual([]);
  });

  it("treats a folder that became a file as a new node", () => {
    const next = reconcileDataNodeLists(tree, [file("readme.md", { size: "7" }), file("docs"), relist(tree)[2]!]);
    expect(next[1]).toMatchObject({ path: "docs", type: "markdown" });
    expect(next[1]!.children).toBeUndefined();
    expect(next[0]).toBe(tree[0]);
  });
});
