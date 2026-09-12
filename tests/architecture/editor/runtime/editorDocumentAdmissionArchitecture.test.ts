import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = read("src/App.tsx");
const controllerSource = read("src/features/editor-workbench/controller/useDesktopEditorWorkbench.ts");
const runtimeSource = read("src/features/editor-workbench/runtime/EditorPaneDocumentRuntime.tsx");
const coreTypesSource = read("packages/shared-ui/src/core/types.ts");
const viewerTypesSource = read("packages/shared-ui/src/editor/registry/viewerTypes.ts");

describe("document admission architecture", () => {
  it("keeps Explorer selection separate from document opening commands", () => {
    expect(appSource).not.toContain("setActiveDataPath");
    expect(appSource).toContain("activeExplorerNode");
    expect(appSource).toContain("openDocument(node)");
  });

  it("does not expose path-only workbench open commands", () => {
    expect(controllerSource).toContain("openDocument: (node: DocumentDataNode)");
    expect(controllerSource).toContain("openDocumentAtPaneEdge:");
    expect(controllerSource).not.toMatch(/open:\s*\(path:\s*string/);
    expect(controllerSource).not.toMatch(/openAtPaneEdge:\s*\(\s*path:\s*string/);
  });

  it("proves restored resources before publishing them to the workbench", () => {
    expect(coreTypesSource).toContain("resolveNode?: (path: string)");
    expect(controllerSource).toContain("retainResolvedDocuments");
    expect(controllerSource).toContain("hydrated: false");
  });

  it("excludes folders from document and Viewer Host types", () => {
    expect(coreTypesSource).toContain('Exclude<DataNodeKind, "folder">');
    expect(viewerTypesSource).toContain("EditorDocumentKind = DocumentDataNodeKind");
    expect(runtimeSource).toContain("if (invalidTreeNode) {");
    expect(runtimeSource).toContain('role="alert"');
    expect(runtimeSource).toContain('t("editor.unavailable.title")');
    expect(runtimeSource).not.toContain("if (invalidTreeNode) return null");
  });
});

function read(relativePath: string): string {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}
