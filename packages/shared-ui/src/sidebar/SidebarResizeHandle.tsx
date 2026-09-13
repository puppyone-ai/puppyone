import {
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { joinSidebarClassNames } from "./classNames";

export type SidebarResizeIntent = "decrease" | "increase" | "minimum" | "maximum";
export type CollapsedPaneEdgeSide = "inline-start" | "inline-end";

export type SidebarResizeHandleProps = Omit<HTMLAttributes<HTMLDivElement>, "onKeyDown"> & {
  collapsedEdgeSide?: CollapsedPaneEdgeSide;
  label: string;
  orientation: "horizontal" | "vertical";
  paneEdge?: boolean;
  resizing?: boolean;
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
    onClick,
    onCollapsedActivate,
    onKeyboardResize,
    onPointerDown,
    orientation,
    paneEdge = false,
    resizing = false,
    role = "separator",
    tabIndex = 0,
    value,
    ...props
  },
  ref,
) {
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

  const resolvedRole = collapsedEdgeSide ? "button" : role;
  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Pointer activation is owned by the pane gesture controller. A synthetic
    // click with no pointer detail is an assistive-technology activation.
    if (collapsedEdgeSide && event.detail === 0) onCollapsedActivate?.();
    onClick?.(event);
  };

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
      data-resizing={resizing || undefined}
      role={resolvedRole}
      tabIndex={tabIndex}
      aria-label={label}
      aria-expanded={collapsedEdgeSide ? false : undefined}
      aria-orientation={collapsedEdgeSide ? undefined : orientation}
      aria-valuemin={collapsedEdgeSide ? undefined : min}
      aria-valuemax={collapsedEdgeSide ? undefined : max}
      aria-valuenow={collapsedEdgeSide ? undefined : value}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={onPointerDown}
      {...props}
    >
      {paneEdge && !collapsedEdgeSide && (
        <span className="po-pane-edge-chrome" data-pane-edge-chrome aria-hidden="true" />
      )}
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
