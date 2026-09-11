/** @vitest-environment happy-dom */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_EDITOR_GROUP,
  EMPTY_MARKDOWN_LINK_COMMANDS,
  EXPLORER_REFERENCE_DRAG_TYPE,
  DataWorkspace,
  activateEditorPane,
  assignEditorToActivePane,
  assignEditorToPane,
  createEditorInput,
  createEditorPaneLayout,
  getEditorPanes,
  moveEditorPane,
  openEditor,
  serializeExplorerReferenceDrag,
  splitEditorPane,
  type DataNode,
  type DataPort,
  type DataWorkspaceState,
  type EditorGroupState,
  type EditorPaneLayoutState,
  type MarkdownLinkCommands,
  type MarkdownWorkspaceEnvironment,
} from "@puppyone/shared-ui";
import { DesktopEditorSplitView } from "../src/features/editor-workbench/layout/DesktopEditorSplitView";
import {
  EditorPaneDocumentRuntime,
  areEditorPaneDocumentRuntimePropsEqual,
  type EditorPaneDocumentRuntimeProps,
} from "../src/features/editor-workbench/runtime/EditorPaneDocumentRuntime";
import { DocumentSurfaceHost } from "../packages/shared-ui/src/editor/host/DocumentSurfaceHost";
import { withTestLocalization } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  delete window.puppyoneDesktop;
  vi.restoreAllMocks();
});

describe("DesktopEditorSplitView", () => {
  it("shows an explicit empty state when a split pane has no document", () => {
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput("a.md"));
    const layout = splitEditorPane(
      createEditorPaneLayout("a.md"),
      "editor-pane-1",
      "horizontal",
      { editorId: null },
    );
    const container = renderSplitView(group, layout);
    const emptyPane = container.querySelector<HTMLElement>('[data-empty="true"]');

    expect(emptyPane).not.toBeNull();
    expect(emptyPane?.dataset.contentState).toBe("empty");
    expect(emptyPane?.querySelector(".desktop-editor-pane-empty")?.textContent)
      .toBe("Select a file to preview");
    expect(emptyPane?.querySelector(".document-surface-host")).toBeNull();
  });

  it("uses the official loading animation without visible loading copy", async () => {
    const markdown: DataNode = {
      id: "loading.md",
      name: "loading.md",
      path: "loading.md",
      type: "markdown",
      mimeType: "text/markdown",
      source: "local",
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const dataPort: DataPort = {
      listChildren: async () => [],
      readFile: vi.fn(() => new Promise(() => undefined)),
    };

    await act(async () => root?.render(withTestLocalization(
      <EditorPaneDocumentRuntime
        {...runtimeProps(markdown, runtimeEnvironment(0))}
        dataPort={dataPort}
      />,
    )));

    expect(container.querySelector('[data-puppy-loader="pulse-grid"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Loading file");
    expect(container.querySelector(".document-surface-pending")?.getAttribute("aria-busy"))
      .toBe("true");
  });

  it("retains the document input through Strict Mode and Files/Settings navigation", async () => {
    const path = "return-from-settings.md";
    const node: DataNode = {
      id: path,
      name: path,
      path,
      type: "markdown",
      mimeType: "text/markdown",
      source: "local",
    };
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(path));
    const layout = createEditorPaneLayout(path);
    const readFile = vi.fn(async () => ({
      path,
      name: path,
      type: "markdown" as const,
      mimeType: "text/markdown",
      content: "# Restored document",
      version: `version:${readFile.mock.calls.length}`,
    }));
    const dataPort: DataPort = { listChildren: async () => [node], readFile };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const renderRoute = async (route: "files" | "settings") => act(async () => root?.render(
      withTestLocalization(
        <React.StrictMode>
          {route === "settings" ? <div>Settings</div> : (
            <DesktopEditorSplitView
              aiEditRequest={null}
              dataPort={dataPort}
              editorGroup={group}
              editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
              editorTree={[node]}
              fileIconTheme="default"
              layout={layout}
              markdownEnvironment={emptyWorkspaceState().markdownEnvironment}
              workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
              onClosePane={vi.fn()}
              onFocusPane={vi.fn()}
              onMovePane={vi.fn()}
              onOpenAtPaneEdge={vi.fn()}
              onResizeSplit={vi.fn()}
              onSplitPane={vi.fn()}
            />
          )}
        </React.StrictMode>,
      ),
    ));

    await renderRoute("files");
    await waitForCondition(() => (
      container.querySelector(".cm-editor") !== null
      && container.querySelector("[data-puppy-loader]") === null
    ));
    const readsAfterFirstMount = readFile.mock.calls.length;
    expect(readsAfterFirstMount).toBe(1);
    await renderRoute("settings");
    expect(container.textContent).toContain("Settings");
    await renderRoute("files");
    await waitForCondition(() => (
      readFile.mock.calls.length === readsAfterFirstMount + 1
      && container.querySelector(".cm-editor") !== null
      && container.querySelector("[data-puppy-loader]") === null
    ));
  });

  it("keeps the pane actions handle when only one pane exists", () => {
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput("a.md"));
    const container = renderSplitView(group, createEditorPaneLayout("a.md"));
    const pane = container.querySelector<HTMLElement>(".desktop-editor-pane")!;
    const handle = container.querySelector<HTMLButtonElement>(".desktop-editor-pane-handle")!;
    pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);

    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector(".desktop-editor-pane-bar")).toBeNull();
    expect(container.querySelectorAll(".desktop-editor-pane")).toHaveLength(1);
    expect(handle).not.toBeNull();

    act(() => pane.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, clientX: 400, clientY: 100,
    })));
    expect(pane.dataset.handleHot).toBe("true");

    clickPaneHandle(handle, 1);
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    const menu = document.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.closest("#desktop-overlay-root")).not.toBeNull();
    expect(pane.contains(menu)).toBe(false);
  });

  it("marks only nested layout leaves that touch the workbench bottom edge", () => {
    const { group, layout } = createThreePaneWorkspace();
    const container = renderSplitView(group, layout);
    const slots = new Map(Array.from(
      container.querySelectorAll<HTMLElement>(".desktop-editor-pane-slot"),
      (slot) => [
        slot.dataset.editorPaneSlotId,
        slot.dataset.touchesBlockEnd,
      ],
    ));

    // The left pane spans the full height. On the right, only the lower leaf
    // reaches the BrowserWindow paint edge.
    expect(slots).toEqual(new Map([
      ["editor-pane-1", "true"],
      ["editor-pane-2", undefined],
      ["editor-pane-3", "true"],
    ]));
    expect(container.querySelectorAll(".desktop-editor-pane-interaction-frame"))
      .toHaveLength(3);
  });

  it("opens one Explorer file at the nearest pane edge on drop", () => {
    const onOpenAtPaneEdge = vi.fn();
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput("a.md"));
    const container = renderSplitView(group, createEditorPaneLayout("a.md"), {
      onOpenAtPaneEdge,
    });
    const pane = container.querySelector<HTMLElement>(".desktop-editor-pane")!;
    pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    const node: DataNode = {
      id: "b.md",
      name: "b.md",
      path: "b.md",
      type: "file",
      source: "local",
    };
    const transfer = new DataTransfer();
    transfer.setData(
      EXPLORER_REFERENCE_DRAG_TYPE,
      serializeExplorerReferenceDrag("workspace", [node]),
    );

    act(() => pane.dispatchEvent(dragEvent("dragover", transfer, 790, 300)));
    expect(pane.dataset.dropTarget).toBe("right");
    expect(pane.dataset.dropKind).toBe("file");

    act(() => pane.dispatchEvent(dragEvent("drop", transfer, 790, 300)));
    expect(onOpenAtPaneEdge).toHaveBeenCalledWith(
      {
        id: "b.md",
        name: "b.md",
        path: "b.md",
        type: "markdown",
      },
      "editor-pane-1",
      "horizontal",
      "second",
    );
    expect(pane.dataset.dropTarget).toBeUndefined();
  });

  it("opens one native Explorer file at the nearest pane edge on macOS drop", async () => {
    const onOpenAtPaneEdge = vi.fn();
    const nativeEntry = {
      path: "puppyone-local://workspace/workspace/b.md",
      name: "b.md",
      entryType: "file" as const,
    };
    const onResolveResourceDrop = vi.fn(async () => [nativeEntry]);
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput("a.md"));
    const container = renderSplitView(group, createEditorPaneLayout("a.md"), {
      onOpenAtPaneEdge,
      onResolveResourceDrop,
      resourceDragEntries: [nativeEntry],
      resourceDragSessionId: "native-session",
    });
    const pane = container.querySelector<HTMLElement>(".desktop-editor-pane")!;
    pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    const file = new File(["# B"], "b.md", { type: "text/markdown" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    Object.defineProperty(transfer, "types", { value: ["Files"] });

    act(() => pane.dispatchEvent(dragEvent("dragover", transfer, 790, 300)));
    expect(pane.dataset.dropTarget).toBe("right");
    expect(pane.dataset.dropKind).toBe("file");

    act(() => root?.render(renderSplitViewContents(
      group,
      createEditorPaneLayout("a.md"),
      {
        onOpenAtPaneEdge,
        onResolveResourceDrop,
        resourceDragEntries: null,
        resourceDragSessionId: null,
      },
    )));

    await act(async () => {
      pane.dispatchEvent(dragEvent("drop", transfer, 790, 300));
      await Promise.resolve();
    });
    expect(onResolveResourceDrop).toHaveBeenCalledWith([file], "native-session");
    expect(onOpenAtPaneEdge).toHaveBeenCalledWith(
      {
        id: nativeEntry.path,
        name: "b.md",
        path: nativeEntry.path,
        type: "markdown",
      },
      "editor-pane-1",
      "horizontal",
      "second",
    );
    expect(pane.dataset.dropTarget).toBeUndefined();
  });

  it("claims an armed native split when macOS omits renderer file data on drop", async () => {
    const onOpenAtPaneEdge = vi.fn();
    const nativeEntry = {
      path: "puppyone-local://workspace/workspace/b.md",
      name: "b.md",
      entryType: "file" as const,
    };
    const onResolveResourceDrop = vi.fn(async () => [nativeEntry]);
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput("a.md"));
    const container = renderSplitView(group, createEditorPaneLayout("a.md"), {
      onOpenAtPaneEdge,
      onResolveResourceDrop,
      resourceDragEntries: [nativeEntry],
      resourceDragSessionId: "native-session",
    });
    const pane = container.querySelector<HTMLElement>(".desktop-editor-pane")!;
    pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    const previewTransfer = new DataTransfer();
    Object.defineProperty(previewTransfer, "types", { value: ["Files"] });

    act(() => pane.dispatchEvent(dragEvent("dragover", previewTransfer, 790, 300)));
    expect(pane.dataset.dropTarget).toBe("right");

    const drop = dragEvent("drop", new DataTransfer(), 790, 300);
    await act(async () => {
      pane.dispatchEvent(drop);
      await Promise.resolve();
    });

    expect(drop.defaultPrevented).toBe(true);
    expect(onResolveResourceDrop).toHaveBeenCalledWith([], "native-session");
    expect(onOpenAtPaneEdge).toHaveBeenCalledWith(
      {
        id: nativeEntry.path,
        name: "b.md",
        path: nativeEntry.path,
        type: "markdown",
      },
      "editor-pane-1",
      "horizontal",
      "second",
    );
  });

  it("handles a native split before global drop cleanup can clear its authorization", async () => {
    const onOpenAtPaneEdge = vi.fn();
    const nativeEntry = {
      path: "puppyone-local://workspace/workspace/b.md",
      name: "b.md",
      entryType: "file" as const,
    };
    const onResolveResourceDrop = vi.fn(async () => [nativeEntry]);
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput("a.md"));
    const container = renderSplitView(group, createEditorPaneLayout("a.md"), {
      onOpenAtPaneEdge,
      onResolveResourceDrop,
      resourceDragEntries: [nativeEntry],
      resourceDragSessionId: "native-session",
    });
    const pane = container.querySelector<HTMLElement>(".desktop-editor-pane")!;
    pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    const transfer = new DataTransfer();
    transfer.items.add(new File(["# B"], "b.md", { type: "text/markdown" }));
    Object.defineProperty(transfer, "types", { value: ["Files"] });

    act(() => pane.dispatchEvent(dragEvent("dragover", transfer, 790, 300)));
    vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => callback());

    const drop = dragEvent("drop", transfer, 790, 300);
    await act(async () => {
      pane.dispatchEvent(drop);
      await Promise.resolve();
    });

    expect(drop.defaultPrevented).toBe(true);
    expect(onResolveResourceDrop).toHaveBeenCalledWith(
      [expect.objectContaining({ name: "b.md" })],
      "native-session",
    );
    expect(onOpenAtPaneEdge).toHaveBeenCalledWith(
      expect.objectContaining({ name: "b.md", path: nativeEntry.path }),
      "editor-pane-1",
      "horizontal",
      "second",
    );
  });

  it("keeps an armed native Explorer split drop across early macOS termination events", async () => {
    const onOpenAtPaneEdge = vi.fn();
    const nativeEntry = {
      path: "puppyone-local://workspace/workspace/b.md",
      name: "b.md",
      entryType: "file" as const,
    };
    const onResolveResourceDrop = vi.fn(async () => [nativeEntry]);
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput("a.md"));
    const container = renderSplitView(group, createEditorPaneLayout("a.md"), {
      onOpenAtPaneEdge,
      onResolveResourceDrop,
      resourceDragEntries: [nativeEntry],
      resourceDragSessionId: "native-session",
    });
    const pane = container.querySelector<HTMLElement>(".desktop-editor-pane")!;
    pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    const file = new File(["# B"], "b.md", { type: "text/markdown" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    Object.defineProperty(transfer, "types", { value: ["Files"] });

    act(() => pane.dispatchEvent(dragEvent("dragover", transfer, 790, 300)));
    expect(pane.dataset.dropTarget).toBe("right");

    act(() => window.dispatchEvent(new Event("blur")));
    act(() => window.dispatchEvent(new DragEvent("dragend")));

    await act(async () => {
      pane.dispatchEvent(dragEvent("drop", transfer, 790, 300));
      await Promise.resolve();
    });
    expect(onResolveResourceDrop).toHaveBeenCalledWith([file], "native-session");
    expect(onOpenAtPaneEdge).toHaveBeenCalledWith(
      {
        id: nativeEntry.path,
        name: "b.md",
        path: nativeEntry.path,
        type: "markdown",
      },
      "editor-pane-1",
      "horizontal",
      "second",
    );
  });

  it("releases a cancelled native Explorer drop before the next external file drop", async () => {
    const onResolveResourceDrop = vi.fn(async () => null);
    const nativeEntry = {
      path: "puppyone-local://workspace/workspace/b.md",
      name: "b.md",
      entryType: "file" as const,
    };
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput("a.md"));
    const layout = createEditorPaneLayout("a.md");
    const container = renderSplitView(group, layout, {
      onResolveResourceDrop,
      resourceDragEntries: [nativeEntry],
      resourceDragSessionId: "native-session",
    });
    const pane = container.querySelector<HTMLElement>(".desktop-editor-pane")!;
    pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    const nativeTransfer = new DataTransfer();
    nativeTransfer.items.add(new File(["# B"], "b.md", { type: "text/markdown" }));
    Object.defineProperty(nativeTransfer, "types", { value: ["Files"] });

    act(() => pane.dispatchEvent(dragEvent("dragover", nativeTransfer, 790, 300)));
    act(() => root?.render(renderSplitViewContents(
      group,
      layout,
      { onResolveResourceDrop, resourceDragEntries: null, resourceDragSessionId: null },
    )));
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 120)));

    const externalTransfer = new DataTransfer();
    externalTransfer.items.add(new File(["external"], "external.txt", { type: "text/plain" }));
    Object.defineProperty(externalTransfer, "types", { value: ["Files"] });
    const externalDrop = dragEvent("drop", externalTransfer, 400, 300);
    act(() => pane.dispatchEvent(externalDrop));

    expect(externalDrop.defaultPrevented).toBe(false);
    expect(onResolveResourceDrop).not.toHaveBeenCalled();
  });

  it("clears an Explorer split preview when the window loses the drag session", () => {
    const group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput("a.md"));
    const container = renderSplitView(group, createEditorPaneLayout("a.md"));
    const pane = container.querySelector<HTMLElement>(".desktop-editor-pane")!;
    pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    const transfer = new DataTransfer();
    transfer.setData(
      EXPLORER_REFERENCE_DRAG_TYPE,
      serializeExplorerReferenceDrag("workspace", [{
        id: "b.md",
        name: "b.md",
        path: "b.md",
        type: "file",
        source: "local",
      }]),
    );

    act(() => pane.dispatchEvent(dragEvent("dragover", transfer, 790, 300)));
    expect(pane.dataset.dropTarget).toBe("right");

    act(() => window.dispatchEvent(new Event("blur")));
    expect(pane.dataset.dropTarget).toBeUndefined();
    expect(container.querySelector(".desktop-editor-drop-preview")).toBeNull();
  });

  it("reveals pane chrome only when the pointer is in the top third of a pane", () => {
    const capturePanePreview = vi.fn(async () => null);
    window.puppyoneDesktop = {
      capturePanePreview,
    } as NonNullable<typeof window.puppyoneDesktop>;
    const { group, layout } = createThreePaneWorkspace();
    const container = renderSplitView(group, layout);
    const pane = container.querySelector<HTMLElement>(".desktop-editor-pane")!;
    pane.getBoundingClientRect = () => new DOMRect(0, 0, 400, 600);

    expect(pane.dataset.handleHot).toBeUndefined();

    act(() => pane.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, clientX: 200, clientY: 100,
    })));
    expect(pane.dataset.handleHot).toBe("true");
    expect(capturePanePreview).not.toHaveBeenCalled();

    act(() => pane.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, clientX: 200, clientY: 400,
    })));
    expect(pane.dataset.handleHot).toBeUndefined();

    act(() => pane.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true })));
    expect(pane.dataset.handleHot).toBeUndefined();
  });

  it("keeps the grab dots visible while the pane menu is open", () => {
    const { group, layout } = createThreePaneWorkspace();
    const container = renderSplitView(group, layout);
    const pane = container.querySelector<HTMLElement>(".desktop-editor-pane")!;
    const handle = pane.querySelector<HTMLButtonElement>(".desktop-editor-pane-handle")!;
    pane.getBoundingClientRect = () => new DOMRect(0, 0, 400, 600);
    installPointerCaptureStub(handle);

    clickPaneHandle(handle, 41);
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(pane.dataset.handleHot).toBe("true");
    expect(pane.dataset.paneMenuOpen).toBe("true");

    act(() => pane.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true })));
    expect(pane.dataset.handleHot).toBe("true");

    clickPaneHandle(handle, 42);
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    expect(pane.dataset.paneMenuOpen).toBeUndefined();
  });

  it("uses the grab handle only to move an existing pane", async () => {
    const onMovePane = vi.fn();
    const capturePanePreview = vi.fn(async () => ({
      dataUrl: "data:image/png;base64,c25hcHNob3Q=",
      width: 104,
      height: 156,
    }));
    window.puppyoneDesktop = {
      capturePanePreview,
    } as NonNullable<typeof window.puppyoneDesktop>;
    let group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput("a.md"));
    group = openEditor(group, createEditorInput("b.md"));
    let layout = splitEditorPane(createEditorPaneLayout("a.md"), "editor-pane-1", "horizontal");
    layout = assignEditorToActivePane(layout, "b.md");
    const container = renderSplitView(group, layout, { onMovePane });
    const panes = container.querySelectorAll<HTMLElement>(".desktop-editor-pane");
    const handle = panes[0]!.querySelector<HTMLButtonElement>(".desktop-editor-pane-handle")!;
    panes[0]!.getBoundingClientRect = () => new DOMRect(0, 0, 400, 600);
    panes[0]!.querySelector<HTMLElement>(".desktop-editor-pane-content")!
      .getBoundingClientRect = () => new DOMRect(0, 0, 400, 600);
    panes[1]!.getBoundingClientRect = () => new DOMRect(400, 0, 400, 600);
    const capturedPointers = new Set<number>();
    handle.setPointerCapture = (pointerId) => capturedPointers.add(pointerId);
    handle.hasPointerCapture = (pointerId) => capturedPointers.has(pointerId);
    handle.releasePointerCapture = (pointerId) => capturedPointers.delete(pointerId);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(panes[1]!);

    act(() => handle.dispatchEvent(new PointerEvent("pointerover", {
      bubbles: true, clientX: 200, clientY: 5, pointerId: 7,
    })));
    expect(capturePanePreview).toHaveBeenCalledTimes(1);

    act(() => handle.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, button: 0, clientX: 200, clientY: 5, pointerId: 7,
    })));
    expect(document.body.classList.contains("desktop-editor-pane-dragging")).toBe(false);
    expect(capturePanePreview).toHaveBeenCalledTimes(1);

    act(() => handle.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, clientX: 201, clientY: 6, pointerId: 7,
    })));
    expect(document.body.classList.contains("desktop-editor-pane-dragging")).toBe(false);
    expect(capturePanePreview).toHaveBeenCalledTimes(1);

    act(() => handle.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, clientX: 203, clientY: 7, pointerId: 7,
    })));
    expect(document.body.classList.contains("desktop-editor-pane-dragging")).toBe(true);
    expect(capturePanePreview).toHaveBeenCalledTimes(1);
    const preview = document.body.querySelector<HTMLElement>(".desktop-editor-pane-move-preview");
    expect(preview).not.toBeNull();
    expect(preview!.style.transform).toContain("203px");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(preview!.dataset.ready).toBe("true");
    expect(preview!.querySelector("img")?.getAttribute("src")).toContain("data:image/png");
    expect(panes[0]!.getAttribute("data-move-source")).toBe("true");

    act(() => handle.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true, clientX: 790, clientY: 300, pointerId: 7,
    })));
    expect(preview!.style.transform).toContain("790px");
    expect(panes[1]!.dataset.dropTarget).toBe("right");

    act(() => handle.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, clientX: 790, clientY: 300, pointerId: 7,
    })));
    act(() => handle.dispatchEvent(new MouseEvent("click", {
      bubbles: true, button: 0, detail: 0,
    })));
    expect(onMovePane).toHaveBeenCalledWith(
      "editor-pane-1",
      "editor-pane-2",
      "horizontal",
      "second",
    );
    expect(document.body.classList.contains("desktop-editor-pane-dragging")).toBe(false);
    expect(document.body.querySelector(".desktop-editor-pane-move-preview")).toBeNull();
    expect(panes[0]!.getAttribute("data-move-source")).toBeNull();
    expect(document.querySelector(".desktop-editor-pane-menu")).toBeNull();
  });

  it("cancels pane movement without swallowing the next menu press", () => {
    const onMovePane = vi.fn();
    let group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput("a.md"));
    group = openEditor(group, createEditorInput("b.md"));
    let layout = splitEditorPane(createEditorPaneLayout("a.md"), "editor-pane-1", "horizontal");
    layout = assignEditorToActivePane(layout, "b.md");
    const container = renderSplitView(group, layout, { onMovePane });
    const panes = container.querySelectorAll<HTMLElement>(".desktop-editor-pane");
    const handle = panes[0]!.querySelector<HTMLButtonElement>(".desktop-editor-pane-handle")!;
    installPointerCaptureStub(handle);
    panes[1]!.getBoundingClientRect = () => new DOMRect(400, 0, 400, 600);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(panes[1]!);

    act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, button: 0, clientX: 200, clientY: 5, pointerId: 17,
      }));
      handle.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, clientX: 790, clientY: 300, pointerId: 17,
      }));
    });
    expect(panes[1]!.dataset.dropTarget).toBe("right");

    act(() => handle.dispatchEvent(new PointerEvent("lostpointercapture", {
      bubbles: true, pointerId: 17,
    })));
    expect(document.body.classList.contains("desktop-editor-pane-dragging")).toBe(false);
    expect(document.body.querySelector(".desktop-editor-pane-move-preview")).toBeNull();
    expect(panes[1]!.dataset.dropTarget).toBeUndefined();
    expect(onMovePane).not.toHaveBeenCalled();

    clickPaneHandle(handle, 18);
    expect(handle.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".desktop-editor-pane-menu")).not.toBeNull();
  });

  it("keeps pane menus exclusive without entering global drag state on click", () => {
    const { group, layout } = createThreePaneWorkspace();
    const container = renderSplitView(group, layout);
    const handles = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".desktop-editor-pane-handle"),
    );
    expect(handles).toHaveLength(3);
    handles.forEach(installPointerCaptureStub);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".desktop-editor-pane"))
      .every((pane) => pane.dataset.handleHot === undefined)).toBe(true);

    clickPaneHandle(handles[0]!, 11);
    expect(document.body.classList.contains("desktop-editor-pane-dragging")).toBe(false);
    expect(handles.map((handle) => handle.getAttribute("aria-expanded"))).toEqual([
      "true", "false", "false",
    ]);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);

    clickPaneHandle(handles[0]!, 13);
    expect(handles.every((handle) => handle.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    clickPaneHandle(handles[2]!, 12);
    expect(document.body.classList.contains("desktop-editor-pane-dragging")).toBe(false);
    expect(handles.map((handle) => handle.getAttribute("aria-expanded"))).toEqual([
      "false", "false", "true",
    ]);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  });

  it("activates a non-focusable pane after pointer selection completes", () => {
    const onFocusPane = vi.fn();
    const { group, layout } = createThreePaneWorkspace();
    const container = renderSplitView(group, layout, { onFocusPane });
    const panes = container.querySelectorAll<HTMLElement>(".desktop-editor-pane");
    const inactivePane = panes[0]!;

    act(() => inactivePane.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true, button: 0, pointerId: 21,
    })));
    expect(onFocusPane).not.toHaveBeenCalled();

    act(() => inactivePane.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true, button: 0, pointerId: 21,
    })));
    expect(onFocusPane).toHaveBeenCalledWith("editor-pane-1");
  });

  it("keeps mixed source transitions isolated inside a real three-pane split", async () => {
    const csv = "report.csv";
    const image = "diagram.png";
    const markdown = "notes.md";
    let group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(csv));
    group = openEditor(group, createEditorInput(image));
    group = openEditor(group, createEditorInput(markdown));
    let initialLayout = splitEditorPane(createEditorPaneLayout(csv), "editor-pane-1", "horizontal");
    initialLayout = assignEditorToActivePane(initialLayout, image);
    initialLayout = splitEditorPane(initialLayout, initialLayout.activePaneId, "vertical");
    initialLayout = assignEditorToActivePane(initialLayout, markdown);
    const tree: DataNode[] = [
      { id: csv, path: csv, name: csv, type: "spreadsheet", mimeType: "text/csv", source: "local" },
      { id: image, path: image, name: image, type: "image", mimeType: "image/png", source: "local" },
      { id: markdown, path: markdown, name: markdown, type: "markdown", mimeType: "text/markdown", source: "local" },
    ];
    const readFile = vi.fn(async (path: string) => ({
      path,
      name: path,
      type: path === csv ? "spreadsheet" as const : "markdown" as const,
      mimeType: path === csv ? "text/csv" : "text/markdown",
      content: `content:${path}`,
      version: `version:${path}:${readFile.mock.calls.length}`,
    }));
    const getFileUrl = vi.fn(async (path: string) => `blob:${path}`);
    const dataPort = { listChildren: async () => tree, readFile, getFileUrl };
    const state = { ...emptyWorkspaceState(), tree };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let updateLayout!: React.Dispatch<React.SetStateAction<EditorPaneLayoutState>>;

    function Harness() {
      const [layout, setLayout] = React.useState(initialLayout);
      updateLayout = setLayout;
      return withTestLocalization(
        <DesktopEditorSplitView
          aiEditRequest={null}
          dataPort={dataPort}
          editorGroup={group}
          editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
          editorTree={state.tree}
          fileIconTheme="default"
          layout={layout}
          markdownEnvironment={state.markdownEnvironment}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          onClosePane={vi.fn()}
          onFocusPane={vi.fn()}
          onMovePane={vi.fn()}
          onOpenAtPaneEdge={vi.fn()}
          onResizeSplit={vi.fn()}
          onSplitPane={vi.fn()}
        />,
      );
    }

    await act(async () => root?.render(<Harness />));
    await waitForCondition(() => (
      readCount(readFile, csv) === 1
      && readCount(readFile, markdown) === 1
      && getFileUrl.mock.calls.some(([path]) => path === image)
    ));
    expect(container.querySelectorAll(".desktop-editor-pane")).toHaveLength(3);

    await act(async () => updateLayout((layout) => assignEditorToPane(layout, "editor-pane-1", image)));
    await waitForCondition(() => (
      container.querySelector('[data-editor-pane-id="editor-pane-1"] img') !== null
      || getFileUrl.mock.calls.filter(([path]) => path === image).length >= 1
    ));
    await act(async () => updateLayout((layout) => assignEditorToPane(layout, "editor-pane-1", csv)));
    await waitForCondition(() => readCount(readFile, csv) === 2);

    expect(readCount(readFile, markdown)).toBe(1);
    expect(readCount(readFile, image)).toBe(0);
    expect(container.querySelectorAll(".desktop-editor-pane")).toHaveLength(3);
  });

  it("reorders two sibling panes without clearing or remounting their editor runtimes", async () => {
    const paths = ["left.txt", "right.txt"] as const;
    let group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(paths[0]));
    group = openEditor(group, createEditorInput(paths[1]));
    let initialLayout = splitEditorPane(
      createEditorPaneLayout(paths[0]),
      "editor-pane-1",
      "horizontal",
    );
    initialLayout = assignEditorToActivePane(initialLayout, paths[1]);
    const tree: DataNode[] = paths.map((path) => ({
      id: path,
      name: path,
      path,
      type: "text",
      source: "local",
    }));
    const readFile = vi.fn(async (path: string) => ({
      path,
      name: path,
      type: "text" as const,
      content: `stable content for ${path}`,
      version: `version:${path}`,
    }));
    const state = { ...emptyWorkspaceState(), tree };
    const dataPort = { listChildren: async () => tree, readFile };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.puppyoneDesktop = {
      capturePanePreview: vi.fn(async () => null),
    } as NonNullable<typeof window.puppyoneDesktop>;

    function Harness() {
      const [layout, setLayout] = React.useState(initialLayout);
      return withTestLocalization(
        <DesktopEditorSplitView
          aiEditRequest={null}
          dataPort={dataPort}
          editorGroup={group}
          editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
          editorTree={state.tree}
          fileIconTheme="default"
          layout={layout}
          markdownEnvironment={state.markdownEnvironment}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          onClosePane={vi.fn()}
          onFocusPane={vi.fn()}
          onMovePane={(sourcePaneId, targetPaneId, direction, placement) => {
            setLayout((current) => moveEditorPane(
              current,
              sourcePaneId,
              targetPaneId,
              direction,
              placement,
            ));
          }}
          onOpenAtPaneEdge={vi.fn()}
          onResizeSplit={vi.fn()}
          onSplitPane={vi.fn()}
        />,
      );
    }

    await act(async () => root?.render(<Harness />));
    await waitForCondition(() => container.querySelectorAll(".cm-editor").length === 2);
    const originalViews = new Map(
      Array.from(container.querySelectorAll<HTMLElement>(".desktop-editor-pane")).map((pane) => [
        pane.dataset.editorPaneId!,
        EditorView.findFromDOM(pane.querySelector<HTMLElement>(".cm-editor")!),
      ]),
    );
    const panes = container.querySelectorAll<HTMLElement>(".desktop-editor-pane");
    const leftPane = panes[0]!;
    const rightPane = panes[1]!;
    leftPane.getBoundingClientRect = () => new DOMRect(0, 0, 400, 600);
    rightPane.getBoundingClientRect = () => new DOMRect(400, 0, 400, 600);
    rightPane.querySelector<HTMLElement>(".desktop-editor-pane-content")!
      .getBoundingClientRect = () => new DOMRect(400, 0, 400, 600);
    const rightHandle = rightPane.querySelector<HTMLButtonElement>(
      ".desktop-editor-pane-handle",
    )!;
    installPointerCaptureStub(rightHandle);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(leftPane);

    await act(async () => {
      rightHandle.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true, button: 0, clientX: 600, clientY: 5, pointerId: 71,
      }));
      rightHandle.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true, clientX: 10, clientY: 300, pointerId: 71,
      }));
      rightHandle.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true, button: 0, clientX: 10, clientY: 300, pointerId: 71,
      }));
      await Promise.resolve();
    });

    expect(Array.from(container.querySelectorAll<HTMLElement>(".desktop-editor-pane")).map(
      (pane) => pane.dataset.editorPaneId,
    )).toEqual(["editor-pane-2", "editor-pane-1"]);
    expect(readFile).toHaveBeenCalledTimes(2);
    for (const [paneId, originalView] of originalViews) {
      const pane = container.querySelector<HTMLElement>(`[data-editor-pane-id="${paneId}"]`)!;
      expect(EditorView.findFromDOM(pane.querySelector<HTMLElement>(".cm-editor")!))
        .toBe(originalView);
    }
  });

  it("reparents panes across nested split axes without remounting any editor runtime", async () => {
    const { group, layout: initialLayout } = createThreePaneWorkspace("txt");
    const paths = ["a.txt", "b.txt", "c.txt"] as const;
    const tree: DataNode[] = paths.map((path) => ({
      id: path,
      name: path,
      path,
      type: "text",
      source: "local",
    }));
    const readFile = vi.fn(async (path: string) => ({
      path,
      name: path,
      type: "text" as const,
      content: `stable content for ${path}`,
      version: `version:${path}`,
    }));
    const state = { ...emptyWorkspaceState(), tree };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let updateLayout!: React.Dispatch<React.SetStateAction<EditorPaneLayoutState>>;

    const dataPort = { listChildren: async () => tree, readFile };
    function Harness() {
      const [layout, setLayout] = React.useState(initialLayout);
      updateLayout = setLayout;
      return withTestLocalization(
        <DesktopEditorSplitView
          aiEditRequest={null}
          dataPort={dataPort}
          editorGroup={group}
          editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
          editorTree={state.tree}
          fileIconTheme="default"
          layout={layout}
          markdownEnvironment={state.markdownEnvironment}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          onClosePane={vi.fn()}
          onFocusPane={vi.fn()}
          onMovePane={vi.fn()}
          onOpenAtPaneEdge={vi.fn()}
          onResizeSplit={vi.fn()}
          onSplitPane={vi.fn()}
        />,
      );
    }

    await act(async () => root?.render(<Harness />));
    await waitForCondition(() => container.querySelectorAll(".cm-editor").length === 3);
    const initialReadCount = readFile.mock.calls.length;
    const paneElements = new Map(
      Array.from(container.querySelectorAll<HTMLElement>(".desktop-editor-pane")).map((pane) => [
        pane.dataset.editorPaneId!,
        pane,
      ]),
    );
    const editorViews = new Map(
      Array.from(paneElements, ([paneId, pane]) => [
        paneId,
        EditorView.findFromDOM(pane.querySelector<HTMLElement>(".cm-editor")!),
      ]),
    );

    act(() => {
      editorViews.get("editor-pane-1")!.dispatch({ selection: { anchor: 1 } });
      editorViews.get("editor-pane-2")!.dispatch({ selection: { anchor: 2 } });
      editorViews.get("editor-pane-3")!.dispatch({ selection: { anchor: 3 } });
    });
    await act(async () => updateLayout((current) => moveEditorPane(
      current,
      "editor-pane-1",
      "editor-pane-3",
      "vertical",
      "second",
    )));

    expect(readFile).toHaveBeenCalledTimes(initialReadCount);
    for (const [paneId, paneElement] of paneElements) {
      const currentPane = container.querySelector<HTMLElement>(
        `[data-editor-pane-id="${paneId}"]`,
      )!;
      expect(currentPane).toBe(paneElement);
      expect(EditorView.findFromDOM(currentPane.querySelector<HTMLElement>(".cm-editor")!))
        .toBe(editorViews.get(paneId));
    }
    expect(Array.from(editorViews.values()).map(
      (view) => view.state.selection.main.anchor,
    )).toEqual([1, 2, 3]);
  });

  it("keeps horizontal Markdown pane scroll and runtimes stable across repeated focus routing", async () => {
    const paths = ["left.md", "right.md"] as const;
    const markdown = Array.from({ length: 80 }, (_, index) => [
      `## Section ${index + 1}`,
      "",
      `Paragraph ${index + 1} contains **projected source** for focus continuity coverage.`,
      "",
    ]).flat().join("\n");
    let group = openEditor(EMPTY_EDITOR_GROUP, createEditorInput(paths[0]));
    group = openEditor(group, createEditorInput(paths[1]));
    let initialLayout = splitEditorPane(
      createEditorPaneLayout(paths[0]),
      "editor-pane-1",
      "horizontal",
    );
    initialLayout = assignEditorToActivePane(initialLayout, paths[1]);
    const tree: DataNode[] = paths.map((path) => ({
      id: path,
      name: path,
      path,
      type: "markdown",
      mimeType: "text/markdown",
      source: "local",
    }));
    const readFile = vi.fn(async (path: string) => ({
      path,
      name: path,
      type: "markdown" as const,
      mimeType: "text/markdown",
      content: `${markdown}\n\n${path}`,
      version: `version:${path}`,
    }));
    const dataPort = {
      listChildren: async () => tree,
      readFile,
      documentPersistence: {
        kind: "local-fs" as const,
        storageIdentity: "test:horizontal-markdown-focus",
        persist: async (request: { baseVersion?: string | null; path: string }) => ({
          ok: true as const,
          version: request.baseVersion ?? `version:${request.path}`,
        }),
      },
    };
    const state = { ...emptyWorkspaceState(), tree };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    function Harness() {
      const [layout, setLayout] = React.useState(initialLayout);
      return withTestLocalization(
        <DesktopEditorSplitView
          aiEditRequest={null}
          dataPort={dataPort}
          editorGroup={group}
          editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
          editorTree={state.tree}
          fileIconTheme="default"
          layout={layout}
          markdownEnvironment={state.markdownEnvironment}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          onClosePane={vi.fn()}
          onFocusPane={(paneId) => setLayout((current) => activateEditorPane(current, paneId))}
          onMovePane={vi.fn()}
          onOpenAtPaneEdge={vi.fn()}
          onResizeSplit={vi.fn()}
          onSplitPane={vi.fn()}
        />,
      );
    }

    await act(async () => root?.render(<Harness />));
    await waitForCondition(() => container.querySelectorAll(".cm-editor").length === 2);
    const panes = Array.from(container.querySelectorAll<HTMLElement>(".desktop-editor-pane"));
    const views = panes.map((pane) => (
      EditorView.findFromDOM(pane.querySelector<HTMLElement>(".cm-editor")!)
    ));
    const leftSnapshot = vi.spyOn(views[0]!, "scrollSnapshot");
    const rightSnapshot = vi.spyOn(views[1]!, "scrollSnapshot");

    act(() => {
      views[0]!.dispatch({ selection: { anchor: 120 } });
      views[1]!.dispatch({ selection: { anchor: 240 } });
    });
    // happy-dom does not start with a native BrowserWindow focus owner. Prime
    // both CodeMirror observers once, then measure only deterministic MDI
    // transitions. The Chromium regression below exercises the cold boundary.
    await focusEditorView(views[1]!);
    await focusEditorView(views[0]!);
    leftSnapshot.mockClear();
    rightSnapshot.mockClear();
    act(() => {
      views[0]!.scrollDOM.scrollTop = 640;
      views[1]!.scrollDOM.scrollTop = 960;
    });
    const surfaceRender = vi.spyOn(DocumentSurfaceHost.prototype, "render");
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 40)));
    surfaceRender.mockClear();

    for (let cycle = 0; cycle < 6; cycle += 1) {
      const beforeRightFocus = [leftSnapshot.mock.calls.length, rightSnapshot.mock.calls.length];
      await focusEditorView(views[1]!);
      expect([
        leftSnapshot.mock.calls.length - beforeRightFocus[0]!,
        rightSnapshot.mock.calls.length - beforeRightFocus[1]!,
      ], `right focus boundary ${cycle + 1}`).toEqual([1, 1]);
      expect(container.querySelector('[data-editor-pane-id="editor-pane-2"]')?.dataset.active)
        .toBe("true");
      expect(views[0]!.scrollDOM.scrollTop).toBe(640);

      const beforeLeftFocus = [leftSnapshot.mock.calls.length, rightSnapshot.mock.calls.length];
      await focusEditorView(views[0]!);
      expect([
        leftSnapshot.mock.calls.length - beforeLeftFocus[0]!,
        rightSnapshot.mock.calls.length - beforeLeftFocus[1]!,
      ], `left focus boundary ${cycle + 1}`).toEqual([1, 1]);
      expect(container.querySelector('[data-editor-pane-id="editor-pane-1"]')?.dataset.active)
        .toBe("true");
      expect(views[1]!.scrollDOM.scrollTop).toBe(960);
    }

    expect([leftSnapshot.mock.calls.length, rightSnapshot.mock.calls.length])
      .toEqual([12, 12]);
    expect(surfaceRender).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(views.map((view) => view.state.selection.main.anchor)).toEqual([120, 240]);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".desktop-editor-pane")))
      .toEqual(panes);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".cm-editor")).map(
      (element) => EditorView.findFromDOM(element),
    )).toEqual(views);
  });

  it("keeps three CodeMirror focus and selection states isolated across pane activation", async () => {
    const { group, layout } = createThreePaneWorkspace("txt");
    const state = {
      ...emptyWorkspaceState(),
      tree: ["a.txt", "b.txt", "c.txt"].map((path) => ({
        id: path,
        name: path,
        path,
        type: "text" as const,
        source: "local" as const,
      })),
    };
    const dataPort = {
      listChildren: async () => state.tree,
      readFile: async (path: string) => ({
        path,
        name: path,
        type: "text" as const,
        content: `${path} has independent editor state`,
        version: `version:${path}`,
      }),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    function Harness() {
      const [currentLayout, setCurrentLayout] = React.useState(layout);
      return withTestLocalization(
        <DesktopEditorSplitView
          aiEditRequest={null}
          dataPort={dataPort}
          editorGroup={group}
          editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
          editorTree={state.tree}
          fileIconTheme="default"
          layout={currentLayout}
          markdownEnvironment={state.markdownEnvironment}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          onClosePane={vi.fn()}
          onFocusPane={(paneId) => setCurrentLayout((current) => activateEditorPane(current, paneId))}
          onMovePane={vi.fn()}
          onOpenAtPaneEdge={vi.fn()}
          onResizeSplit={vi.fn()}
          onSplitPane={vi.fn()}
        />,
      );
    }

    await act(async () => root?.render(<Harness />));
    await waitForCondition(() => container.querySelectorAll(".cm-editor").length === 3);
    const editorElements = Array.from(container.querySelectorAll<HTMLElement>(".cm-editor"));
    const views = editorElements.map((element) => EditorView.findFromDOM(element));

    act(() => {
      views[0]!.dispatch({ selection: { anchor: 1 } });
      views[1]!.dispatch({ selection: { anchor: 2 } });
      views[2]!.dispatch({ selection: { anchor: 3 } });
      views[0]!.focus();
    });
    expect(container.querySelector('[data-editor-pane-id="editor-pane-1"]')?.dataset.active)
      .toBe("true");
    expect(views[0]!.contentDOM.contains(document.activeElement)).toBe(true);

    act(() => views[1]!.focus());
    expect(container.querySelector('[data-editor-pane-id="editor-pane-2"]')?.dataset.active)
      .toBe("true");
    expect(views[1]!.contentDOM.contains(document.activeElement)).toBe(true);
    expect(views.map((view) => view.state.selection.main.anchor)).toEqual([1, 2, 3]);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".cm-editor")).map(
      (element) => EditorView.findFromDOM(element),
    )).toEqual(views);

    const surfaceRender = vi.spyOn(DocumentSurfaceHost.prototype, "render");
    const activeHandle = container.querySelector<HTMLElement>(
      '[data-editor-pane-id="editor-pane-2"] .desktop-editor-pane-handle',
    )!;
    installPointerCaptureStub(activeHandle);
    clickPaneHandle(activeHandle, 31);
    expect(surfaceRender).not.toHaveBeenCalled();

    act(() => views[0]!.focus());
    expect(container.querySelector('[data-editor-pane-id="editor-pane-1"]')?.dataset.active)
      .toBe("true");
    expect(surfaceRender).not.toHaveBeenCalled();
  });

  it("keeps an inactive Markdown table pane byte-for-byte mounted while sibling panes route workspace focus", async () => {
    const { group, layout: initialLayout } = createThreePaneWorkspace("md");
    const sources = new Map([
      ["a.md", [
        "| Name | Value |",
        "| --- | --- |",
        "| stable | table |",
        "",
        "Paragraph below the table keeps **the same DOM identity**.",
      ].join("\n")],
      ["b.md", "# B\n\nSibling B owns its own projection."],
      ["c.md", "# C\n\nSibling C owns its own projection."],
    ]);
    const tree: DataNode[] = Array.from(sources.keys(), (path) => ({
      id: path,
      name: path,
      path,
      type: "markdown",
      mimeType: "text/markdown",
      source: "local",
    }));
    const readFile = vi.fn(async (path: string) => ({
      path,
      name: path,
      type: "markdown" as const,
      mimeType: "text/markdown",
      content: sources.get(path) ?? "",
      version: `version:${path}`,
    }));
    const dataPort = { listChildren: async () => tree, readFile };
    const editorById = new Map(group.editors.map((editor) => [editor.id, editor]));
    const paneResource = new Map(getEditorPanes(initialLayout).map((pane) => [
      pane.id,
      pane.editorId ? editorById.get(pane.editorId)?.resource ?? null : null,
    ]));
    const readyEnvironments: DataWorkspaceState["markdownEnvironment"][] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    function Harness() {
      const [layout, setLayout] = React.useState(initialLayout);
      const [activePath, setActivePath] = React.useState<string | null>("a.md");
      return withTestLocalization(
        <DataWorkspace
          activePath={activePath}
          dataPort={dataPort}
          enableMarkdownLinkContentIndexing={false}
          loadActiveFileSource={false}
          showHeader={false}
          workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
          mainSlot={(state) => {
            if (state.tree.length === tree.length) readyEnvironments.push(state.markdownEnvironment);
            return (
              <DesktopEditorSplitView
                aiEditRequest={null}
                dataPort={dataPort}
                editorGroup={group}
                editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
                editorTree={state.tree}
                fileIconTheme="default"
                layout={layout}
                markdownEnvironment={state.markdownEnvironment}
                workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
                onClosePane={vi.fn()}
                onFocusPane={(paneId) => {
                  setLayout((current) => activateEditorPane(current, paneId));
                  setActivePath(paneResource.get(paneId) ?? null);
                }}
                onMovePane={vi.fn()}
                onOpenAtPaneEdge={vi.fn()}
                onResizeSplit={vi.fn()}
                onSplitPane={vi.fn()}
              />
            );
          }}
          onActivePathChange={async (path) => setActivePath(path)}
        />,
      );
    }

    await act(async () => root?.render(<Harness />));
    await waitForCondition(() => (
      container.querySelectorAll(".cm-editor").length === 3
      && container.querySelector('[data-editor-pane-id="editor-pane-1"] .cm-md-table-widget') !== null
    ));
    const panes = Array.from(container.querySelectorAll<HTMLElement>(".desktop-editor-pane"));
    const views = panes.map((pane) => EditorView.findFromDOM(
      pane.querySelector<HTMLElement>(".cm-editor")!,
    ));
    await focusEditorView(views[0]!);
    await focusEditorView(views[1]!);

    const firstPane = container.querySelector<HTMLElement>(
      '[data-editor-pane-id="editor-pane-1"]',
    )!;
    const table = firstPane.querySelector(".cm-md-table-widget");
    const paragraph = Array.from(firstPane.querySelectorAll<HTMLElement>(".cm-line"))
      .find((line) => line.textContent?.includes("Paragraph below the table"));
    expect(table).not.toBeNull();
    expect(paragraph).not.toBeUndefined();
    const firstPaneHtml = views[0]!.contentDOM.innerHTML;
    const firstPaneDispatch = vi.spyOn(views[0]!, "dispatch");
    const surfaceRender = vi.spyOn(DocumentSurfaceHost.prototype, "render");
    surfaceRender.mockClear();

    for (let cycle = 0; cycle < 6; cycle += 1) {
      await focusEditorView(views[2]!);
      await focusEditorView(views[1]!);
      expect(firstPane.querySelector(".cm-md-table-widget")).toBe(table);
      expect(Array.from(firstPane.querySelectorAll<HTMLElement>(".cm-line"))
        .find((line) => line.textContent?.includes("Paragraph below the table")))
        .toBe(paragraph);
    }

    expect(views[0]!.contentDOM.innerHTML).toBe(firstPaneHtml);
    expect(firstPaneDispatch).not.toHaveBeenCalled();
    expect(surfaceRender).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledTimes(3);
    expect(new Set(readyEnvironments).size).toBe(1);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".cm-editor")).map(
      (element) => EditorView.findFromDOM(element),
    )).toEqual(views);
  });

  it("routes semantic Markdown revisions only to runtimes that consume them", () => {
    const image: DataNode = {
      id: "diagram.png",
      name: "diagram.png",
      path: "diagram.png",
      type: "image",
      mimeType: "image/png",
      source: "local",
    };
    const markdown: DataNode = {
      id: "note.md",
      name: "note.md",
      path: "note.md",
      type: "markdown",
      mimeType: "text/markdown",
      source: "local",
    };

    expect(areEditorPaneDocumentRuntimePropsEqual(
      runtimeProps(image, runtimeEnvironment(1)),
      runtimeProps({ ...image }, runtimeEnvironment(2)),
    )).toBe(true);
    expect(areEditorPaneDocumentRuntimePropsEqual(
      runtimeProps(markdown, runtimeEnvironment(1)),
      runtimeProps({ ...markdown }, runtimeEnvironment(2)),
    )).toBe(false);
    expect(areEditorPaneDocumentRuntimePropsEqual(
      runtimeProps(markdown, runtimeEnvironment(7)),
      runtimeProps({ ...markdown }, runtimeEnvironment(7)),
    )).toBe(true);
  });

  it("shows an unavailable state instead of blanking a pane restored as a directory", () => {
    const folder: DataNode = {
      id: "docs",
      name: "docs",
      path: "docs",
      type: "folder",
      children: [],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <EditorPaneDocumentRuntime {...runtimeProps(folder, runtimeEnvironment(0))} />,
    )));

    expect(container.querySelector(".document-preview")).toBeNull();
    expect(container.textContent).not.toContain("Binary file");
    expect(container.textContent).not.toContain("folder file");
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("Cannot open in editor");
  });
});

function renderSplitView(
  editorGroup: EditorGroupState,
  layout: EditorPaneLayoutState,
  callbacks: {
    onMovePane?: React.ComponentProps<typeof DesktopEditorSplitView>["onMovePane"];
    onOpenAtPaneEdge?: React.ComponentProps<typeof DesktopEditorSplitView>["onOpenAtPaneEdge"];
    onResolveResourceDrop?: React.ComponentProps<typeof DesktopEditorSplitView>["onResolveResourceDrop"];
    onSplitPane?: React.ComponentProps<typeof DesktopEditorSplitView>["onSplitPane"];
    onFocusPane?: React.ComponentProps<typeof DesktopEditorSplitView>["onFocusPane"];
    resourceDragEntries?: React.ComponentProps<typeof DesktopEditorSplitView>["resourceDragEntries"];
    resourceDragSessionId?: React.ComponentProps<typeof DesktopEditorSplitView>["resourceDragSessionId"];
  } = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(renderSplitViewContents(editorGroup, layout, callbacks)));
  return container;
}

function renderSplitViewContents(
  editorGroup: EditorGroupState,
  layout: EditorPaneLayoutState,
  callbacks: {
    onMovePane?: React.ComponentProps<typeof DesktopEditorSplitView>["onMovePane"];
    onOpenAtPaneEdge?: React.ComponentProps<typeof DesktopEditorSplitView>["onOpenAtPaneEdge"];
    onResolveResourceDrop?: React.ComponentProps<typeof DesktopEditorSplitView>["onResolveResourceDrop"];
    onSplitPane?: React.ComponentProps<typeof DesktopEditorSplitView>["onSplitPane"];
    onFocusPane?: React.ComponentProps<typeof DesktopEditorSplitView>["onFocusPane"];
    resourceDragEntries?: React.ComponentProps<typeof DesktopEditorSplitView>["resourceDragEntries"];
    resourceDragSessionId?: React.ComponentProps<typeof DesktopEditorSplitView>["resourceDragSessionId"];
  } = {},
) {
  return withTestLocalization(
    <DesktopEditorSplitView
      aiEditRequest={null}
      dataPort={{ listChildren: async () => [] }}
      editorGroup={editorGroup}
      editorInteractionPreferences={{ showSaveStatus: false, markdownBlockDragEnabled: false }}
      editorTree={[]}
      fileIconTheme="default"
      layout={layout}
      markdownEnvironment={emptyWorkspaceState().markdownEnvironment}
      workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
      onClosePane={vi.fn()}
      onFocusPane={callbacks.onFocusPane ?? vi.fn()}
      onMovePane={callbacks.onMovePane ?? vi.fn()}
      onOpenAtPaneEdge={callbacks.onOpenAtPaneEdge ?? vi.fn()}
      onResolveResourceDrop={callbacks.onResolveResourceDrop}
      onResizeSplit={vi.fn()}
      resourceDragEntries={callbacks.resourceDragEntries}
      resourceDragSessionId={callbacks.resourceDragSessionId}
      onSplitPane={callbacks.onSplitPane ?? vi.fn()}
    />,
  );
}

function createThreePaneWorkspace(extension = "md") {
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

function installPointerCaptureStub(handle: HTMLElement) {
  const capturedPointers = new Set<number>();
  handle.setPointerCapture = (pointerId) => capturedPointers.add(pointerId);
  handle.hasPointerCapture = (pointerId) => capturedPointers.has(pointerId);
  handle.releasePointerCapture = (pointerId) => capturedPointers.delete(pointerId);
}

function clickPaneHandle(handle: HTMLElement, pointerId: number) {
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

function dragEvent(type: string, dataTransfer: DataTransfer, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
}

function readCount(readFile: ReturnType<typeof vi.fn>, path: string) {
  return readFile.mock.calls.filter(([readPath]) => readPath === path).length;
}

async function waitForCondition(condition: () => boolean, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 5)));
  }
  throw new Error("Timed out waiting for split editor state.");
}

async function focusEditorView(view: EditorView) {
  await act(async () => {
    view.focus();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  });
}

function emptyWorkspaceState(): DataWorkspaceState {
  return {
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

const runtimeDataPort: DataPort = { listChildren: async () => [] };
const runtimeLinkCommands: MarkdownLinkCommands = { openPath: () => undefined };

function runtimeProps(
  node: DataNode,
  markdownEnvironment: MarkdownWorkspaceEnvironment,
): EditorPaneDocumentRuntimeProps {
  return {
    aiEditFile: null,
    dataPort: runtimeDataPort,
    editor: { id: node.path, resource: node.path, label: node.name },
    editorInteractionPreferences: {
      showSaveStatus: false,
      markdownBlockDragEnabled: false,
    },
    fileIconTheme: "default",
    markdownEnvironment,
    treeNode: node,
    workspaceId: "workspace",
    workspaceRoot: "/workspace",
    markdownDialect: "puppy-gfm",
  };
}

function runtimeEnvironment(revision: number): MarkdownWorkspaceEnvironment {
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
