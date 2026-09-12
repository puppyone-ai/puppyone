/** @vitest-environment happy-dom */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSplitResizeHandle } from "../../../../src/features/editor-workbench/layout/EditorSplitResizeHandle";
import { withTestLocalization } from "../../../support/react/localization";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("EditorSplitResizeHandle", () => {
  it("previews many pointer moves in one frame and commits only the final ratio", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const onCommit = vi.fn();
    const { container, handle } = renderResizeHandle(onCommit);
    installResizeGeometry(container, handle);
    installPointerCapture(handle);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 500, 7));
      handle.dispatchEvent(pointerEvent("pointermove", 600, 7));
      handle.dispatchEvent(pointerEvent("pointermove", 700, 7));
    });

    expect(frames).toHaveLength(1);
    expect(onCommit).not.toHaveBeenCalled();
    act(() => frames[0]!(performance.now()));
    expect(container.style.getPropertyValue("--desktop-editor-first-track")).toBe("0.7fr");

    act(() => handle.dispatchEvent(pointerEvent("pointerup", 700, 7)));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("editor-split-1", 0.7);
    expect(handle.dataset.resizing).toBeUndefined();
  });

  it("cancels a preview on Escape without mutating durable layout", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    const onCommit = vi.fn();
    const { container, handle } = renderResizeHandle(onCommit);
    installResizeGeometry(container, handle);
    installPointerCapture(handle);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 650, 9));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(container.style.getPropertyValue("--desktop-editor-first-track")).toBe("0.5fr");
    expect(handle.getAttribute("aria-valuenow")).toBe("50");
  });

  it("cancels a resize preview when the window loses the session", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    const onCommit = vi.fn();
    const { container, handle } = renderResizeHandle(onCommit);
    installResizeGeometry(container, handle);
    installPointerCapture(handle);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 650, 19));
      window.dispatchEvent(new Event("blur"));
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(container.style.getPropertyValue("--desktop-editor-first-track")).toBe("0.5fr");
    expect(handle.dataset.resizing).toBeUndefined();
  });

  it("keeps keyboard and equalize operations as immediate single commits", () => {
    const onCommit = vi.fn();
    const { handle } = renderResizeHandle(onCommit, 0.6);

    act(() => handle.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
    })));
    act(() => handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));

    expect(onCommit.mock.calls).toEqual([
      ["editor-split-1", 0.625],
      ["editor-split-1", 0.5],
    ]);
  });
});

function renderResizeHandle(onCommit: (splitId: string, ratio: number) => void, ratio = 0.5) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(
    <div className="desktop-editor-split">
      <div />
      <EditorSplitResizeHandle
        direction="horizontal"
        ratio={ratio}
        splitId="editor-split-1"
        onCommit={onCommit}
      />
      <div />
    </div>,
  )));
  return {
    container: container.querySelector<HTMLElement>(".desktop-editor-split")!,
    handle: container.querySelector<HTMLElement>(".desktop-editor-splitter")!,
  };
}

function installResizeGeometry(container: HTMLElement, handle: HTMLElement) {
  container.getBoundingClientRect = () => new DOMRect(0, 0, 1001, 600);
  handle.getBoundingClientRect = () => new DOMRect(500, 0, 1, 600);
}

function installPointerCapture(handle: HTMLElement) {
  const captured = new Set<number>();
  handle.setPointerCapture = (pointerId) => captured.add(pointerId);
  handle.hasPointerCapture = (pointerId) => captured.has(pointerId);
  handle.releasePointerCapture = (pointerId) => captured.delete(pointerId);
}

function pointerEvent(type: string, clientX: number, pointerId: number) {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    clientX,
    clientY: 300,
    pointerId,
  });
}
