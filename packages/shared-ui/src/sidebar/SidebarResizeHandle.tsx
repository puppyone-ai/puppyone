import {
  forwardRef,
  useEffect,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { joinSidebarClassNames } from "./classNames";

export type SidebarResizeIntent = "decrease" | "increase" | "minimum" | "maximum";
export type CollapsedPaneEdgeSide = "inline-start" | "inline-end";

export type SidebarResizeHandleProps = Omit<HTMLAttributes<HTMLDivElement>, "onKeyDown"> & {
  collapsedEdgeSide?: CollapsedPaneEdgeSide;
  label: string;
  orientation: "horizontal" | "vertical";
  paneEdge?: boolean;
  value?: number;
  min?: number;
  max?: number;
  onCollapsedActivate?: () => void;
  onKeyboardResize?: (intent: SidebarResizeIntent, accelerated: boolean) => void;
};

export const SidebarResizeHandle = forwardRef<HTMLDivElement, SidebarResizeHandleProps>(function SidebarResizeHandle(
  {
    className,
    collapsedEdgeSide,
    label,
    max,
    min,
    onCollapsedActivate,
    onKeyboardResize,
    onPointerDown,
    orientation,
    paneEdge = false,
    role = "separator",
    tabIndex = 0,
    value,
    ...props
  },
  ref,
) {
  const pointerGestureCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => pointerGestureCleanupRef.current?.(), []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (collapsedEdgeSide) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onCollapsedActivate?.();
      }
      return;
    }
    if (!onKeyboardResize) return;
    const decreaseKey = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    const increaseKey = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    let intent: SidebarResizeIntent | null = null;
    if (event.key === decreaseKey) intent = "decrease";
    else if (event.key === increaseKey) intent = "increase";
    else if (event.key === "Home") intent = "minimum";
    else if (event.key === "End") intent = "maximum";
    if (!intent) return;
    event.preventDefault();
    onKeyboardResize(intent, event.shiftKey);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerGestureCleanupRef.current?.();
    pointerGestureCleanupRef.current = null;

    if (collapsedEdgeSide && onCollapsedActivate && event.button === 0) {
      const pointerId = event.pointerId;
      const handle = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;

      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove, true);
        window.removeEventListener("pointerup", handleEnd, true);
        window.removeEventListener("pointercancel", handleCancel, true);
        window.removeEventListener("blur", handleCancel, true);
        window.removeEventListener("pagehide", handleCancel, true);
        window.removeEventListener("keydown", handleEscape, true);
        document.removeEventListener("visibilitychange", handleVisibilityChange, true);
        handle.removeEventListener("lostpointercapture", handleCancel);
        if (pointerGestureCleanupRef.current === cleanup) {
          pointerGestureCleanupRef.current = null;
        }
      };
      const handleMove = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) return;
        if (Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY) > 4) {
          moved = true;
        }
      };
      const handleEnd = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) return;
        cleanup();
        if (!moved) onCollapsedActivate();
      };
      const handleCancel = () => cleanup();
      const handleEscape = (keyEvent: globalThis.KeyboardEvent) => {
        if (keyEvent.key === "Escape") cleanup();
      };
      const handleVisibilityChange = () => {
        if (document.visibilityState === "hidden") cleanup();
      };

      window.addEventListener("pointermove", handleMove, true);
      window.addEventListener("pointerup", handleEnd, true);
      window.addEventListener("pointercancel", handleCancel, true);
      window.addEventListener("blur", handleCancel, true);
      window.addEventListener("pagehide", handleCancel, true);
      window.addEventListener("keydown", handleEscape, true);
      document.addEventListener("visibilitychange", handleVisibilityChange, true);
      handle.addEventListener("lostpointercapture", handleCancel);
      pointerGestureCleanupRef.current = cleanup;
    }

    onPointerDown?.(event);
  };

  const resolvedRole = collapsedEdgeSide ? "button" : role;

  return (
    <div
      ref={ref}
      className={joinSidebarClassNames(
        "po-sidebar-resize-handle",
        paneEdge && "po-pane-edge-resize-handle",
        collapsedEdgeSide && "po-collapsed-pane-edge-handle",
        collapsedEdgeSide && `po-collapsed-pane-edge-handle--${collapsedEdgeSide}`,
        className,
      )}
      role={resolvedRole}
      tabIndex={tabIndex}
      aria-label={label}
      aria-expanded={collapsedEdgeSide ? false : undefined}
      aria-orientation={collapsedEdgeSide ? undefined : orientation}
      aria-valuemin={collapsedEdgeSide ? undefined : min}
      aria-valuemax={collapsedEdgeSide ? undefined : max}
      aria-valuenow={collapsedEdgeSide ? undefined : value}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      {...props}
    >
      {collapsedEdgeSide && (
        <span className="po-collapsed-pane-edge-glyph" aria-hidden="true">
          <svg viewBox="0 0 8 14" focusable="false">
            <polyline
              points={collapsedEdgeSide === "inline-start" ? "1,1 7,7 1,13" : "7,1 1,7 7,13"}
            />
          </svg>
        </span>
      )}
    </div>
  );
});
