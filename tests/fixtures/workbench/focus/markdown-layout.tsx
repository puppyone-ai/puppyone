import { MarkdownLayoutProbe } from "./markdownLayoutProbe";
import { mdiLayoutProbe } from "./markdownMdiLayoutProbe";
import { EditorView } from "@codemirror/view";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import {
  EMPTY_EDITOR_GROUP,
  EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT,
  activateEditorPane,
  assignEditorToActivePane,
  createEditorInput,
  createEditorPaneLayout,
  getEditorPanes,
  openEditor,
  splitEditorPane,
  updateEditorSplitRatio,
  type DataNode,
  type DataPort,
} from "@puppyone/shared-ui";
import "@puppyone/shared-ui/shared-ui.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../../src/cloud-globals.css";
import { DesktopEditorSplitView } from "../../../../src/features/editor-workbench/layout/DesktopEditorSplitView";
import englishCatalog from "../../../../src/localization/catalog-loaders/en";
import "../../../../src/styles.css";
import "../../../../src/styles/cascade.css";
import { unavailableDocumentNavigation } from "../../../support/editor/documentFixtures";
import { requireEditorView } from "../../../support/editor/editorView";

declare global {
  interface Window {
    markdownLayoutFixture?: {
      probe: MarkdownLayoutProbe;
      mdi: typeof mdiLayoutProbe;
      panes: HTMLElement[];
      ready: boolean;
      readCount: number;
      views: EditorView[];
      releaseImage(): void;
      setPaneCount(count: number): Promise<void>;
      unmount(): void;
    };
  }
}

const paths = Array.from({ length: 8 }, (_, index) => `pane-${index + 1}-layout.md`);
let releaseImage = () => {};
const imageReady = new Promise<void>(resolve => { releaseImage = resolve; });
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
  "![Delayed layout image](layout.png)",
  "",
  ...Array.from({ length: 260 }, (_, index) => (
    `Entry ${index + 1}: ${"中文 viewport stable markdown geometry ".repeat(2 + (index * 17 % 9))}`
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
  probe: new MarkdownLayoutProbe((): EditorView[] => fixture.views),
  mdi: mdiLayoutProbe,
  panes: [] as HTMLElement[],
  ready: false,
  readCount: 0,
  views: [] as EditorView[],
  releaseImage,
  setPaneCount: async (_count: number) => {},
  unmount: () => {},
};
window.markdownLayoutFixture = fixture;

const editorGroup = paths.reduce((group, path) => openEditor(group, createEditorInput(path)), EMPTY_EDITOR_GROUP);
function layoutFor(count: number) {
  let layout = createEditorPaneLayout(paths[0]);
  let next = 1;
  for (let level = 0; getEditorPanes(layout).length < count; level++) {
    for (const pane of getEditorPanes(layout)) {
      layout = splitEditorPane(layout, pane.id, level % 2 ? "vertical" : "horizontal");
      layout = assignEditorToActivePane(layout, paths[next++]);
    }
  }
  return layout;
}
const initialLayout = layoutFor(2);

const dataPort: DataPort = {
  async getFileUrl() {
    await imageReady;
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 260;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#589bab";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  },
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
      version: `layout:${path}`,
    };
  },
  documentPersistence: {
    kind: "local-fs",
    storageIdentity: "test:markdown-layout",
    async persist(request) {
      return { ok: true, version: request.baseVersion ?? `layout:${request.path}` };
    },
  },
};
const markdownEnvironment = {
  ...EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT,
  assetUrlResolver: async () => dataPort.getFileUrl!("layout.png"),
  assetResolverRevision: 1,
};
function HorizontalMarkdownSplitFixture() {
  const [layout, setLayout] = useState(initialLayout);
  fixture.setPaneCount = async count => {
    if (![2, 4, 8].includes(count)) throw new Error("Expected 2, 4 or 8 panes");
    setLayout(layoutFor(count));
    for (let attempt = 0; attempt < 300; attempt++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const elements = [...document.querySelectorAll<HTMLElement>(".cm-editor")];
      if (elements.length !== count) continue;
      fixture.views = elements.map(element => requireEditorView(element));
      fixture.panes = [...document.querySelectorAll<HTMLElement>(".desktop-editor-pane")];
      await new Promise(resolve => setTimeout(resolve, 250));
      return;
    }
    throw new Error(`Did not mount ${count} panes`);
  };
  return (
    <TestLocalizationProvider messages={englishCatalog}>
      <DesktopEditorSplitView documentNavigation={unavailableDocumentNavigation}
        aiEditRequest={null}
        dataPort={dataPort}
        editorGroup={editorGroup}
        editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
        editorTree={tree}
        fileIconTheme="default"
        layout={layout}
        markdownEnvironment={markdownEnvironment}
        workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
        onClosePane={() => undefined}
        onFocusPane={(paneId) => setLayout((current) => activateEditorPane(current, paneId))}
        onMovePane={() => undefined}
        onOpenAtPaneEdge={() => undefined}
        onResizeSplit={(splitId, ratio) => setLayout(current => updateEditorSplitRatio(current, splitId, ratio))}
        onSplitPane={() => undefined}
      />
    </TestLocalizationProvider>
  );
}

const rootElement = document.querySelector<HTMLElement>("#root");
if (!rootElement) throw new Error("Markdown layout fixture root is missing");
const root = createRoot(rootElement);
fixture.unmount = () => root.unmount();
root.render(<HorizontalMarkdownSplitFixture />);
requestAnimationFrame(() => publishFixtureWhenReady(0));

function publishFixtureWhenReady(attempt: number) {
  const panes = Array.from(document.querySelectorAll<HTMLElement>(".desktop-editor-pane"));
  const editorElements = Array.from(document.querySelectorAll<HTMLElement>(".cm-editor"));
  if (panes.length === 2 && editorElements.length === 2) {
    fixture.panes = panes;
    fixture.views = editorElements.map((element) => requireEditorView(element));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fixture.ready = true;
    }));
    return;
  }
  if (attempt >= 300) throw new Error("Markdown layout fixture did not mount two editors");
  requestAnimationFrame(() => publishFixtureWhenReady(attempt + 1));
}
