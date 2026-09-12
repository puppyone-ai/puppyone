/** @vitest-environment happy-dom */
import { createElement, useEffect } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireNativeSurfacePointerRoutingRegion,
  acquireNativeSurfacePointerPassthroughLease,
  useNativeSurfacePointerPassthroughActivity,
} from "../../../../src/features/native-surfaces";

const originalBridgeDescriptor = Object.getOwnPropertyDescriptor(window, "puppyoneDesktop");

afterEach(() => {
  if (originalBridgeDescriptor) {
    Object.defineProperty(window, "puppyoneDesktop", originalBridgeDescriptor);
  } else {
    Reflect.deleteProperty(window, "puppyoneDesktop");
  }
  vi.restoreAllMocks();
});

describe("native surface pointer passthrough leases", () => {
  it("publishes owner viewport rectangles independently from active gestures", () => {
    const publishRegions = vi.fn();
    Object.defineProperty(window, "puppyoneDesktop", {
      configurable: true,
      value: { setNativeSurfacePointerRoutingRegions: publishRegions },
    });
    const region = acquireNativeSurfacePointerRoutingRegion("explorer-resize");

    region.update({ x: 320.2, y: 38.4, width: 7.7, height: 700.1 });
    expect(publishRegions).toHaveBeenLastCalledWith({
      regions: [{ id: region.id, x: 320, y: 38, width: 8, height: 700 }],
    });
    region.release();
    expect(publishRegions).toHaveBeenLastCalledWith({ regions: [] });
  });

  it("publishes only aggregate boundary transitions for overlapping owners", () => {
    const publish = installDesktopBridge();
    const first = acquireNativeSurfacePointerPassthroughLease("explorer-file-drop", "drag-1");
    const second = acquireNativeSurfacePointerPassthroughLease("editor-split-resize", "resize-1");

    expect(publish.mock.calls).toEqual([[{ active: true }]]);
    first.release();
    first.release();
    expect(publish.mock.calls).toEqual([[{ active: true }]]);

    second.release();
    expect(publish.mock.calls).toEqual([[{ active: true }], [{ active: false }]]);
  });

  it("does not let a stale release terminate a newer session", () => {
    const publish = installDesktopBridge();
    const stale = acquireNativeSurfacePointerPassthroughLease("editor-pane-move", "move-old");
    stale.release();
    const current = acquireNativeSurfacePointerPassthroughLease("editor-pane-move", "move-new");

    stale.release();
    expect(publish.mock.calls.at(-1)).toEqual([{ active: true }]);
    current.release();
    expect(publish.mock.calls.at(-1)).toEqual([{ active: false }]);
  });

  it("releases a component-owned activity lease at lifecycle boundaries", () => {
    const publish = installDesktopBridge();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Harness() {
      const setActive = useNativeSurfacePointerPassthroughActivity("explorer-resize");
      useEffect(() => {
        setActive(true);
      }, [setActive]);
      return null;
    }

    act(() => root.render(createElement(Harness)));
    expect(publish.mock.calls.at(-1)).toEqual([{ active: true }]);
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(publish.mock.calls.at(-1)).toEqual([{ active: false }]);
    act(() => root.unmount());
    container.remove();
  });
});

function installDesktopBridge() {
  const publish = vi.fn();
  Object.defineProperty(window, "puppyoneDesktop", {
    configurable: true,
    value: { setNativeSurfacePointerPassthrough: publish },
  });
  return publish;
}
