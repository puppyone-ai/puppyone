import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { canonicalizeResourceUri, createWorkspaceFolder, EMPTY_MARKDOWN_LINK_COMMANDS, ExplorerTree, getEditorPanes, type DataPort, type DocumentDataNode, type MarkdownWorkspaceEnvironment } from "@puppyone/shared-ui";
import "@puppyone/shared-ui/shared-ui.css";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseWorkspaceResourceReference } from "../../../../shared/workspace-resource-reference.mjs";
import "../../../../src/cloud-globals.css";
import { useResourceDragExport } from "../../../../src/features/data-workspace/useResourceDragExport";
import { useDesktopEditorWorkbench } from "../../../../src/features/editor-workbench/controller/useDesktopEditorWorkbench";
import { DesktopEditorSplitView } from "../../../../src/features/editor-workbench/layout/DesktopEditorSplitView";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import "../../../../src/styles.css";
import "../../../../src/styles/cascade.css";
import { unavailableDocumentNavigation } from "../../../support/editor/documentFixtures";
import { requireResourceSmokeBridge } from "./resourceSmoke";

const { workspacePath } = await window.resourceSmoke.config();
const workspace = { id: "smoke-workbench", path: workspacePath, name: "Native Editor smoke", status: "recording" as const };
const rootUri = canonicalizeResourceUri("puppyone-local://workspace/smoke-root");
const file: DocumentDataNode = { id: `${rootUri}/docs/%E4%B8%AD%E6%96%87%20file.md`, path: `${rootUri}/docs/%E4%B8%AD%E6%96%87%20file.md`, name: "中文 file.md", type: "markdown", source: "local" };
const existing: DocumentDataNode = { id: `${rootUri}/existing.md`, path: `${rootUri}/existing.md`, name: "existing.md", type: "markdown", source: "local" };
const nodes = [file, existing];
const resolveEditorResource = (resource: string) => ({ rootUri, resourcePath: parseWorkspaceResourceReference(resource).relativePath, hostPath: resource });
const port: DataPort = { listChildren: async () => nodes, readFile: (resource) => window.resourceSmoke.read(resource) };
const environment: MarkdownWorkspaceEnvironment = {
  linkGraph: { revision: 0, documentCount: 0, indexedDocumentCount: 0,
    resolveWikiLink: () => ({ exists: false, ambiguous: false, path: null, name: "", displayName: "", target: "" }),
    resolveMarkdownLink: () => null, getBacklinks: () => [] },
  linkCommands: EMPTY_MARKDOWN_LINK_COMMANDS, assetUrlResolver: () => null, assetResolverRevision: 0,
};
function Harness() {
  const editor = useDesktopEditorWorkbench(workspace, null, null, resolveEditorResource);
  const initialized = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!initialized.current) { initialized.current = true; editor.openDocument(existing); }
  }, [editor]);
  useEffect(() => {
    window.resourceSmoke.record({ panes: getEditorPanes(editor.paneLayout), editors: editor.state.editors.map((input) => input.id) });
  }, [editor.paneLayout, editor.state]);
  useEffect(() => {
    const record = (event: DragEvent) => window.resourceSmoke.record({ event: event.type, types: [...(event.dataTransfer?.types ?? [])], files: [...(event.dataTransfer?.files ?? [])].map((file) => requireResourceSmokeBridge().getPathForFile(file)) });
    window.addEventListener("drop", record, true);
    return () => window.removeEventListener("drop", record, true);
  }, []);
  const exportNodes = useResourceDragExport((resource) => ({ folder: createWorkspaceFolder({ ...workspace, id: "smoke-root" }), resourceUri: canonicalizeResourceUri(resource), providerPath: resource === file.path ? "docs/中文 file.md" : "existing.md" }),
    (failed) => window.resourceSmoke.record({ exportFailed: failed }));
  return <main style={{ display: "grid", gridTemplateColumns: "230px 1fr", width: "100vw", height: "100vh", background: "white", color: "#222" }}>
    <aside style={{ padding: 16 }}><h2>Explorer</h2><ExplorerTree nodes={nodes} activePath={selected} expandedPaths={new Set()} dragWorkspaceId={workspace.id}
      onSelectNode={(node) => setSelected(node?.path ?? null)} onExportNodes={exportNodes} />
      <p>Drag 中文 file.md into the editor. Repeat to verify no duplicate pane.</p></aside>
    <section style={{ position: "relative", minWidth: 0, minHeight: 0 }}>
      <DesktopEditorSplitView aiEditRequest={null} dataPort={port} editorGroup={editor.state} layout={editor.paneLayout}
        editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }} fileIconTheme="default" editorTree={nodes}
        markdownEnvironment={environment} documentNavigation={unavailableDocumentNavigation} workspace={workspace}
        onClosePane={editor.closePane} onFocusPane={editor.focusPane} onResizeSplit={editor.resizeSplit} onMovePane={editor.movePane}
        onOpenAtPaneEdge={editor.openDocumentAtPaneEdge} onSplitPane={editor.splitPane} />
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<TestLocalizationProvider messages={englishCatalog}><Harness /></TestLocalizationProvider>);
