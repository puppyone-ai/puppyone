import {
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
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
  onKeyboardResize?: (intent: SidebarResizeIntent, accelerated: boolean) => void;
};

export const SidebarResizeHandle = forwardRef<HTMLDivElement, SidebarResizeHandleProps>(function SidebarResizeHandle(
  {
    className,
    collapsedEdgeSide,
    label,
    max,
    min,
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
      role={role}
      tabIndex={tabIndex}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onKeyDown={handleKeyDown}
      onPointerDown={onPointerDown}
      {...props}
    >
      {paneEdge && !collapsedEdgeSide && (
        <span className="po-pane-edge-chrome" data-pane-edge-chrome aria-hidden="true" />
      )}
    </div>
  );
});
