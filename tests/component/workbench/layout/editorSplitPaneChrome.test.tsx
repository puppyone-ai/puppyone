/** @vitest-environment happy-dom */
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { EMPTY_EDITOR_GROUP, EXPLORER_REFERENCE_DRAG_TYPE, assignEditorToActivePane, createEditorInput, createEditorPaneLayout, openEditor, serializeExplorerReferenceDrag, splitEditorPane, type DataNode } from "@puppyone/shared-ui";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { clickPaneHandle, createThreePaneWorkspace, dragEvent, installPointerCaptureStub, renderSplitView, setUpEditorSplitPanes } from "../../../support/workbench/editorSplitPaneHarness";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
setUpEditorSplitPanes();

describe("DesktopEditorSplitView: pane chrome, dropping and moving", () => {
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
    const node = {
      id: "b.md",
      name: "b.md",
      path: "b.md",
      type: "file",
      source: "local",
    } satisfies DataNode;
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
    installDesktopBridge({
      capturePanePreview,
    });
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
    installDesktopBridge({
      capturePanePreview,
    });
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
});
