import { useLayoutEffect, useRef } from "react";
import { acquireNativeSurfaceLayoutLease } from "./nativeSurfaceGeometry";

/** Suspends only this subtree across a CSS clip/transform transition; releases only
 * after its final layout frame. The timeout is a cancellation fail-safe. */
export function useNativeSurfaceLayoutTransition(
  owner: string,
  element: HTMLElement | null,
  changeKey: unknown,
  durationMs: number,
  properties: ReadonlySet<string>,
  enabled = true,
): void {
  const previousKeyRef = useRef(changeKey);
  useLayoutEffect(() => {
    if (!element) return undefined;
    if (Object.is(previousKeyRef.current, changeKey)) return undefined;
    previousKeyRef.current = changeKey;
    if (!enabled) return undefined;
    const lease = acquireNativeSurfaceLayoutLease(owner, { suspendWithin: element });
    const active = new Set<string>();
    let released = false;
    let settleFrame: number | null = null;
    let finalFrame: number | null = null;
    let timeoutId: number | null = null;

    const release = () => {
      if (released) return;
      released = true;
      lease.release();
    };
    const settle = () => {
      if (active.size > 0 || released || settleFrame !== null) return;
      settleFrame = window.requestAnimationFrame(() => {
        settleFrame = null;
        finalFrame = window.requestAnimationFrame(release);
      });
    };
    const handleRun = (event: TransitionEvent) => {
      if (event.target !== element || !properties.has(event.propertyName)) return;
      active.add(event.propertyName);
    };
    const handleEnd = (event: TransitionEvent) => {
      if (event.target !== element || !properties.has(event.propertyName)) return;
      active.delete(event.propertyName);
      settle();
    };

    element.addEventListener("transitionrun", handleRun);
    element.addEventListener("transitionend", handleEnd);
    element.addEventListener("transitioncancel", handleEnd);
    // Keep the child suspended for the declared layout interval even when
    // Chromium coalesces transitionrun/end events. The timeout converges
    // through the same two-frame final reconciliation as a real transition.
    timeoutId = window.setTimeout(() => {
      active.clear(); // A missing transitionend must never strand a lease.
      settle();
    }, Math.max(0, durationMs) + 50);

    return () => {
      element.removeEventListener("transitionrun", handleRun);
      element.removeEventListener("transitionend", handleEnd);
      element.removeEventListener("transitioncancel", handleEnd);
      if (settleFrame !== null) window.cancelAnimationFrame(settleFrame);
      if (finalFrame !== null) window.cancelAnimationFrame(finalFrame);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      release();
    };
  }, [changeKey, durationMs, element, enabled, owner, properties]);
}
