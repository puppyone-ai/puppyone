import { describe, expect, it } from "vitest";
import type { DragEvent } from "react";
import type { DataNode } from "@puppyone/shared-ui";
import { classifyReferenceDataTransfer, EXPLORER_REFERENCE_DRAG_TYPE, parseExplorerReferenceDrag, serializeExplorerReferenceDrag } from "@puppyone/shared-ui";
import { localResourceFileUrl, projectLocalResourcePath } from "../shared/workspace-resource-reference.mjs";
import { writeLocalResourceDragData } from "../src/features/data-workspace/resourceDragExport";
import type { ResolvedWorkbenchDataResource } from "../src/features/data-workspace/workbenchDataPort";

const node = (root: string): DataNode => ({ id: root, path: `puppyone-local://workspace/${root}/docs/%E4%B8%AD%E6%96%87%20file.md`, name: "中文 file.md", type: "file" });
const resolve = (resource: string) => ({ resourceUri: resource, folder: { workspace: { path: resource.includes("/a/") ? "/repo a" : "/repo b" } }, providerPath: "docs/中文 file.md" }) as ResolvedWorkbenchDataResource;

describe("resource drag representations", () => {
  it("keeps qualified internal identities separate from readable paths and prefers them on drop", () => {
    const nodes = [node("a"), node("b")];
    const data = new Map<string, string>();
    const dataTransfer = { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "", files: [] } as unknown as DataTransfer;
    dataTransfer.setData(EXPLORER_REFERENCE_DRAG_TYPE, serializeExplorerReferenceDrag("workbench", nodes));
    writeLocalResourceDragData(nodes, { dataTransfer } as DragEvent<HTMLElement>, resolve);
    expect(data.get("text/plain")).toBe("/repo a/docs/中文 file.md\n/repo b/docs/中文 file.md");
    expect(data.get("text/uri-list")).toBe("file:///repo%20a/docs/%E4%B8%AD%E6%96%87%20file.md\r\nfile:///repo%20b/docs/%E4%B8%AD%E6%96%87%20file.md");
    expect(data.has("DownloadURL")).toBe(false);
    const wire = JSON.parse(data.get(EXPLORER_REFERENCE_DRAG_TYPE)!);
    expect(wire.version).toBe(2);
    expect(wire.entries[0]).toHaveProperty("resourceUri", nodes[0]!.path);
    expect(wire.entries[0]).not.toHaveProperty("path");
    expect(classifyReferenceDataTransfer(dataTransfer)).toMatchObject({ kind: "workspace-entries", entries: nodes.map((entry) => ({ path: entry.path })) });
  });
  it("accepts legacy relative payloads without converting them to a guessed root", () => {
    expect(parseExplorerReferenceDrag(JSON.stringify({ version: 1, workspaceId: "legacy", entries: [{ path: "docs/a.md", name: "a.md", entryType: "file" }] })))
      .toMatchObject({ version: 1, entries: [{ path: "docs/a.md" }] });
    expect(parseExplorerReferenceDrag(JSON.stringify({ version: 2, workspaceId: "new", entries: [{ resourceUri: "docs/a.md", name: "a.md", entryType: "file" }] }))).toBeNull();
  });
  it("serializes local file URLs for POSIX, drive and network roots without corrupting spaces or hashes", () => {
    expect(localResourceFileUrl("/repo/a #.md")).toBe("file:///repo/a%20%23.md");
    expect(localResourceFileUrl("C:\\repo a\\note.md")).toBe("file:///C:/repo%20a/note.md");
    expect(localResourceFileUrl("\\\\server\\share\\note.md")).toBe("file://server/share/note.md");
    expect(projectLocalResourcePath("C:\\repo", "docs/a.md")).toBe("C:\\repo\\docs\\a.md");
    expect(projectLocalResourcePath("\\\\server\\share", "docs/a.md")).toBe("\\\\server\\share\\docs\\a.md");
    expect(() => projectLocalResourcePath("/repo", "../secret")).toThrow();
  });
});
