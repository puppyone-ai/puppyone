import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  type WorkbenchSplitDropEdge,
} from "@puppyone/shared-ui";
import {
  acquireNativeSurfacePointerPassthroughLease,
  createNativeSurfacePointerSessionId,
  type NativeSurfacePointerPassthroughLease,
} from "../../../../native-surfaces";
import {
  useInteractionTermination,
  type InteractionTerminationReason,
} from "../../../../workbench-interactions/useInteractionTermination";
import {
  sameWorkbenchTabMoveDropIntent,
  type WorkbenchTabMoveDropIntent,
} from "../workbenchTabMove";
import {
  createWorkbenchTabMovePreview,
  destroyWorkbenchTabMovePreview,
  moveWorkbenchTabMovePreview,
} from "./workbenchTabMovePreview";
import { resolveWorkbenchTabBarDropTarget } from "./workbenchTabBarDropTarget";
import { resolveWorkbenchContentDropTarget } from "./workbenchContentDropTarget";

export type WorkbenchTabMoveGestureResult = "press" | "drag" | "ignored";
export type WorkbenchDragSubject =
  | Readonly<{ kind: "tab"; sessionId: string }>
  | Readonly<{ kind: "group"; groupId: string; sessionIds: readonly string[] }>;

export type WorkbenchTabMoveAdmission = (
  sourceSessionId: string,
  targetGroupId: string,
  edge: WorkbenchSplitDropEdge,
  targetGroupContent: HTMLElement,
) => boolean;

export type WorkbenchTabInsertAdmission = (
  sourceSessionId: string,
  targetGroupId: string,
  targetIndex: number,
  targetTabBar: HTMLElement,
) => boolean;

export type WorkbenchGroupMoveAdmission = (
  sourceGroupId: string,
  targetGroupId: string,
  edge: WorkbenchSplitDropEdge,
  targetGroupContent: HTMLElement,
) => boolean;

export type WorkbenchGroupMergeAdmission = (
  sourceGroupId: string,
  targetGroupId: string,
  targetIndex: number,
  targetTabBar: HTMLElement,
) => boolean;

export type WorkbenchTabMoveDragController = Readonly<{
  dragging: boolean;
  dropIntent: WorkbenchTabMoveDropIntent | null;
  start: (
    event: ReactPointerEvent<HTMLButtonElement>,
    subject: WorkbenchDragSubject,
    label: string,
  ) => void;
  move: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  end: (event: ReactPointerEvent<HTMLButtonElement>) => WorkbenchTabMoveGestureResult;
  cancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  lostCapture: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}>;

type WorkbenchPointerGestureEvent = Pick<
  globalThis.PointerEvent,
  "clientX" | "clientY" | "pointerId" | "preventDefault"
>;

type WorkbenchTabMoveSession = {
  dragging: boolean;
  handle: HTMLButtonElement;
  id: string;
  label: string;
  nativeLease: NativeSurfacePointerPassthroughLease | null;
  onInsertSession: UseWorkbenchTabMoveDragOptions["onInsertSession"];
  onMergeGroup: UseWorkbenchTabMoveDragOptions["onMergeGroup"];
  onMoveGroup: UseWorkbenchTabMoveDragOptions["onMoveGroup"];
  onMoveSession: UseWorkbenchTabMoveDragOptions["onMoveSession"];
  originX: number;
  originY: number;
  pointerId: number;
  preview: HTMLElement | null;
  sourceElement: HTMLElement | null;
  subject: WorkbenchDragSubject;
  thresholdPx: number;
};

type FinishReason = InteractionTerminationReason
  | "lostpointercapture"
  | "pointercancel"
  | "pointerup"
  | "restart";

type UseWorkbenchTabMoveDragOptions = Readonly<{
  canDrop: WorkbenchTabMoveAdmission;
  canInsert: WorkbenchTabInsertAdmission;
  canMergeGroup: WorkbenchGroupMergeAdmission;
  canMoveGroup: WorkbenchGroupMoveAdmission;
  onInsertSession: (
    sourceSessionId: string,
    targetGroupId: string,
    targetIndex: number,
  ) => void;
  onMergeGroup: (
    sourceGroupId: string,
    targetGroupId: string,
    targetIndex: number,
  ) => void;
  onMoveSession: (
    sourceSessionId: string,
    targetGroupId: string,
    edge: WorkbenchSplitDropEdge,
  ) => void;
  onMoveGroup: (
    sourceGroupId: string,
    targetGroupId: string,
    edge: WorkbenchSplitDropEdge,
  ) => void;
}>;

const WORKBENCH_TAB_MOVE_THRESHOLD_PX = 6;
const WORKBENCH_GROUP_HANDLE_MOVE_THRESHOLD_PX = 3;
const WORKBENCH_TRANSIENT_WINDOW_BLUR_GRACE_MS = 48;

export function useWorkbenchTabMoveDrag({
  canDrop,
  canInsert,
  canMergeGroup,
  canMoveGroup,
  onInsertSession,
  onMergeGroup,
  onMoveGroup,
  onMoveSession,
}: UseWorkbenchTabMoveDragOptions): WorkbenchTabMoveDragController {
  const [dragging, setDragging] = useState(false);
  const [dropIntent, setDropIntent] = useState<WorkbenchTabMoveDropIntent | null>(null);
  const sessionRef = useRef<WorkbenchTabMoveSession | null>(null);
  const dropIntentRef = useRef<WorkbenchTabMoveDropIntent | null>(null);
  const canDropRef = useRef(canDrop);
  canDropRef.current = canDrop;
  const canInsertRef = useRef(canInsert);
  canInsertRef.current = canInsert;
  const canMergeGroupRef = useRef(canMergeGroup);
  canMergeGroupRef.current = canMergeGroup;
  const canMoveGroupRef = useRef(canMoveGroup);
  canMoveGroupRef.current = canMoveGroup;

  const publishDropIntent = useCallback((intent: WorkbenchTabMoveDropIntent | null) => {
    if (sameWorkbenchTabMoveDropIntent(dropIntentRef.current, intent)) return;
    dropIntentRef.current = intent;
    setDropIntent(intent);
  }, []);

  const finish = useCallback((reason: FinishReason, expectedSessionId?: string) => {
    const session = sessionRef.current;
    if (!session || (expectedSessionId && session.id !== expectedSessionId)) return false;
    sessionRef.current = null;
    if (reason !== "unmount") {
      setDragging(false);
      publishDropIntent(null);
    } else {
      dropIntentRef.current = null;
    }
    document.body.classList.remove("desktop-terminal-session-dragging");
    session.sourceElement?.removeAttribute("data-move-source");
    destroyWorkbenchTabMovePreview(session.preview);
    session.nativeLease?.release();
    try {
      if (session.handle.hasPointerCapture(session.pointerId)) {
        session.handle.releasePointerCapture(session.pointerId);
      }
    } catch {
      // Pointer capture may already be gone during cancellation.
    }
    return true;
  }, [publishDropIntent]);

  const finishFromLifecycle = useCallback((reason: InteractionTerminationReason) => (
    finish(reason)
  ), [finish]);
  useInteractionTermination({
    blurGraceMs: WORKBENCH_TRANSIENT_WINDOW_BLUR_GRACE_MS,
    finish: finishFromLifecycle,
  });

  const start = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
    subject: WorkbenchDragSubject,
    label: string,
  ) => {
    if (event.button !== 0) return;
    if (sessionRef.current) finish("restart");
    const id = createNativeSurfacePointerSessionId("terminal-tab-move");
    sessionRef.current = {
      dragging: false,
      handle: event.currentTarget,
      id,
      label,
      nativeLease: null,
      onInsertSession,
      onMergeGroup,
      onMoveGroup,
      onMoveSession,
      originX: event.clientX,
      originY: event.clientY,
      pointerId: event.pointerId,
      preview: null,
      sourceElement: event.currentTarget.closest<HTMLElement>(
        subject.kind === "group"
          ? "[data-terminal-group-pane-id]"
          : ".desktop-terminal-tab",
      ),
      subject,
      thresholdPx: subject.kind === "group"
        ? WORKBENCH_GROUP_HANDLE_MOVE_THRESHOLD_PX
        : WORKBENCH_TAB_MOVE_THRESHOLD_PX,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is the primary path, but not an admission condition.
      // The window-level fallback below keeps the gesture coherent when a
      // browser, embedded surface, or automation bridge declines capture.
    }
  }, [finish, onInsertSession, onMergeGroup, onMoveGroup, onMoveSession]);

  const movePointer = useCallback((event: WorkbenchPointerGestureEvent) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - session.originX,
      event.clientY - session.originY,
    );
    if (!session.dragging) {
      if (distance < session.thresholdPx) return;
      event.preventDefault();
      session.dragging = true;
      setDragging(true);
      document.body.classList.add("desktop-terminal-session-dragging");
      session.sourceElement?.setAttribute("data-move-source", "true");
      session.preview = createWorkbenchTabMovePreview(
        session.handle,
        session.label,
        event.clientX,
        event.clientY,
      );
      session.nativeLease = acquireNativeSurfacePointerPassthroughLease(
        "terminal-tab-move",
        session.id,
      );
    } else if (session.preview) {
      event.preventDefault();
      moveWorkbenchTabMovePreview(session.preview, event.clientX, event.clientY);
    }

    const element = document.elementFromPoint?.(event.clientX, event.clientY);
    const insertion = resolveWorkbenchTabBarDropTarget(
      element ?? null,
      session.subject.kind === "tab"
        ? session.subject.sessionId
        : session.subject.sessionIds,
      event.clientX,
    );
    if (insertion) {
      if (session.subject.kind === "tab") {
        publishDropIntent({
          kind: "insert",
          sourceSessionId: session.subject.sessionId,
          targetGroupId: insertion.targetGroupId,
          targetIndex: insertion.targetIndex,
          allowed: canInsertRef.current(
            session.subject.sessionId,
            insertion.targetGroupId,
            insertion.targetIndex,
            insertion.tabBar,
          ),
        });
      } else {
        publishDropIntent({
          kind: "merge-group",
          sourceGroupId: session.subject.groupId,
          sourceSessionIds: session.subject.sessionIds,
          targetGroupId: insertion.targetGroupId,
          targetIndex: insertion.targetIndex,
          allowed: canMergeGroupRef.current(
            session.subject.groupId,
            insertion.targetGroupId,
            insertion.targetIndex,
            insertion.tabBar,
          ),
        });
      }
      return;
    }
    const contentTarget = resolveWorkbenchContentDropTarget(
      element ?? null,
      event.clientX,
      event.clientY,
    );
    if (!contentTarget) {
      publishDropIntent(null);
      return;
    }
    const { edge, groupId: targetGroupId, surface } = contentTarget;
    if (session.subject.kind === "group") {
      publishDropIntent({
        kind: "move-group",
        sourceGroupId: session.subject.groupId,
        targetGroupId,
        edge,
        allowed: canMoveGroupRef.current(
          session.subject.groupId,
          targetGroupId,
          edge,
          surface,
        ),
      });
    } else {
      publishDropIntent({
        kind: "split",
        sourceSessionId: session.subject.sessionId,
        targetGroupId,
        edge,
        allowed: canDropRef.current(
          session.subject.sessionId,
          targetGroupId,
          edge,
          surface,
        ),
      });
    }
  }, [publishDropIntent]);

  const endPointer = useCallback((event: Pick<globalThis.PointerEvent, "pointerId">) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return "ignored";
    const intent = dropIntentRef.current;
    const dragged = session.dragging;
    const shouldMove = dragged && Boolean(intent?.allowed);
    finish("pointerup", session.id);
    if (shouldMove && intent) {
      if (intent.kind === "insert") {
        session.onInsertSession(
          intent.sourceSessionId,
          intent.targetGroupId,
          intent.targetIndex,
        );
      } else if (intent.kind === "merge-group") {
        session.onMergeGroup(intent.sourceGroupId, intent.targetGroupId, intent.targetIndex);
      } else if (intent.kind === "split") {
        session.onMoveSession(intent.sourceSessionId, intent.targetGroupId, intent.edge);
      } else {
        session.onMoveGroup(intent.sourceGroupId, intent.targetGroupId, intent.edge);
      }
    }
    return dragged ? "drag" : "press";
  }, [finish]);

  const cancelPointer = useCallback((event: Pick<globalThis.PointerEvent, "pointerId">) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    finish("pointercancel", session.id);
  }, [finish]);

  const move = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    movePointer(event);
  }, [movePointer]);

  const end = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => (
    endPointer(event)
  ), [endPointer]);

  const cancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    cancelPointer(event);
  }, [cancelPointer]);

  const lostCapture = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if ((event.buttons & 1) === 1) {
      // Capture can be revoked while the primary pointer is still active
      // (notably at native-surface boundaries). Keep the gesture alive and
      // let the window-level move/up listeners own the remainder.
      return;
    }
    finish("lostpointercapture", session.id);
  }, [finish]);

  useEffect(() => {
    const moveOutsideCapturedHandle = (event: globalThis.PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (event.target instanceof Node && session.handle.contains(event.target)) return;
      movePointer(event);
    };
    const finishOutsideCapturedHandle = (event: globalThis.PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      endPointer(event);
    };
    const cancelOutsideCapturedHandle = (event: globalThis.PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      cancelPointer(event);
    };
    window.addEventListener("pointermove", moveOutsideCapturedHandle, { passive: false });
    window.addEventListener("pointerup", finishOutsideCapturedHandle);
    window.addEventListener("pointercancel", cancelOutsideCapturedHandle);
    return () => {
      window.removeEventListener("pointermove", moveOutsideCapturedHandle);
      window.removeEventListener("pointerup", finishOutsideCapturedHandle);
      window.removeEventListener("pointercancel", cancelOutsideCapturedHandle);
    };
  }, [cancelPointer, endPointer, movePointer]);

  return useMemo(() => ({
    dragging,
    dropIntent,
    start,
    move,
    end,
    cancel,
    lostCapture,
  }), [cancel, dragging, dropIntent, end, lostCapture, move, start]);
}
