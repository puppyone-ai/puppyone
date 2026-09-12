/** @vitest-environment happy-dom */
import { undo, redo } from "@codemirror/commands";
import { EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT, getEditorPanes, type DataPort, type DocumentDataNode, type EditorSplitDirection, type FileContent } from "@puppyone/shared-ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { closeAllDocumentWorkingCopies } from "../../../../packages/shared-ui/src/editor/document-session/documentWorkingCopies";
import { useDesktopEditorWorkbench } from "../../../../src/features/editor-workbench/controller/useDesktopEditorWorkbench";
import { DesktopEditorSplitView } from "../../../../src/features/editor-workbench/layout/DesktopEditorSplitView";
import { unavailableDocumentNavigation } from "../../../support/editor/documentFixtures";
import { requireEditorView } from "../../../support/editor/editorView";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const nodes: DocumentDataNode[] = ["left.txt", "right.txt"].map(path => ({ id: path, path, name: path, type: "text" }));
const workspace = { id: "pane-actions-integration", name: "Workspace", path: "/pane-actions", status: "recording" as const };

afterEach(async () => {
  act(() => root?.unmount()); root = null;
  await closeAllDocumentWorkingCopies("app-close");
  document.body.replaceChildren(); window.localStorage.clear();
});

async function until(condition: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  }
  throw new Error(`Pane state did not settle: ${document.body.textContent}`);
}

async function harness(direction: EditorSplitDirection, deferredPath?: string) {
  let editor!: ReturnType<typeof useDesktopEditorWorkbench>;
  let resolveRead: (value: FileContent) => void = () => { throw new Error("No read is pending"); };
  const deferred = new Promise<FileContent>((resolve) => { resolveRead = resolve; });
  const stored = new Map(nodes.map(node => [node.path, node.path]));
  const port: DataPort = {
    listChildren: async () => nodes,
    documentPersistence: { kind: "local-fs", storageIdentity: "pane-actions", persist: async (request) => { stored.set(request.path, request.content); return { ok: true, version: "v1" }; } },
    readFile: async (path) => path === deferredPath ? deferred : { path, name: path, type: "text", content: stored.get(path)!, version: "v1" },
  };
  function Harness() {
    editor = useDesktopEditorWorkbench(workspace, null);
    return <DesktopEditorSplitView aiEditRequest={null} dataPort={port} editorGroup={editor.state} layout={editor.paneLayout}
      editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }} editorTree={nodes}
      fileIconTheme="default" markdownEnvironment={EMPTY_MARKDOWN_WORKSPACE_ENVIRONMENT} documentNavigation={unavailableDocumentNavigation}
      workspace={workspace} onClosePane={editor.closePane} onFocusPane={editor.focusPane} onResizeSplit={editor.resizeSplit}
      onMovePane={editor.movePane} onOpenAtPaneEdge={editor.openDocumentAtPaneEdge} onSplitPane={editor.splitPane} />;
  }
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(withTestLocalization(<Harness />)));
  await act(async () => editor.openDocument(nodes[0]!));
  const firstId = editor.activePaneId;
  await act(async () => editor.openDocumentAtPaneEdge(nodes[1]!, firstId, direction, "second"));
  await until(() => container.querySelectorAll(".cm-editor").length === (deferredPath ? 1 : 2));
  const panes = getEditorPanes(editor.paneLayout).map(({ id }) => container.querySelector<HTMLElement>(`[data-editor-pane-id="${id}"]`)!);
  return { get editor() { return editor; }, container, panes, resolveRead };
}

async function openMenu(pane: HTMLElement) {
  await act(async () => pane.querySelector<HTMLButtonElement>(".desktop-editor-pane-handle")!.click());
  await until(() => document.querySelector('[aria-label="Close editor pane"]') !== null);
  return document.querySelector<HTMLButtonElement>('[aria-label="Close editor pane"]')!;
}

describe.each(["horizontal", "vertical"] as const)("%s pane menu to controller integration", (direction) => {
  it.each([
    { targetIndex: 0, initiallyActive: 0 }, { targetIndex: 0, initiallyActive: 1 },
    { targetIndex: 1, initiallyActive: 0 }, { targetIndex: 1, initiallyActive: 1 },
  ])("closes pane $targetIndex while pane $initiallyActive was active and retains the survivor's model/history", async ({ targetIndex, initiallyActive }) => {
    const h = await harness(direction);
    const target = h.panes[targetIndex]!;
    const survivor = h.panes[1 - targetIndex]!;
    const survivorId = survivor.dataset.editorPaneId!;
    const view = requireEditorView(survivor.querySelector<HTMLElement>(".cm-editor")!);
    const original = view.state.doc.toString();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: " edited" }, userEvent: "input.type" }));
    await act(async () => h.editor.focusPane(h.panes[initiallyActive]!.dataset.editorPaneId!));
    const close = await openMenu(target);
    await act(async () => close.click());

    expect(document.querySelector(".desktop-editor-pane-menu")).toBeNull();
    expect(target.isConnected).toBe(false);
    expect(h.container.querySelectorAll(".desktop-editor-pane")).toHaveLength(1);
    expect(h.editor.activePaneId).toBe(survivorId);
    expect(h.editor.activePath).toBe(nodes[1 - targetIndex]!.path);
    expect(survivor.dataset.active).toBe("true");
    expect(document.activeElement).toBe(survivor.querySelector(".desktop-editor-pane-handle"));
    expect(requireEditorView(survivor.querySelector<HTMLElement>(".cm-editor")!)).toBe(view);
    expect(view.state.doc.toString()).toBe(`${original} edited`);
    act(() => { expect(undo(view)).toBe(true); });
    expect(view.state.doc.toString()).toBe(original);
    act(() => { expect(redo(view)).toBe(true); });
    expect(view.state.doc.toString()).toBe(`${original} edited`);

    const closeLast = await openMenu(survivor);
    await act(async () => closeLast.click());
    expect(h.container.querySelector('[data-empty="true"]')).not.toBeNull();
    expect(h.container.querySelector(".cm-editor")).toBeNull();
    expect(document.querySelector(".desktop-editor-pane-menu")).toBeNull();
  });

  it("dismisses the menu with Escape, restores its trigger focus and leaves both panes intact", async () => {
    const h = await harness(direction);
    const trigger = h.panes[0]!.querySelector<HTMLButtonElement>(".desktop-editor-pane-handle")!;
    await openMenu(h.panes[0]!);
    const topology = h.editor.paneLayout.root;
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector(".desktop-editor-pane-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(h.editor.paneLayout.root).toBe(topology);
    expect(h.container.querySelectorAll(".cm-editor")).toHaveLength(2);
  });

  it("ignores a late read after its loading pane is closed through the menu", async () => {
    const h = await harness(direction, nodes[1]!.path);
    const view = requireEditorView(h.panes[0]!.querySelector<HTMLElement>(".cm-editor")!);
    const close = await openMenu(h.panes[1]!);
    await act(async () => close.click());
    await act(async () => h.resolveRead({ path: nodes[1]!.path, name: nodes[1]!.name, type: "text", content: "late closed content", version: "v1" }));
    expect(h.panes[1]!.isConnected).toBe(false);
    expect(h.container.querySelectorAll(".desktop-editor-pane")).toHaveLength(1);
    expect(h.container.textContent).not.toContain("late closed content");
    expect(requireEditorView(h.container.querySelector<HTMLElement>(".cm-editor")!)).toBe(view);
    expect(h.editor.activePath).toBe(nodes[0]!.path);
  });
});
