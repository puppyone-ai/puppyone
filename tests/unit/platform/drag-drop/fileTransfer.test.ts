import type { DataNode, DataPort } from "@puppyone/shared-ui";
import { describe, expect, it, vi } from "vitest";
import { createFileClipboardState } from "../../../../src/features/data-workspace/fileClipboard";
import {
  executeFileClipboardPaste,
  executeFileDuplicate,
} from "../../../../src/features/data-workspace/fileTransfer";

function node(path: string, type: DataNode["type"] = "text"): DataNode {
  return {
    id: path,
    name: path.split("/").at(-1) ?? path,
    path,
    type,
  };
}

describe("file clipboard batch execution", () => {
  it("uses DataPort-returned keep-both paths for copies", async () => {
    const copyNode = vi.fn(async () => ({ path: "docs/report copy.md" }));
    const clipboard = createFileClipboardState("workspace", "copy", [node("report.md", "markdown")])!;

    await expect(executeFileClipboardPaste({ copyNode }, clipboard, "docs")).resolves.toEqual({
      completedSourcePaths: ["report.md"],
      destinationPaths: ["docs/report copy.md"],
      destinationNodes: [node("docs/report copy.md", "markdown")],
      failures: [],
    });
    expect(copyNode).toHaveBeenCalledWith("report.md", "docs");
  });

  it("reports partial cut success and treats entries already in the target as complete", async () => {
    const moveNode = vi.fn(async (from: string) => {
      if (from === "archive/b.md") throw new Error("target exists");
    });
    const clipboard = createFileClipboardState("workspace", "cut", [
      node("docs/a.md", "markdown"),
      node("archive/b.md", "markdown"),
      node("other/c.md", "markdown"),
    ])!;

    await expect(executeFileClipboardPaste({ moveNode }, clipboard, "docs")).resolves.toEqual({
      completedSourcePaths: ["docs/a.md", "other/c.md"],
      destinationPaths: ["docs/a.md", "docs/c.md"],
      destinationNodes: [node("docs/a.md", "markdown"), node("docs/c.md", "markdown")],
      failures: [{ path: "archive/b.md", name: "b.md", message: "target exists" }],
    });
    expect(moveNode).toHaveBeenCalledTimes(2);
  });

  it("duplicates only top-level selected roots and requests a forced copy name", async () => {
    const copyNode: NonNullable<DataPort["copyNode"]> = vi.fn(async (fromPath) => ({
      path: `${fromPath} copy`,
    }));
    const folder = node("docs", "folder");
    const child = node("docs/readme.md", "markdown");

    const result = await executeFileDuplicate({ copyNode }, [child, folder]);

    expect(result).toEqual({
      sourceCount: 1,
      destinationPaths: ["docs copy"],
      destinationNodes: [{ ...node("docs copy", "folder"), children: null }],
      failures: [],
    });
    expect(copyNode).toHaveBeenCalledWith("docs", null, {
      forceDuplicateName: true,
    });
  });
});
