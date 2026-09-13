import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  beginCollapsiblePaneGesture,
  finishCollapsiblePaneGesture,
  moveCollapsiblePaneGesture,
  resolveCollapsiblePaneGestureConfig,
  type CollapsiblePaneDirection,
  type CollapsiblePaneGestureConfig,
  type CollapsiblePaneGestureCommit,
  type CollapsiblePaneGesturePhase,
  type CollapsiblePaneGestureState,
  type CollapsiblePaneSide,
} from "./collapsiblePaneGesture";
import { usePaneResizeDrag } from "./usePaneResizeDrag";

export type UseCollapsiblePaneResizeOptions = {
  bodyClassName: string;
  collapsed: boolean;
  collapsedWidth?: number;
  collapseHysteresis?: number;
  /** Additional inward pointer travel after minWidth before collapse. */
  collapseThreshold: number;
  collapsible: boolean;
  direction: CollapsiblePaneDirection;
  enabled?: boolean;
  maxWidth: number;
  minWidth: number;
  side: CollapsiblePaneSide;
  width: number;
  onCommit: (commit: CollapsiblePaneGestureCommit) => void;
  onDragActiveChange?: (active: boolean) => void;
};

type PaneGesturePreview = Readonly<{
  collapsed: boolean;
  phase: CollapsiblePaneGesturePhase;
  width: number;
}>;

type PendingPaneCommit = Readonly<{
  baselineKey: string;
  collapsed: boolean;
  targetKey: string;
  width: number;
}>;

export type CollapsiblePaneResizeState = {
  collapsed: boolean;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  phase: CollapsiblePaneGesturePhase | "idle";
  width: number;
};

/**
 * Adapts one pure pane-gesture state machine to browser pointer capture. The
 * returned width is the canonical live resize width, while collapsed/width
 * props remain the last committed application state. Visibility transitions
 * may retain a separate last-expanded content plane to prevent text reflow.
 */
export function useCollapsiblePaneResize({
  bodyClassName,
  collapsed,
  collapsedWidth = 0,
  collapseHysteresis,
  collapseThreshold,
  collapsible,
  direction,
  enabled = true,
  maxWidth,
  minWidth,
  side,
  width,
  onCommit,
  onDragActiveChange,
}: UseCollapsiblePaneResizeOptions): CollapsiblePaneResizeState {
  const [preview, setPreview] = useState<PaneGesturePreview | null>(null);
  const [pendingCommit, setPendingCommit] = useState<PendingPaneCommit | null>(null);
  const config = resolveCollapsiblePaneGestureConfig({
    collapsedWidth,
    collapseHysteresis,
    collapseThreshold,
    collapsible,
    direction,
    maxWidth,
    minWidth,
    side,
  });
  const resolvedWidth = clampWidth(width, config.minWidth, config.maxWidth);
  const externalKey = paneStateKey(collapsed, resolvedWidth);
  const committedCollapsed = pendingCommit?.collapsed ?? collapsed;
  const committedWidth = pendingCommit?.width
    ?? (collapsed ? config.collapsedWidth : resolvedWidth);

  useEffect(() => {
    setPendingCommit((current) => {
      if (!current) return current;
      // Keep the optimistic commit only while the parent still exposes the
      // exact pre-commit snapshot. Matching acknowledgement or a different
      // external command both restore controlled-state authority.
      if (externalKey === current.baselineKey) return current;
      return null;
    });
  }, [externalKey]);

  const onPointerDown = usePaneResizeDrag({
    enabled,
    bodyClassName,
    cancelKey: pendingCommit?.targetKey ?? externalKey,
    onDragActiveChange,
    onDragStart: (event) => {
      let gesture = beginCollapsiblePaneGesture(
        config,
        event,
        committedCollapsed,
        committedWidth,
      );
      setPreview(toPreview(gesture));

      return {
        onMove: (point) => {
          gesture = moveCollapsiblePaneGesture(gesture, config, point);
          setPreview(toPreview(gesture));
        },
        onCancel: () => setPreview(null),
        onEnd: () => {
          const commit = finishCollapsiblePaneGesture(gesture, config);
          if (commit) {
            setPendingCommit(toPendingCommit(
              commit,
              config,
              resolvedWidth,
              externalKey,
            ));
            onCommit(commit);
          }
          setPreview(null);
        },
      };
    },
  });

  return {
    collapsed: preview?.collapsed ?? committedCollapsed,
    dragging: preview !== null,
    onPointerDown,
    phase: preview?.phase ?? "idle",
    width: preview?.width ?? committedWidth,
  };
}

function toPendingCommit(
  commit: CollapsiblePaneGestureCommit,
  config: CollapsiblePaneGestureConfig,
  resolvedWidth: number,
  baselineKey: string,
): PendingPaneCommit {
  const collapsed = commit.type === "collapse";
  const width = commit.type === "collapse"
    ? config.collapsedWidth
    : clampWidth(commit.width ?? resolvedWidth, config.minWidth, config.maxWidth);
  return {
    baselineKey,
    collapsed,
    targetKey: paneStateKey(collapsed, width),
    width,
  };
}

function toPreview({
  phase,
  previewCollapsed,
  previewWidth,
}: CollapsiblePaneGestureState): PaneGesturePreview {
  return {
    collapsed: previewCollapsed,
    phase,
    width: previewWidth,
  };
}

function clampWidth(value: number, min: number, max: number) {
  const normalized = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(Math.max(normalized, min), max);
}

function paneStateKey(collapsed: boolean, width: number) {
  return `${collapsed}:${width}`;
}
