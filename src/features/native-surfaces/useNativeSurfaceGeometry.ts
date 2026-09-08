import { useLayoutEffect, useRef } from "react";
import {
  isNativeSurfaceElementVisible,
  isNativeSurfaceLayoutStable,
  measureNativeSurfaceBounds,
  subscribeNativeSurfaceLayoutActivity,
  type NativeSurfaceGeometry,
} from "./nativeSurfaceGeometry";

/**
 * Publishes one monotonic geometry stream for a renderer-owned native slot.
 * Resize/scroll updates are frame-coalesced. While shell layout is unstable,
 * the stream remains current but asks main to keep the native child hidden.
 */
export function useNativeSurfaceGeometry(
  element: HTMLElement | null,
  onGeometry: (geometry: NativeSurfaceGeometry) => void,
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
      const stable = isNativeSurfaceLayoutStable();
      const visible = stable && isNativeSurfaceElementVisible(element);
      const signature = JSON.stringify([bounds.x, bounds.y, bounds.width, bounds.height, visible]);
      if (signature !== lastSignature) {
        lastSignature = signature;
        revision += 1;
        callbackRef.current(Object.freeze({ bounds, revision, visible }));
      }
      if (!stable) frameId = window.requestAnimationFrame(measure);
    };
    const schedule = () => {
      if (frameId === null) frameId = window.requestAnimationFrame(measure);
    };

    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(schedule)
      : null;
    resizeObserver?.observe(element);
    const layoutRoot = element.closest<HTMLElement>(".desktop-shell-body");
    if (layoutRoot && layoutRoot !== element) resizeObserver?.observe(layoutRoot);

    const releaseActivitySubscription = subscribeNativeSurfaceLayoutActivity(schedule);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    document.addEventListener("visibilitychange", schedule, true);
    measure();

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      releaseActivitySubscription();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      document.removeEventListener("visibilitychange", schedule, true);
    };
  }, [element]);
}
