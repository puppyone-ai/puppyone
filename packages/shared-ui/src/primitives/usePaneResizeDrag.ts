import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

export type PaneResizeDragPoint = {
  clientX: number;
  clientY: number;
};

export type PaneResizeDragSession = {
  onMove: (point: PaneResizeDragPoint) => void;
  onEnd?: () => void;
  /** Roll back a preview when the gesture is interrupted. */
  onCancel?: () => void;
};

export type UsePaneResizeDragOptions = {
  enabled?: boolean;
  bodyClassName: string;
  onDragActiveChange?: (active: boolean) => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => PaneResizeDragSession | null | undefined;
};

export function usePaneResizeDrag({
  enabled = true,
  bodyClassName,
  onDragActiveChange,
  onDragStart,
}: UsePaneResizeDragOptions) {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) cleanupRef.current?.();
    return () => { cleanupRef.current?.(); cleanupRef.current = null; };
  }, [enabled]);

  return useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0) return;

    cleanupRef.current?.();
    cleanupRef.current = null;

    const session = onDragStart(event);
    if (!session) return;

    event.preventDefault();
    event.stopPropagation();

    const pointerId = event.pointerId;
    const handle = event.currentTarget;
    let active = true;
    let frameId: number | null = null;
    let latestPoint: PaneResizeDragPoint | null = null;

    const flushMove = () => {
      if (!latestPoint) return;
      const point = latestPoint;
      latestPoint = null;
      session.onMove(point);
    };

    const cancelScheduledMove = () => {
      if (frameId === null) return;
      window.cancelAnimationFrame(frameId);
      frameId = null;
    };

    const scheduleMove = (pointerEvent: PointerEvent) => {
      latestPoint = {
        clientX: pointerEvent.clientX,
        clientY: pointerEvent.clientY,
      };
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        flushMove();
      });
    };

    const stop = (commit: boolean) => {
      if (!active) return;
      active = false;
      cancelScheduledMove();
      if (commit) flushMove();
      latestPoint = null;

      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("blur", cancel, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange, true);
      handle.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("pagehide", cancel, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      document.body.classList.remove(bodyClassName);
      onDragActiveChange?.(false);

      try {
        if (handle.hasPointerCapture?.(pointerId)) {
          handle.releasePointerCapture(pointerId);
        }
      } catch {
        // Pointer capture may already be released by the browser.
      }

      if (commit) session.onEnd?.();
      else (session.onCancel ?? session.onEnd)?.();
      if (cleanupRef.current === cancel) cleanupRef.current = null;
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      scheduleMove(pointerEvent);
    };

    const handlePointerEnd = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      pointerEvent.preventDefault();
      scheduleMove(pointerEvent);
      stop(true);
    };
    const cancel = () => stop(false);
    const handlePointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === pointerId) cancel();
    };
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      cancel();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") cancel();
    };

    document.body.classList.add(bodyClassName);
    onDragActiveChange?.(true);

    try {
      handle.setPointerCapture?.(pointerId);
    } catch {
      // Older or interrupted pointer sessions may not allow capture.
    }

    handle.addEventListener("lostpointercapture", cancel);
    window.addEventListener("pagehide", cancel, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerEnd, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("blur", cancel, true);
    document.addEventListener("visibilitychange", handleVisibilityChange, true);

    cleanupRef.current = cancel;
  }, [bodyClassName, enabled, onDragActiveChange, onDragStart]);
}
