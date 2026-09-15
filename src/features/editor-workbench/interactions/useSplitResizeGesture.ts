import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import {
  clampEditorSplitRatio,
  type EditorSplitDirection,
} from "@puppyone/shared-ui";
import {
  acquireNativeSurfaceResizeLease,
  createNativeSurfacePointerSessionId,
  type NativeSurfacePointerPassthroughLease,
} from "../../native-surfaces";
import {
  useInteractionTermination,
  type InteractionTerminationReason,
} from "./useInteractionTermination";

type ResizeSession = {
  committedRatio: number;
  container: HTMLElement;
  direction: EditorSplitDirection;
  frameId: number | null;
  handle: HTMLElement;
  id: string;
  nativeLease: NativeSurfacePointerPassthroughLease;
  onCommit: SplitResizeGestureOptions["onCommit"];
  pointerId: number;
  pointerType: string;
  previewRatio: number;
  splitId: string;
};

export type SplitResizeGestureOptions = Readonly<{
  direction: EditorSplitDirection;
  ratio: number;
  splitId: string;
  onCommit: (splitId: string, ratio: number) => void;
}>;

/** Keeps high-frequency pointer preview outside React state. The durable split
 * tree receives exactly one ratio when the gesture completes. */
export function useSplitResizeGesture({
  direction,
  ratio,
  splitId,
  onCommit,
}: SplitResizeGestureOptions) {
  const sessionRef = useRef<ResizeSession | null>(null);

  const applyPreview = useCallback((session: ResizeSession, nextRatio: number) => {
    const value = clampEditorSplitRatio(nextRatio);
    session.previewRatio = value;
    session.container.style.setProperty("--desktop-editor-first-track", `${value}fr`);
    session.container.style.setProperty("--desktop-editor-second-track", `${1 - value}fr`);
    session.handle.setAttribute("aria-valuenow", String(Math.round(value * 100)));
  }, []);

  const flushPreview = useCallback((session: ResizeSession) => {
    if (session.frameId === null) return;
    session.handle.ownerDocument.defaultView?.cancelAnimationFrame(session.frameId);
    session.frameId = null;
    applyPreview(session, session.previewRatio);
  }, [applyPreview]);

  const finish = useCallback((mode: "commit" | "cancel"): boolean => {
    const session = sessionRef.current;
    if (!session) return false;
    flushPreview(session);
    sessionRef.current = null;
    delete session.handle.dataset.resizing;
    session.nativeLease.release();
    try {
      if (session.handle.hasPointerCapture(session.pointerId)) {
        session.handle.releasePointerCapture(session.pointerId);
      }
    } catch {
      // Pointer capture may already have been released by the browser.
    }
    if (mode === "cancel") {
      applyPreview(session, session.committedRatio);
      return true;
    }
    if (session.previewRatio !== session.committedRatio) {
      session.onCommit(session.splitId, session.previewRatio);
    }
    return true;
  }, [applyPreview, flushPreview]);

  const finishFromLifecycle = useCallback((
    _reason: InteractionTerminationReason,
  ) => finish("cancel"), [finish]);

  useInteractionTermination({ finish: finishFromLifecycle });

  const previewFromPoint = useCallback((
    session: ResizeSession,
    point: Readonly<{ clientX: number; clientY: number }>,
  ) => {
    const containerRect = session.container.getBoundingClientRect();
    const dividerRect = session.handle.getBoundingClientRect();
    const total = session.direction === "horizontal" ? containerRect.width : containerRect.height;
    const dividerSize = session.direction === "horizontal" ? dividerRect.width : dividerRect.height;
    const offset = session.direction === "horizontal"
      ? point.clientX - containerRect.left
      : point.clientY - containerRect.top;
    session.previewRatio = clampEditorSplitRatio(
      (offset - dividerSize / 2) / Math.max(1, total - dividerSize),
    );
    if (session.frameId !== null) return;
    const ownerWindow = session.handle.ownerDocument.defaultView;
    if (!ownerWindow) {
      applyPreview(session, session.previewRatio);
      return;
    }
    session.frameId = ownerWindow.requestAnimationFrame(() => {
      session.frameId = null;
      if (sessionRef.current === session) applyPreview(session, session.previewRatio);
    });
  }, [applyPreview]);

  const previewFromPointer = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    previewFromPoint(session, event);
  }, [previewFromPoint]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerType !== "mouse" || (event.buttons & 1) === 0) return;
      // Pointer capture can be declined silently after an embedded native
      // surface handled a previous gesture. Preserve the active owner session
      // from the lower-level mouse stream without creating a second session.
      previewFromPoint(session, event);
    };
    const handleMouseRelease = (event: MouseEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerType !== "mouse" || event.button !== 0) return;
      // Electron's native child forwarding can deliver the terminal mouseup
      // without Chromium synthesizing the matching pointerup. Finish the same
      // owner session from that lower-level release so its lease cannot stick.
      previewFromPoint(session, event);
      finish("commit");
    };
    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseRelease, true);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseRelease, true);
    };
  }, [finish, previewFromPoint]);

  const start = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    finish("cancel");
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const committedRatio = clampEditorSplitRatio(ratio);
    const id = createNativeSurfacePointerSessionId("editor-split-resize");
    sessionRef.current = {
      committedRatio,
      container,
      direction,
      frameId: null,
      handle: event.currentTarget,
      id,
      nativeLease: acquireNativeSurfaceResizeLease("editor-split-resize", id),
      onCommit,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      previewRatio: committedRatio,
      splitId,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      finish("cancel");
      return;
    }
    event.currentTarget.dataset.resizing = "true";
    previewFromPointer(event);
  }, [direction, finish, onCommit, previewFromPointer, ratio, splitId]);

  const move = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) previewFromPointer(event);
  }, [previewFromPointer]);

  const end = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    previewFromPointer(event);
    finish("commit");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [finish, previewFromPointer]);

  const cancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    finish("cancel");
  }, [finish]);

  return { start, move, end, cancel, lostCapture: cancel } as const;
}
