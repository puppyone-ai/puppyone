/** @vitest-environment happy-dom */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSplitResizeHandle } from "../../../../src/features/editor-workbench/layout/EditorSplitResizeHandle";
import { acquireNativeSurfaceResizeLease, isNativeSurfaceLayoutStable } from "../../../../src/features/native-surfaces";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  delete window.puppyoneDesktop;
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

function renderResizeHandle(onCommit: (splitId: string, ratio: number) => void, ratio = 0.5, direction: "horizontal" | "vertical" = "horizontal") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(
    <div className="desktop-editor-split">
      <div />
      <EditorSplitResizeHandle
        direction={direction}
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


describe.each(["horizontal", "vertical"] as const)("%s editor splitter lifecycle", (direction) => {
  function fixture() {
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++sequence, callback); return sequence; });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
    const publish = vi.fn();
    installDesktopBridge({ setNativeSurfacePointerPassthrough: publish });
    const commit = vi.fn();
    const { container, handle } = renderResizeHandle(commit, 0.5, direction);
    container.getBoundingClientRect = () => new DOMRect(20, 30, 1001, 1001);
    handle.getBoundingClientRect = () => direction === "horizontal"
      ? new DOMRect(520, 30, 1, 1001) : new DOMRect(20, 530, 1001, 1);
    installPointerCapture(handle);
    const fire = (type: string, offset = 700.5, pointerId = 7) => act(() => handle.dispatchEvent(new PointerEvent(type, {
      bubbles: true, button: 0, pointerId, pointerType: "mouse",
      clientX: direction === "horizontal" ? 20 + offset : 80,
      clientY: direction === "vertical" ? 30 + offset : 90,
    })));
    const flush = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(performance.now())); });
    return { container, handle, commit, publish, frames, fire, flush };
  }

  it.each(["pointercancel", "Escape", "blur", "pagehide", "hidden", "unmount"])(
    "cancels %s with a queued frame and releases only its gesture", (reason) => {
      const f = fixture();
      f.fire("pointerdown", 500.5);
      f.flush();
      f.fire("pointermove");
      expect(f.frames.size).toBe(1);
      expect(isNativeSurfaceLayoutStable()).toBe(false);
      expect(f.publish).toHaveBeenLastCalledWith({ active: true });
      const lateFrames = [...f.frames.values()];
      if (reason === "pointercancel" || reason === "lostpointercapture") f.fire(reason);
      else act(() => {
        if (reason === "unmount") { root?.unmount(); root = null; }
        else if (reason === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        else if (reason === "hidden") {
          vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
          document.dispatchEvent(new Event("visibilitychange"));
        } else window.dispatchEvent(new Event(reason));
      });
      expect(f.commit).not.toHaveBeenCalled();
      expect(f.handle.dataset.resizing).toBeUndefined();
      expect(f.handle.hasPointerCapture(7)).toBe(false);
      expect(f.handle.getAttribute("aria-valuenow")).toBe("50");
      expect(f.container.style.getPropertyValue("--desktop-editor-first-track")).toBe("0.5fr");
      expect(f.frames.size).toBe(0);
      expect(isNativeSurfaceLayoutStable()).toBe(true);
      expect(f.publish.mock.calls).toEqual([[{ active: true }], [{ active: false }]]);
      act(() => lateFrames.forEach(callback => callback(performance.now())));
      f.fire("pointerup");
      expect(f.commit).not.toHaveBeenCalled();
      expect(f.container.style.getPropertyValue("--desktop-editor-first-track")).toBe("0.5fr");
    },
  );

  it("commits the final pointer coordinate once and ignores late callbacks", () => {
    const f = fixture();
    f.fire("pointerdown", 500.5);
    f.fire("pointermove", 600.5);
    const lateFrames = [...f.frames.values()];
    f.fire("pointerup", 800.5);
    f.fire("pointerup", 900.5);
    act(() => lateFrames.forEach(callback => callback(performance.now())));
    expect(f.commit.mock.calls).toEqual([["editor-split-1", 0.8]]);
    expect(f.handle.hasPointerCapture(7)).toBe(false);
    expect(isNativeSurfaceLayoutStable()).toBe(true);
    expect(f.container.style.getPropertyValue("--desktop-editor-first-track")).toBe("0.8fr");
  });

  it("commits a native mouse release when Chromium omits pointerup", () => {
    const f = fixture();
    f.fire("pointerdown", 500.5);
    f.fire("pointermove", 600.5);
    act(() => window.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: direction === "horizontal" ? 820.5 : 80,
      clientY: direction === "vertical" ? 830.5 : 90,
    })));
    expect(f.commit.mock.calls).toEqual([["editor-split-1", 0.8]]);
    expect(f.handle.dataset.resizing).toBeUndefined();
    expect(f.handle.hasPointerCapture(7)).toBe(false);
    expect(isNativeSurfaceLayoutStable()).toBe(true);
  });

  it("previews from the native mouse stream when pointer capture is silently lost", () => {
    const f = fixture();
    f.fire("pointerdown", 500.5);
    f.handle.hasPointerCapture = () => false;
    act(() => window.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      buttons: 1,
      clientX: direction === "horizontal" ? 820.5 : 80,
      clientY: direction === "vertical" ? 830.5 : 90,
    })));
    f.flush();
    expect(f.handle.getAttribute("aria-valuenow")).toBe("80");
    act(() => window.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: direction === "horizontal" ? 820.5 : 80,
      clientY: direction === "vertical" ? 830.5 : 90,
    })));
    expect(f.commit.mock.calls).toEqual([["editor-split-1", 0.8]]);
    expect(isNativeSurfaceLayoutStable()).toBe(true);
  });

  it("transfers a mouse resize to the window stream after lost pointer capture", () => {
    const f = fixture();
    f.fire("pointerdown", 500.5);
    f.fire("lostpointercapture", 500.5);
    expect(f.handle.dataset.resizing).toBe("true");
    act(() => window.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      buttons: 1,
      clientX: direction === "horizontal" ? 820.5 : 80,
      clientY: direction === "vertical" ? 830.5 : 90,
    })));
    f.flush();
    act(() => window.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: direction === "horizontal" ? 820.5 : 80,
      clientY: direction === "vertical" ? 830.5 : 90,
    })));
    expect(f.commit.mock.calls).toEqual([["editor-split-1", 0.8]]);
    expect(f.handle.dataset.resizing).toBeUndefined();
    expect(isNativeSurfaceLayoutStable()).toBe(true);
  });

  it("ignores another pointer's move, release, cancellation and capture loss", () => {
    const f = fixture();
    f.fire("pointerdown", 500.5);
    for (const type of ["pointermove", "pointerup", "pointercancel", "lostpointercapture"]) f.fire(type, 900.5, 99);
    expect(f.handle.dataset.resizing).toBe("true");
    expect(isNativeSurfaceLayoutStable()).toBe(false);
    expect(f.commit).not.toHaveBeenCalled();
    f.fire("pointerup", 700.5);
    expect(f.commit.mock.calls).toEqual([["editor-split-1", 0.7]]);
  });

  it("retains pointer ownership when an element inside the window loses keyboard focus", () => {
    const f = fixture();
    f.fire("pointerdown", 500.5);
    act(() => f.container.dispatchEvent(new FocusEvent("blur", { bubbles: false })));
    expect(f.handle.dataset.resizing).toBe("true");
    expect(isNativeSurfaceLayoutStable()).toBe(false);
    f.fire("pointerup", 700.5);
    expect(f.commit.mock.calls).toEqual([["editor-split-1", 0.7]]);
  });

  it("cleans up a failed pointer capture without committing a layout", () => {
    const f = fixture();
    f.handle.setPointerCapture = () => { throw new DOMException("Pointer is no longer active"); };
    f.fire("pointerdown");
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.handle.dataset.resizing).toBeUndefined();
    expect(isNativeSurfaceLayoutStable()).toBe(true);
    expect(f.publish.mock.calls).toEqual([[{ active: true }], [{ active: false }]]);
  });

  it("does not release another owner's native layout or pointer lease on cancellation", () => {
    const f = fixture();
    const other = acquireNativeSurfaceResizeLease("editor-split-resize", "another-split");
    try {
      f.fire("pointerdown");
      f.fire("pointercancel");
      expect(f.commit).not.toHaveBeenCalled();
      expect(isNativeSurfaceLayoutStable()).toBe(false);
      expect(f.publish.mock.calls).toEqual([[{ active: true }]]);
    } finally { other.release(); }
    expect(isNativeSurfaceLayoutStable()).toBe(true);
    expect(f.publish).toHaveBeenLastCalledWith({ active: false });
  });

  it.each([{ offset: -1000, ratio: 0.15 }, { offset: 5000, ratio: 0.85 }])(
    "clamps an out-of-bounds release to $ratio without leaving a live frame", ({ offset, ratio }) => {
      const f = fixture();
      f.fire("pointerdown", 500.5);
      f.fire("pointerup", offset);
      expect(f.commit.mock.calls).toEqual([["editor-split-1", ratio]]);
      expect(f.handle.getAttribute("aria-valuenow")).toBe(String(ratio * 100));
      expect(f.frames.size).toBe(0);
      expect(isNativeSurfaceLayoutStable()).toBe(true);
    },
  );

  it("routes keyboard adjustment on its own axis and equalizes the split", () => {
    const f = fixture();
    act(() => {
      f.handle.dispatchEvent(new KeyboardEvent("keydown", { key: direction === "horizontal" ? "ArrowRight" : "ArrowDown", bubbles: true }));
      f.handle.dispatchEvent(new KeyboardEvent("keydown", { key: direction === "horizontal" ? "ArrowLeft" : "ArrowUp", bubbles: true }));
      f.handle.dispatchEvent(new KeyboardEvent("keydown", { key: direction === "horizontal" ? "ArrowDown" : "ArrowRight", bubbles: true }));
      f.handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(f.commit.mock.calls).toEqual([["editor-split-1", 0.525], ["editor-split-1", 0.475], ["editor-split-1", 0.5]]);
    expect(f.handle.getAttribute("aria-orientation")).toBe(direction === "horizontal" ? "vertical" : "horizontal");
    expect(f.publish).not.toHaveBeenCalled();
  });
});
