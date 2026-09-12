/** @vitest-environment happy-dom */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalSplitResizeHandle } from "../../../../src/features/desktop-terminal/layout/TerminalSplitResizeHandle";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Terminal split resizing", () => {
  it("previews pointer movement outside React and commits one bounded ratio", () => {
    const onCommit = vi.fn();
    const { container, handle } = renderHandle(onCommit);
    installGeometry(container, handle);
    installPointerCapture(handle);

    act(() => handle.dispatchEvent(pointer("pointerdown", 3, 250, 100)));
    act(() => handle.dispatchEvent(pointer("pointermove", 3, 400, 100)));
    act(() => handle.dispatchEvent(pointer("pointerup", 3, 400, 100)));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("split", 0.8);
    expect(container.style.getPropertyValue("--desktop-terminal-first-track"))
      .toBe("0.8fr");
  });

  it("restores committed geometry when the lifecycle cancels", () => {
    const onCommit = vi.fn();
    const { container, handle } = renderHandle(onCommit);
    installGeometry(container, handle);
    installPointerCapture(handle);

    act(() => handle.dispatchEvent(pointer("pointerdown", 4, 250, 100)));
    act(() => handle.dispatchEvent(pointer("pointermove", 4, 400, 100)));
    act(() => window.dispatchEvent(new Event("blur")));

    expect(onCommit).not.toHaveBeenCalled();
    expect(container.style.getPropertyValue("--desktop-terminal-first-track"))
      .toBe("0.5fr");
  });

  it("supports keyboard resize, bounds, and 50/50 reset", () => {
    const onCommit = vi.fn();
    const { container, handle } = renderHandle(onCommit);
    installGeometry(container, handle);

    act(() => handle.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      key: "ArrowRight",
    })));
    expect(onCommit).toHaveBeenLastCalledWith("split", 0.525);

    act(() => handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(onCommit).toHaveBeenLastCalledWith("split", 0.5);
  });
});

function renderHandle(onCommit: (splitId: string, ratio: number) => void) {
  const mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  act(() => root?.render(withTestLocalization(
    <div data-container>
      <TerminalSplitResizeHandle
        direction="horizontal"
        firstMinimum={{ width: 100, height: 100 }}
        secondMinimum={{ width: 100, height: 100 }}
        ratio={0.5}
        splitId="split"
        onCommit={onCommit}
      />
    </div>,
  )));
  return {
    container: mount.querySelector<HTMLElement>("[data-container]")!,
    handle: mount.querySelector<HTMLElement>(".desktop-terminal-splitter")!,
  };
}

function installGeometry(container: HTMLElement, handle: HTMLElement) {
  container.getBoundingClientRect = () => new DOMRect(0, 0, 500, 300);
  handle.getBoundingClientRect = () => new DOMRect(250, 0, 1, 300);
}

function pointer(type: string, pointerId: number, clientX: number, clientY: number) {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    clientX,
    clientY,
    pointerId,
  });
}

function installPointerCapture(element: HTMLElement) {
  const captured = new Set<number>();
  element.setPointerCapture = (pointerId) => captured.add(pointerId);
  element.hasPointerCapture = (pointerId) => captured.has(pointerId);
  element.releasePointerCapture = (pointerId) => captured.delete(pointerId);
}
