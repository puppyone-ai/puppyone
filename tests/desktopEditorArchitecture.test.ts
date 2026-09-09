import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const desktopDataSurface = read("../src/features/app-shell/DesktopDataWorkspaceSurface.tsx");
const editorPaneDocumentRuntime = read(
  "../src/features/editor-workbench/runtime/EditorPaneDocumentRuntime.tsx",
);
const textEditorFrame = read(
  "../packages/shared-ui/src/editor/viewers/shared/TextEditorFrame.tsx",
);
const markdownViewer = read(
  "../packages/shared-ui/src/editor/markdown/MarkdownViewer.tsx",
);

describe("Desktop editor architecture", () => {
  it("exposes Markdown Source Code through the pane menu in the Desktop workspace", () => {
    expect(desktopDataSurface).toContain("hidePreviewSourceView");
    expect(editorPaneDocumentRuntime).toContain("getEditorProviderPolicy");
    expect(editorPaneDocumentRuntime).toContain(".sourceToggle");
    expect(editorPaneDocumentRuntime).toContain("hideSourceView={hideSourceView}");
    expect(markdownViewer).toContain('modeControlPlacement="pane-menu"');
    expect(textEditorFrame).toContain("publishPaneMenuContribution");
    expect(textEditorFrame).toContain('kind: "segmented"');
    expect(textEditorFrame).toContain('id: "editor-view-mode"');
    expect(textEditorFrame).toContain('switchMode("live")');
    expect(textEditorFrame).toContain('switchMode("source")');
    expect(textEditorFrame).toContain('t("editor.mode.source")');
  });
});

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
