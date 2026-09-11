import { useLayoutEffect, useRef } from "react";
import {
  isNativeSurfaceElementVisible,
  measureNativeSurfaceBounds,
  subscribeNativeSurfaceLayoutFrames,
  type NativeSurfaceGeometry,
} from "./nativeSurfaceGeometry";

/**
 * Measures a renderer-owned native slot; the persistent host owns IPC ordering.
 * Resize/scroll updates are frame-coalesced. The shared layout clock also
 * samples position-only changes without coupling resizing to visibility.
 */
export function useNativeSurfaceGeometry(
  element: HTMLElement | null,
  onGeometry: (geometry: NativeSurfaceGeometry) => void,
  layoutRevision?: unknown,
): void {
  const callbackRef = useRef(onGeometry);
  callbackRef.current = onGeometry;

  useLayoutEffect(() => {
    if (!element) return undefined;
    let revision = 0;
    let frameId: number | null = null;
    let lastSignature = "";

    const measure = () => {
      frameId = null;
      const bounds = measureNativeSurfaceBounds(element);
      const visible = isNativeSurfaceElementVisible(element, bounds);
      const signature = JSON.stringify([bounds.x, bounds.y, bounds.width, bounds.height, visible]);
      if (signature !== lastSignature) {
        lastSignature = signature;
        revision += 1;
        callbackRef.current(Object.freeze({ bounds, revision, visible }));
      }
    };
    const schedule = () => {
      if (frameId === null) frameId = window.requestAnimationFrame(measure);
    };

    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(schedule)
      : null;
    const mutationObserver = typeof MutationObserver === "function"
      ? new MutationObserver(schedule)
      : null;
    // Direction/theme/ancestor visibility can move a slot without resizing it.
    for (let current: HTMLElement | null = element; current; current = current.parentElement) {
      resizeObserver?.observe(current);
      mutationObserver?.observe(current, { attributes: true });
    }

    const releaseActivitySubscription = subscribeNativeSurfaceLayoutFrames(() => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      measure();
    });
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    document.addEventListener("visibilitychange", schedule, true);
    measure();

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      releaseActivitySubscription();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      document.removeEventListener("visibilitychange", schedule, true);
    };
  }, [element, layoutRevision]);
}
