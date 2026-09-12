import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import {
  EMPTY_EDITOR_GROUP,
  EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT,
  activateEditorPane,
  assignEditorToActivePane,
  createEditorInput,
  createEditorPaneLayout,
  openEditor,
  splitEditorPane,
  type DataNode,
  type DataPort,
} from "@puppyone/shared-ui";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import { DesktopEditorSplitView } from "../../../../src/features/editor-workbench/layout/DesktopEditorSplitView";
import "../../../../src/styles/cascade.css";
import "../../../../src/cloud-globals.css";
import "@puppyone/shared-ui/shared-ui.css";
import "../../../../src/styles.css";

declare global {
  interface Window {
    markdownPaneFocusFixture?: {
      panes: HTMLElement[];
      ready: boolean;
      readCount: number;
      views: EditorView[];
    };
  }
}

const paths = ["left-focus-continuity.md", "right-focus-continuity.md"] as const;
const source = [
  "| Pane | Projection | Geometry |",
  "| --- | --- | --- |",
  "| left | isolated | stable |",
  "| right | isolated | stable |",
  "| 中文 | 字形回退 | 稳定 |",
  "",
  "Paragraph immediately below the table keeps **focus continuity** without rebuilding sibling-pane line boxes.",
  "混合中文与 English 的正文保持正确字形，不继承仅适用于拉丁字体的特性标签。",
  "",
  ...Array.from({ length: 260 }, (_, index) => (
    `- [${index % 3 === 0 ? "x" : " "}] Task ${index + 1} provides enough wrapped content to exercise independent scroll anchoring in a side-by-side Markdown pane.`
  )),
].join("\n");
const tree: DataNode[] = paths.map((path) => ({
  id: path,
  name: path,
  path,
  type: "markdown",
  mimeType: "text/markdown",
  source: "local",
}));
const fixture = {
  panes: [] as HTMLElement[],
  ready: false,
  readCount: 0,
  views: [] as EditorView[],
};
window.markdownPaneFocusFixture = fixture;

let editorGroup = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(paths[0]));
editorGroup = openEditor(editorGroup, createEditorInput(paths[1]));
let initialLayout = splitEditorPane(
  createEditorPaneLayout(paths[0]),
  "editor-pane-1",
  "horizontal",
);
initialLayout = assignEditorToActivePane(initialLayout, paths[1]);

const dataPort: DataPort = {
  async listChildren() {
    return tree;
  },
  async readFile(path) {
    fixture.readCount += 1;
    return {
      path,
      name: path,
      type: "markdown",
      mimeType: "text/markdown",
      content: `${source}\n\n${path}`,
      version: `focus-continuity:${path}`,
    };
  },
  documentPersistence: {
    kind: "local-fs",
    storageIdentity: "test:markdown-pane-focus-continuity",
    async persist(request) {
      return { ok: true, version: request.baseVersion ?? `focus-continuity:${request.path}` };
    },
  },
};
function HorizontalMarkdownSplitFixture() {
  const [layout, setLayout] = useState(initialLayout);
  return (
    <TestLocalizationProvider messages={englishCatalog}>
      <DesktopEditorSplitView
        aiEditRequest={null}
        dataPort={dataPort}
        editorGroup={editorGroup}
        editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
        editorTree={tree}
        fileIconTheme="default"
        layout={layout}
        markdownEnvironment={EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT}
        workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
        onClosePane={() => undefined}
        onFocusPane={(paneId) => setLayout((current) => activateEditorPane(current, paneId))}
        onMovePane={() => undefined}
        onOpenAtPaneEdge={() => undefined}
        onResizeSplit={() => undefined}
        onSplitPane={() => undefined}
      />
    </TestLocalizationProvider>
  );
}

const rootElement = document.querySelector<HTMLElement>("#root");
if (!rootElement) throw new Error("Markdown focus fixture root is missing");
createRoot(rootElement).render(<HorizontalMarkdownSplitFixture />);
requestAnimationFrame(() => publishFixtureWhenReady(0));

function publishFixtureWhenReady(attempt: number) {
  const panes = Array.from(document.querySelectorAll<HTMLElement>(".desktop-editor-pane"));
  const editorElements = Array.from(document.querySelectorAll<HTMLElement>(".cm-editor"));
  if (panes.length === 2 && editorElements.length === 2) {
    fixture.panes = panes;
    fixture.views = editorElements.map((element) => EditorView.findFromDOM(element));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fixture.ready = true;
    }));
    return;
  }
  if (attempt >= 300) throw new Error("Markdown MDI focus fixture did not mount two editors");
  requestAnimationFrame(() => publishFixtureWhenReady(attempt + 1));
}
