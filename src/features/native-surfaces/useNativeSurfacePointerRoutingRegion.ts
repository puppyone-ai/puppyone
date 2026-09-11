import { useLayoutEffect } from "react";
import { subscribeNativeSurfaceLayoutFrames } from "./nativeSurfaceGeometry";
import type { NativeSurfacePointerPassthroughOwner } from "./nativeSurfacePointerPassthrough";
import { acquireNativeSurfacePointerRoutingRegion } from "./nativeSurfacePointerRoutingRegions";

/** Keeps one overlay sash's viewport rectangle registered with the native host. */
export function useNativeSurfacePointerRoutingRegion(
  owner: NativeSurfacePointerPassthroughOwner,
  element: HTMLElement | null,
): void {
  useLayoutEffect(() => {
    if (!element) return undefined;
    const lease = acquireNativeSurfacePointerRoutingRegion(owner);
    const layoutRoot = element.parentElement;
    let frameId: number | null = null;
    let transitionDepth = 0;

    const measure = () => {
      frameId = null;
      const rect = element.getBoundingClientRect();
      const left = Math.max(0, Math.floor(rect.left));
      const top = Math.max(0, Math.floor(rect.top));
      const right = Math.min(window.innerWidth, Math.ceil(rect.right));
      const bottom = Math.min(window.innerHeight, Math.ceil(rect.bottom));
      if (right <= left || bottom <= top) {
        lease.update(null);
      } else {
        lease.update({ x: left, y: top, width: right - left, height: bottom - top });
      }
      if (transitionDepth > 0) frameId = window.requestAnimationFrame(measure);
    };

    const scheduleMeasure = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(measure);
    };
    const isLayoutTransition = (event: TransitionEvent) => (
      event.target === layoutRoot && event.propertyName === "grid-template-columns"
    );
    const handleTransitionRun = (event: TransitionEvent) => {
      if (!isLayoutTransition(event)) return;
      transitionDepth += 1;
      scheduleMeasure();
    };
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (!isLayoutTransition(event)) return;
      transitionDepth = Math.max(0, transitionDepth - 1);
      scheduleMeasure();
    };

    const unsubscribeFrames = subscribeNativeSurfaceLayoutFrames(() => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      measure();
    });
    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(scheduleMeasure)
      : null;
    const mutationObserver = typeof MutationObserver === "function"
      ? new MutationObserver(scheduleMeasure)
      : null;
    for (let current: HTMLElement | null = element; current; current = current.parentElement) {
      resizeObserver?.observe(current);
      mutationObserver?.observe(current, { attributes: true });
    }

    layoutRoot?.addEventListener("transitionrun", handleTransitionRun);
    layoutRoot?.addEventListener("transitionend", handleTransitionEnd);
    layoutRoot?.addEventListener("transitioncancel", handleTransitionEnd);
    window.addEventListener("resize", scheduleMeasure);
    document.addEventListener("scroll", scheduleMeasure, true);
    measure();

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      unsubscribeFrames();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      layoutRoot?.removeEventListener("transitionrun", handleTransitionRun);
      layoutRoot?.removeEventListener("transitionend", handleTransitionEnd);
      layoutRoot?.removeEventListener("transitioncancel", handleTransitionEnd);
      window.removeEventListener("resize", scheduleMeasure);
      document.removeEventListener("scroll", scheduleMeasure, true);
      lease.release();
    };
  }, [element, owner]);
}
