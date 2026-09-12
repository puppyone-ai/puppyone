import { describe, expect, it } from "vitest";
import type { DataNode } from "@puppyone/shared-ui";
import { createEditorNodeIndex } from "../../../../src/features/editor-workbench/runtime/editorNodeIndex";

describe("createEditorNodeIndex", () => {
  it("indexes nested Explorer nodes by canonical path", () => {
    const nested: DataNode = {
      id: "folder/note.md",
      name: "note.md",
      path: "folder/note.md",
      type: "markdown",
    };
    const tree: DataNode[] = [{
      id: "folder",
      name: "folder",
      path: "folder",
      type: "folder",
      children: [nested],
    }];

    const index = createEditorNodeIndex(tree);

    expect(index.get("folder/note.md")).toBe(nested);
    expect(index.get("folder")).toBe(tree[0]);
    expect(index.get("missing.md")).toBeUndefined();
  });
});
