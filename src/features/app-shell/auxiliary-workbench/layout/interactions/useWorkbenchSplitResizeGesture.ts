import { useCallback, useRef, type PointerEvent } from "react";
import {
  acquireNativeSurfaceResizeLease,
  createNativeSurfacePointerSessionId,
  type NativeSurfacePointerPassthroughLease,
} from "../../../../native-surfaces";
import {
  useInteractionTermination,
  type InteractionTerminationReason,
} from "../../../../workbench-interactions/useInteractionTermination";
import {
  clampWorkbenchRatioToBounds,
  workbenchSplitRatioBounds,
  type WorkbenchSplitMinimumSize,
  type WorkbenchSplitRatioBounds,
} from "../workbenchSplitConstraints";
import type { AuxiliaryWorkbenchLayoutSplit } from "@puppyone/shared-ui";

type ResizeSession = {
  bounds: WorkbenchSplitRatioBounds;
  committedRatio: number;
  container: HTMLElement;
  direction: AuxiliaryWorkbenchLayoutSplit["direction"];
  frameId: number | null;
  handle: HTMLElement;
  nativeLease: NativeSurfacePointerPassthroughLease;
  onCommit: WorkbenchSplitResizeGestureOptions["onCommit"];
  pointerId: number;
  previewRatio: number;
  splitId: string;
};

export type WorkbenchSplitResizeGestureOptions = Readonly<{
  direction: AuxiliaryWorkbenchLayoutSplit["direction"];
  firstMinimum: WorkbenchSplitMinimumSize;
  secondMinimum: WorkbenchSplitMinimumSize;
  ratio: number;
  splitId: string;
  onCommit: (splitId: string, ratio: number) => void;
}>;

/** Previews high-frequency separator geometry in CSS and commits once. */
export function useWorkbenchSplitResizeGesture({
  direction,
  firstMinimum,
  secondMinimum,
  ratio,
  splitId,
  onCommit,
}: WorkbenchSplitResizeGestureOptions) {
  const sessionRef = useRef<ResizeSession | null>(null);

  const applyPreview = useCallback((session: ResizeSession, nextRatio: number) => {
    const value = clampWorkbenchRatioToBounds(nextRatio, session.bounds);
    session.previewRatio = value;
    session.container.style.setProperty("--desktop-terminal-first-track", `${value}fr`);
    session.container.style.setProperty("--desktop-terminal-second-track", `${1 - value}fr`);
    session.handle.setAttribute("aria-valuenow", String(Math.round(value * 100)));
  }, []);

  const flushPreview = useCallback((session: ResizeSession) => {
    if (session.frameId === null) return;
    session.handle.ownerDocument.defaultView?.cancelAnimationFrame(session.frameId);
    session.frameId = null;
    applyPreview(session, session.previewRatio);
  }, [applyPreview]);

  const finish = useCallback((mode: "commit" | "cancel") => {
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
      // The browser may have released capture before lifecycle cleanup.
    }
    if (mode === "cancel") {
      session.previewRatio = session.committedRatio;
      session.container.style.setProperty(
        "--desktop-terminal-first-track",
        `${session.committedRatio}fr`,
      );
      session.container.style.setProperty(
        "--desktop-terminal-second-track",
        `${1 - session.committedRatio}fr`,
      );
      session.handle.setAttribute(
        "aria-valuenow",
        String(Math.round(session.committedRatio * 100)),
      );
      return true;
    }
    if (session.previewRatio !== session.committedRatio) {
      session.onCommit(session.splitId, session.previewRatio);
    }
    return true;
  }, [flushPreview]);

  const finishFromLifecycle = useCallback((
    _reason: InteractionTerminationReason,
  ) => finish("cancel"), [finish]);
  useInteractionTermination({ finish: finishFromLifecycle });

  const previewFromPointer = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const containerRect = session.container.getBoundingClientRect();
    const dividerRect = session.handle.getBoundingClientRect();
    const total = session.direction === "horizontal" ? containerRect.width : containerRect.height;
    const dividerSize = session.direction === "horizontal" ? dividerRect.width : dividerRect.height;
    const offset = session.direction === "horizontal"
      ? event.clientX - containerRect.left
      : event.clientY - containerRect.top;
    session.previewRatio = clampWorkbenchRatioToBounds(
      (offset - dividerSize / 2) / Math.max(1, total - dividerSize),
      session.bounds,
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

  const start = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    finish("cancel");
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const bounds = measureWorkbenchSplitRatioBounds(
      event.currentTarget,
      direction,
      firstMinimum,
      secondMinimum,
    );
    const committedRatio = Number.isFinite(ratio)
      ? Math.min(0.99, Math.max(0.01, ratio))
      : 0.5;
    const id = createNativeSurfacePointerSessionId("terminal-split-resize");
    sessionRef.current = {
      bounds,
      committedRatio,
      container,
      direction,
      frameId: null,
      handle: event.currentTarget,
      nativeLease: acquireNativeSurfaceResizeLease("terminal-split-resize", id),
      onCommit,
      pointerId: event.pointerId,
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
  }, [direction, finish, firstMinimum, onCommit, previewFromPointer, ratio, secondMinimum, splitId]);

  const move = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) previewFromPointer(event);
  }, [previewFromPointer]);

  const end = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    previewFromPointer(event);
    finish("commit");
  }, [finish, previewFromPointer]);

  const cancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    finish("cancel");
  }, [finish]);

  const lostCapture = useCallback(() => finish("cancel"), [finish]);
  return { start, move, end, cancel, lostCapture } as const;
}

export function measureWorkbenchSplitRatioBounds(
  handle: HTMLElement,
  direction: AuxiliaryWorkbenchLayoutSplit["direction"],
  firstMinimum: WorkbenchSplitMinimumSize,
  secondMinimum: WorkbenchSplitMinimumSize,
): WorkbenchSplitRatioBounds {
  const container = handle.parentElement;
  if (!container) return Object.freeze({ minimum: 0.01, maximum: 0.99 });
  const containerRect = container.getBoundingClientRect();
  const dividerRect = handle.getBoundingClientRect();
  return workbenchSplitRatioBounds(
    direction,
    direction === "horizontal" ? containerRect.width : containerRect.height,
    direction === "horizontal" ? dividerRect.width : dividerRect.height,
    firstMinimum,
    secondMinimum,
  );
}
