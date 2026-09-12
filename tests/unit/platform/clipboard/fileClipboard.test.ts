import type { DataNode } from "@puppyone/shared-ui";
import { describe, expect, it } from "vitest";
import {
  collapseNestedNodes,
  createFileClipboardState,
  getDataParentPath,
  getDataPathName,
  isDataPathDescendant,
  isSameDataPath,
  isValidPasteTarget,
  joinDataPath,
  normalizeDataPath,
} from "../../../../src/features/data-workspace/fileClipboard";

function node(path: string, type: DataNode["type"] = "text"): DataNode {
  const name = path.split("/").at(-1) ?? path;
  return {
    id: path,
    name,
    path,
    type,
    children: type === "folder" ? [] : null,
  };
}

describe("file clipboard selection model", () => {
  it("keeps only selected roots when a parent and descendants are selected", () => {
    const parent = node("docs", "folder");
    const child = node("docs/readme.md", "markdown");
    const nestedFolder = node("docs/guides", "folder");
    const sibling = node("notes.txt");

    expect(collapseNestedNodes([child, nestedFolder, sibling, parent])).toEqual([
      sibling,
      parent,
    ]);
  });

  it("deduplicates exact paths while preserving case-distinct filesystem entries", () => {
    const first = node("Docs/README.md", "markdown");
    const duplicate = node("docs/readme.md", "markdown");
    const second = node("todo.md", "markdown");

    expect(collapseNestedNodes([first, duplicate, first, second])).toEqual([first, duplicate, second]);
  });

  it("stores detached top-level snapshots without hydrated children", () => {
    const folder = node("docs", "folder");
    folder.children = [node("docs/readme.md", "markdown")];

    const clipboard = createFileClipboardState(" workspace-a ", "copy", [folder]);

    expect(clipboard).toEqual({
      workspaceKey: "workspace-a",
      mode: "copy",
      nodes: [{ ...folder, children: null }],
    });
    expect(clipboard?.nodes[0]).not.toBe(folder);
  });

  it("does not create a clipboard for an empty workspace key or selection", () => {
    expect(createFileClipboardState("", "copy", [node("a.txt")])).toBeNull();
    expect(createFileClipboardState("workspace-a", "copy", [])).toBeNull();
  });
});

describe("paste target validation", () => {
  it("rejects copying or cutting a folder into itself or a descendant", () => {
    for (const mode of ["copy", "cut"] as const) {
      const clipboard = createFileClipboardState("workspace-a", mode, [node("docs", "folder")]);
      expect(isValidPasteTarget(clipboard, { workspaceKey: "workspace-a", path: "docs" })).toBe(false);
      expect(isValidPasteTarget(clipboard, { workspaceKey: "workspace-a", path: "docs/guides" })).toBe(false);
      expect(isValidPasteTarget(clipboard, { workspaceKey: "workspace-a", path: "archive" })).toBe(true);
    }
  });

  it("treats cutting back into the original parent as a no-op, including root", () => {
    const nested = createFileClipboardState("workspace-a", "cut", [node("docs/readme.md", "markdown")]);
    const root = createFileClipboardState("workspace-a", "cut", [node("readme.md", "markdown")]);

    expect(isValidPasteTarget(nested, { workspaceKey: "workspace-a", path: "docs" })).toBe(false);
    expect(isValidPasteTarget(root, { workspaceKey: "workspace-a", path: null })).toBe(false);
    expect(isValidPasteTarget(nested, { workspaceKey: "workspace-a", path: null })).toBe(true);
  });

  it("allows a multi-item cut when at least one selected item will move", () => {
    const clipboard = createFileClipboardState("workspace-a", "cut", [
      node("docs/a.md", "markdown"),
      node("archive/b.md", "markdown"),
    ]);

    expect(isValidPasteTarget(clipboard, { workspaceKey: "workspace-a", path: "docs" })).toBe(true);
  });

  it("rejects stale, empty, and cross-workspace clipboard targets", () => {
    const clipboard = createFileClipboardState("workspace-a", "copy", [node("readme.md", "markdown")]);
    expect(isValidPasteTarget(null, { workspaceKey: "workspace-a", path: null })).toBe(false);
    expect(isValidPasteTarget(clipboard, { workspaceKey: "workspace-b", path: null })).toBe(false);
  });
});

describe("clipboard path helpers", () => {
  it("normalizes separators and joins paths at the workspace root", () => {
    expect(normalizeDataPath("/docs\\guides//./intro.md/")).toBe("docs/guides/intro.md");
    expect(joinDataPath(null, "readme.md")).toBe("readme.md");
    expect(joinDataPath("docs/", "/readme.md")).toBe("docs/readme.md");
  });

  it("returns parents and names for root and nested entries", () => {
    expect(getDataParentPath("readme.md")).toBeNull();
    expect(getDataParentPath("docs/guides/readme.md")).toBe("docs/guides");
    expect(getDataParentPath(null)).toBeNull();
    expect(getDataPathName("docs/guides/readme.md")).toBe("readme.md");
    expect(getDataPathName(null)).toBe("");
  });

  it("preserves path case and handles root ancestry", () => {
    expect(isSameDataPath("Docs/Readme.md", "docs/readme.md")).toBe(false);
    expect(isDataPathDescendant("docs/guides", "DOCS")).toBe(false);
    expect(isDataPathDescendant("docs/guides", "docs")).toBe(true);
    expect(isDataPathDescendant("docs", "docs")).toBe(false);
    expect(isDataPathDescendant("docs", null)).toBe(true);
    expect(isDataPathDescendant(null, null)).toBe(false);
  });
});
