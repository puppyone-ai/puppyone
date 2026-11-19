import { initializeDesktopPreferences } from "../../../src/preferencesStore";
import { unavailableDocumentNavigation } from "../editor/documentFixtures";
import { EditorView } from "@codemirror/view";
import { EMPTY_EDITOR_GROUP, EMPTY_MARKDOWN_LINK_COMMANDS, assignEditorToActivePane, createEditorInput, createEditorPaneLayout, openEditor, splitEditorPane, type DataNode, type DataPort, type DataWorkspaceState, type EditorGroupState, type EditorPaneLayoutState, type MarkdownLinkCommands, type MarkdownWorkspaceEnvironment } from "@puppyone/shared-ui";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import { DesktopEditorSplitView } from "../../../src/features/editor-workbench/layout/DesktopEditorSplitView";
import { type EditorPaneDocumentRuntimeProps } from "../../../src/features/editor-workbench/runtime/EditorPaneDocumentRuntime";
import { withTestLocalization } from "../react/localization";

/** A mounted editor split with its workspace, runtimes and pointer and drag stubs, for the split-pane tests. */
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  delete window.puppyoneDesktop;
  vi.restoreAllMocks();
});

/** Registers the shared setup in the calling test file. */
export function setUpEditorSplitPanes() {
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    delete window.puppyoneDesktop;
    vi.restoreAllMocks();
  });
  beforeEach(() => { localStorage.clear(); initializeDesktopPreferences(); });
}

export function renderSplitView(
  editorGroup: EditorGroupState,
  layout: EditorPaneLayoutState,
  callbacks: {
    entering?: boolean;
    onMovePane?: React.ComponentProps<typeof DesktopEditorSplitView>["onMovePane"];
  onOpenAtPaneEdge?: React.ComponentProps<typeof DesktopEditorSplitView>["onOpenAtPaneEdge"];
  onSplitPane?: React.ComponentProps<typeof DesktopEditorSplitView>["onSplitPane"];
    onFocusPane?: React.ComponentProps<typeof DesktopEditorSplitView>["onFocusPane"];
  } = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(
    <DesktopEditorSplitView documentNavigation={unavailableDocumentNavigation}
      aiEditRequest={null}
      entering={callbacks.entering}
      dataPort={{ listChildren: async () => [] }}
      editorGroup={editorGroup}
      editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
      editorTree={[]}
      layout={layout}
      markdownEnvironment={emptyWorkspaceState().markdownEnvironment}
      workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
      onClosePane={vi.fn()}
      onFocusPane={callbacks.onFocusPane ?? vi.fn()}
      onMovePane={callbacks.onMovePane ?? vi.fn()}
      onOpenAtPaneEdge={callbacks.onOpenAtPaneEdge ?? vi.fn()}
      onResizeSplit={vi.fn()}
      onSplitPane={callbacks.onSplitPane ?? vi.fn()}
    />,
  )));
  return container;
}

export function createThreePaneWorkspace(extension = "md") {
  const paths = ["a", "b", "c"].map((name) => `${name}.${extension}`);
  let group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(paths[0]!));
  group = openEditor(group, createEditorInput(paths[1]!));
  group = openEditor(group, createEditorInput(paths[2]!));
  let layout = splitEditorPane(createEditorPaneLayout(paths[0]!), "editor-pane-1", "horizontal");
  layout = assignEditorToActivePane(layout, paths[1]!);
  layout = splitEditorPane(layout, layout.activePaneId, "vertical");
  layout = assignEditorToActivePane(layout, paths[2]!);
  return { group, layout };
}

export function installPointerCaptureStub(handle: HTMLElement) {
  const capturedPointers = new Set<number>();
  handle.setPointerCapture = (pointerId) => capturedPointers.add(pointerId);
  handle.hasPointerCapture = (pointerId) => capturedPointers.has(pointerId);
  handle.releasePointerCapture = (pointerId) => capturedPointers.delete(pointerId);
}

export function clickPaneHandle(handle: HTMLElement, pointerId: number) {
  act(() => handle.dispatchEvent(new PointerEvent("pointerdown", {
    bubbles: true, button: 0, clientX: 100, clientY: 5, pointerId,
  })));
  act(() => handle.dispatchEvent(new PointerEvent("pointerup", {
    bubbles: true, button: 0, clientX: 100, clientY: 5, pointerId,
  })));
  act(() => handle.dispatchEvent(new MouseEvent("click", {
    bubbles: true, button: 0, detail: 0,
  })));
}

export function dragEvent(type: string, dataTransfer: DataTransfer, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
}

export function readCount(readFile: ReturnType<typeof vi.fn>, path: string) {
  return readFile.mock.calls.filter(([readPath]) => readPath === path).length;
}

export async function waitForCondition(condition: () => boolean, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 5)));
  }
  throw new Error("Timed out waiting for split editor state.");
}

export async function focusEditorView(view: EditorView) {
  await act(async () => {
    view.focus();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  });
}

export function emptyWorkspaceState(): DataWorkspaceState {
  return {
    documentNavigation: unavailableDocumentNavigation,
    tree: [],
    activePath: null,
    activeNode: null,
    selectedPaths: [],
    selectedNodes: [],
    currentFolderPath: null,
    selectedFile: null,
    loadingPath: null,
    loadError: null,
    rootLoading: false,
    fileContent: null,
    fileLoading: false,
    fileError: null,
    fileUrl: null,
    fileUrlLoading: false,
    fileUrlError: null,
    markdownEnvironment: {
      linkGraph: {
        revision: 0,
        documentCount: 0,
        indexedDocumentCount: 0,
        resolveWikiLink: () => ({ exists: false, ambiguous: false, path: null, name: "", displayName: "", target: "" }),
        resolveMarkdownLink: () => null,
        getBacklinks: () => [],
      },
      linkCommands: EMPTY_MARKDOWN_LINK_COMMANDS,
      assetUrlResolver: () => null,
      assetResolverRevision: 0,
    },
  };
}

export const runtimeDataPort: DataPort = { listChildren: async () => [] };
export const runtimeLinkCommands: MarkdownLinkCommands = { openPath: () => undefined };

export function runtimeProps(
  node: DataNode,
  markdownEnvironment: MarkdownWorkspaceEnvironment,
): EditorPaneDocumentRuntimeProps {
  return {
    documentNavigation: unavailableDocumentNavigation,
    aiEditFile: null,
    dataPort: runtimeDataPort,
    editor: createEditorInput(node.path, node.name),
    editorInteractionPreferences: {
      showSaveStatus: false,
      markdownBlockDragEnabled: false,
    },
    markdownEnvironment,
    treeNode: node,
    workspaceId: "workspace",
    workspaceRoot: "/workspace",
    markdownDialect: "puppy-gfm",
  };
}

export function runtimeEnvironment(revision: number): MarkdownWorkspaceEnvironment {
  return {
    linkGraph: {
      revision,
      documentCount: 1,
      indexedDocumentCount: 1,
      resolveWikiLink: (_sourcePath, target) => ({
        exists: false,
        ambiguous: false,
        path: null,
        name: target,
        displayName: target,
        target,
      }),
      resolveMarkdownLink: () => null,
    },
    linkCommands: runtimeLinkCommands,
    assetUrlResolver: null,
    assetResolverRevision: 1,
  };
}

/** Mounts a tree the shared teardown unmounts. */
export function mountRoot(container: HTMLElement): Root {
  root = createRoot(container);
  return root;
}
