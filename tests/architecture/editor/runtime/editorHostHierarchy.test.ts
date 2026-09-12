import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("editor host hierarchy", () => {
  it("keeps the host chain explicit and attaches routing at the document boundary", () => {
    const preview = source("../../../../packages/shared-ui/src/editor/host/FilePreview.tsx");
    const nodeHost = source("../../../../packages/shared-ui/src/editor/host/DataNodeEditorHost.tsx");
    const documentHost = source("../../../../packages/shared-ui/src/editor/host/EditorDocumentHost.tsx");

    expect(preview).toContain("<DataNodeEditorHost");
    expect(nodeHost).toContain("<EditorDocumentHost");
    expect(documentHost).toContain("resolveEditorViewer(document)");
    expect(documentHost).toContain("<DocumentSessionBoundary");
  });

  it("routes format implementations from isolated viewer packages", () => {
    const registry = source("../../../../packages/shared-ui/src/editor/registry/viewerRegistry.tsx");
    const builtins = source("../../../../packages/shared-ui/src/editor/registry/builtinViewerContributions.ts");

    for (const viewerPackage of ["app", "code", "csv", "fallback", "html", "media", "office", "pdf", "puppyflow"]) {
      expect(builtins).toContain(`../viewers/${viewerPackage}/`);
    }
    expect(registry).toContain("./builtinViewerContributions");
    expect(registry).not.toContain("../viewers/");
    expect(registry).not.toContain("../host/");
    expect(builtins).not.toContain("../host/");
  });

  it("does not restore the former flat ownership paths", () => {
    for (const formerPath of [
      "../packages/shared-ui/src/data/FilePreview.tsx",
      "../packages/shared-ui/src/editor/EditorHost.tsx",
      "../packages/shared-ui/src/editor/PuppyoneEditorHost.tsx",
      "../packages/shared-ui/src/editor/viewerRegistry.tsx",
      "../src/features/editor-workbench/useDesktopEditorGroup.ts",
      "../src/features/editor-workbench/useEditorWorkbenchDragAndDrop.ts",
    ]) {
      expect(existsSync(new URL(formerPath, import.meta.url))).toBe(false);
    }
  });
});
