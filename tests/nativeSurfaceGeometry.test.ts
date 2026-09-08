/**
 * @vitest-environment happy-dom
 */
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireNativeSurfaceLayoutLease,
  isNativeSurfaceElementVisible,
  isNativeSurfaceLayoutStable,
  measureNativeSurfaceBounds,
  subscribeNativeSurfaceLayoutActivity,
} from "../src/features/native-surfaces/nativeSurfaceGeometry";
import { useNativeSurfaceGeometry } from "../src/features/native-surfaces/useNativeSurfaceGeometry";
import { useNativeSurfaceLayoutTransition } from "../src/features/native-surfaces/useNativeSurfaceLayoutTransition";

let root: Root | null = null;
const WIDTH_TRANSITION_PROPERTIES = new Set(["width"]);

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("native surface geometry authority", () => {
  it("publishes layout lease transitions and releases idempotently", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNativeSurfaceLayoutActivity(listener);
    const first = acquireNativeSurfaceLayoutLease("sidebar");
    const second = acquireNativeSurfaceLayoutLease("split");

    expect(isNativeSurfaceLayoutStable()).toBe(false);
    first.release();
    first.release();
    expect(isNativeSurfaceLayoutStable()).toBe(false);
    second.release();
    expect(isNativeSurfaceLayoutStable()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it("clips measured bounds to the owner viewport and rejects offscreen visibility", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1_000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(700);
    const element = document.createElement("div");
    document.body.append(element);
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      x: 850,
      y: 30,
      left: 850,
      top: 30,
      right: 1_100,
      bottom: 730,
      width: 250,
      height: 700,
      toJSON: () => ({}),
    });

    expect(measureNativeSurfaceBounds(element)).toEqual({
      x: 850,
      y: 30,
      width: 150,
      height: 670,
    });
    expect(isNativeSurfaceElementVisible(element)).toBe(true);

    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      x: 1_010,
      y: 30,
      left: 1_010,
      top: 30,
      right: 1_110,
      bottom: 130,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });
    expect(isNativeSurfaceElementVisible(element)).toBe(false);
  });

  it("publishes a hidden revision while layout is unstable and a final visible revision", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1_000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(700);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 30,
      left: 20,
      top: 30,
      right: 820,
      bottom: 630,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    });
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const geometries: Array<{ revision: number; visible: boolean }> = [];

    function Harness() {
      const [element, setElement] = useState<HTMLDivElement | null>(null);
      useNativeSurfaceGeometry(element, (geometry) => geometries.push(geometry));
      return React.createElement("div", { ref: setElement });
    }

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(React.createElement(Harness)));
    expect(geometries.at(-1)).toMatchObject({ revision: 1, visible: true });

    const lease = acquireNativeSurfaceLayoutLease("sidebar");
    act(() => flushAnimationFrames(frames));
    expect(geometries.at(-1)).toMatchObject({ revision: 2, visible: false });

    lease.release();
    act(() => flushAnimationFrames(frames));
    expect(geometries.at(-1)).toMatchObject({ revision: 3, visible: true });
  });

  it("holds a sidebar transition lease until the final reconciliation frame", () => {
    vi.useFakeTimers();
    try {
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
      let setOpen: ((open: boolean) => void) | null = null;

      function Harness() {
        const [element, setElement] = useState<HTMLElement | null>(null);
        const [open, updateOpen] = useState(true);
        setOpen = updateOpen;
        useNativeSurfaceLayoutTransition(
          "right-sidebar",
          element,
          open,
          260,
          WIDTH_TRANSITION_PROPERTIES,
        );
        return React.createElement("aside", { ref: setElement });
      }

      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      act(() => root?.render(React.createElement(Harness)));
      expect(isNativeSurfaceLayoutStable()).toBe(true);

      act(() => setOpen?.(false));
      expect(isNativeSurfaceLayoutStable()).toBe(false);
      act(() => flushAnimationFrames(frames));
      expect(isNativeSurfaceLayoutStable()).toBe(false);

      act(() => vi.advanceTimersByTime(311));
      act(() => flushAnimationFrames(frames));
      expect(isNativeSurfaceLayoutStable()).toBe(false);
      act(() => flushAnimationFrames(frames));
      expect(isNativeSurfaceLayoutStable()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

function flushAnimationFrames(frames: FrameRequestCallback[]) {
  const pending = frames.splice(0, frames.length);
  for (const callback of pending) callback(performance.now());
}
