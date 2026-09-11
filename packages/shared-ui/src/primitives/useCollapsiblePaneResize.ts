import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { usePaneResizeDrag } from "./usePaneResizeDrag";

export type CollapsiblePaneSide = "inline-start" | "inline-end";
export type CollapsiblePaneDirection = "ltr" | "rtl";

export type UseCollapsiblePaneResizeOptions = {
  bodyClassName: string;
  collapsed: boolean;
  collapsedWidth?: number;
  /** Additional inward pointer travel after minWidth before collapse. */
  collapseThreshold: number;
  direction: CollapsiblePaneDirection;
  enabled?: boolean;
  maxWidth: number;
  minWidth: number;
  side: CollapsiblePaneSide;
  width: number;
  /**
   * `continuous` publishes every animation-frame preview. `end` keeps the
   * gesture local and publishes once on pointer release, avoiding expensive
   * application-state and persistence work during direct manipulation.
   */
  widthChangeMode?: "continuous" | "end";
  onCollapsedChange?: (collapsed: boolean) => void;
  onDragActiveChange?: (active: boolean) => void;
  onWidthChange: (width: number) => void;
};

export type CollapsiblePaneResizeState = {
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  width: number;
};

/**
 * Owns the pointer state machine for a resizable pane with a pull-to-collapse
 * threshold. The returned value is the canonical live resize width. During a
 * direct pointer resize, host and content consume it together. A visibility
 * transition may keep a separate last-expanded content plane while its outer
 * track consumes this value, preventing text reflow during enter and exit.
 */
export function useCollapsiblePaneResize({
  bodyClassName,
  collapsed,
  collapsedWidth = 0,
  collapseThreshold,
  direction,
  enabled = true,
  maxWidth,
  minWidth,
  side,
  width,
  widthChangeMode = "continuous",
  onCollapsedChange,
  onDragActiveChange,
  onWidthChange,
}: UseCollapsiblePaneResizeOptions): CollapsiblePaneResizeState {
  const [gestureWidth, setGestureWidth] = useState<number | null>(null);
  const canCollapse = Boolean(onCollapsedChange);
  const resolvedCollapsedWidth = clampWidth(collapsedWidth, 0, minWidth);
  const resolvedWidth = clampWidth(width, minWidth, maxWidth);
  const resolvedCollapsePullDistance = clampWidth(
    collapseThreshold,
    0,
    minWidth,
  );

  const onPointerDown = usePaneResizeDrag({
    enabled,
    bodyClassName,
    onDragActiveChange,
    onDragStart: (event) => {
      const startX = event.clientX;
      const startWidth = collapsed ? resolvedCollapsedWidth : resolvedWidth;
      const startedCollapsed = collapsed;
      let collapsedDuringDrag = collapsed;
      let latestWidth = startWidth;
      let latestExpansion = 0;
      let widthChanged = false;
      setGestureWidth(startWidth);

      const previewWidth = (nextWidth: number, publish = true) => {
        latestWidth = nextWidth;
        widthChanged ||= nextWidth !== startWidth;
        setGestureWidth(nextWidth);
        if (publish && widthChangeMode === "continuous") onWidthChange(nextWidth);
      };

      return {
        onMove: (point) => {
          const logicalDirection = direction === "rtl" ? -1 : 1;
          const sideDirection = side === "inline-start" ? 1 : -1;
          const widthDelta = (point.clientX - startX)
            * logicalDirection
            * sideDirection;
          const rawWidth = startWidth + widthDelta;
          latestExpansion = Math.max(0, widthDelta);

          if (!canCollapse) {
            previewWidth(clampWidth(rawWidth, minWidth, maxWidth));
            return;
          }

          if (startedCollapsed) {
            if (latestExpansion <= 0) {
              setGestureWidth(resolvedCollapsedWidth);
              return;
            }

            const nextWidth = clampWidth(rawWidth, minWidth, maxWidth);
            previewWidth(nextWidth, latestExpansion >= resolvedCollapsePullDistance);
            if (collapsedDuringDrag) {
              onCollapsedChange?.(false);
              collapsedDuringDrag = false;
            }
            return;
          }

          const collapseBoundary = resolvedCollapsePullDistance > 0
            ? minWidth - resolvedCollapsePullDistance
            : resolvedCollapsedWidth;
          if (rawWidth <= collapseBoundary) {
            setGestureWidth(resolvedCollapsedWidth);
            if (!collapsedDuringDrag) onCollapsedChange?.(true);
            collapsedDuringDrag = true;
            return;
          }

          if (collapsedDuringDrag) onCollapsedChange?.(false);
          collapsedDuringDrag = false;

          // Resize normally down to minWidth. Pointer travel beyond minWidth is
          // an elastic collapse gesture, so the one rendered width stays at the
          // minimum until the collapse boundary is crossed.
          previewWidth(clampWidth(rawWidth, minWidth, maxWidth));
        },
        onCancel: () => {
          if (collapsedDuringDrag !== startedCollapsed) onCollapsedChange?.(startedCollapsed);
          if (widthChangeMode === "continuous" && widthChanged) onWidthChange(resolvedWidth);
          setGestureWidth(null);
        },
        onEnd: () => {
          if (startedCollapsed && latestExpansion < resolvedCollapsePullDistance) {
            if (!collapsedDuringDrag) onCollapsedChange?.(true);
            collapsedDuringDrag = true;
          }
          if (
            !collapsedDuringDrag
            && latestWidth >= minWidth
            && (
              (startedCollapsed && latestExpansion >= resolvedCollapsePullDistance)
              || (widthChangeMode === "end" && widthChanged)
            )
          ) {
            onWidthChange(latestWidth);
          }
          setGestureWidth(null);
        },
      };
    },
  });

  return {
    dragging: gestureWidth !== null,
    onPointerDown,
    width: collapsed ? resolvedCollapsedWidth : gestureWidth ?? resolvedWidth,
  };
}

function clampWidth(value: number, min: number, max: number) {
  const normalized = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(Math.max(normalized, min), max);
}
