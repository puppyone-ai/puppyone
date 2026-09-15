export type CollapsiblePaneSide = "inline-start" | "inline-end";
export type CollapsiblePaneDirection = "ltr" | "rtl";

/** Shared timing contract for pane layout, content clipping, and native bounds. */
export const COLLAPSIBLE_PANE_MOTION_MS = 360;

export type CollapsiblePaneGesturePhase =
  | "resizing"
  | "collapse-preview"
  | "expand-preview";

export type CollapsiblePaneGestureConfig = Readonly<{
  collapsedWidth: number;
  collapseHysteresis: number;
  collapseThreshold: number;
  collapsible: boolean;
  direction: CollapsiblePaneDirection;
  maxWidth: number;
  minWidth: number;
  side: CollapsiblePaneSide;
}>;

export type CollapsiblePaneGestureState = Readonly<{
  collapseArmed: boolean;
  latestExpansion: number;
  moved: boolean;
  phase: CollapsiblePaneGesturePhase;
  previewCollapsed: boolean;
  previewWidth: number;
  startCollapsed: boolean;
  startWidth: number;
  startX: number;
  startY: number;
}>;

export type CollapsiblePaneGestureCommit =
  | Readonly<{ type: "collapse"; restoreWidth: number }>
  | Readonly<{ type: "expand"; width?: number }>
  | Readonly<{ type: "resize"; width: number }>;

const POINTER_DRAG_SLOP = 4;

export function beginCollapsiblePaneGesture(
  config: CollapsiblePaneGestureConfig,
  point: Readonly<{ clientX: number; clientY: number }>,
  collapsed: boolean,
  width: number,
): CollapsiblePaneGestureState {
  const startWidth = collapsed ? config.collapsedWidth : clamp(width, config.minWidth, config.maxWidth);
  return {
    collapseArmed: false,
    latestExpansion: 0,
    moved: false,
    phase: collapsed ? "expand-preview" : "resizing",
    previewCollapsed: collapsed,
    previewWidth: startWidth,
    startCollapsed: collapsed,
    startWidth,
    startX: point.clientX,
    startY: point.clientY,
  };
}

/**
 * Pure interaction reducer for every collapsible desktop pane. Pointer motion
 * changes only this gesture snapshot; application visibility and preferences
 * are committed once by finishCollapsiblePaneGesture.
 */
export function moveCollapsiblePaneGesture(
  state: CollapsiblePaneGestureState,
  config: CollapsiblePaneGestureConfig,
  point: Readonly<{ clientX: number; clientY: number }>,
): CollapsiblePaneGestureState {
  const logicalDirection = config.direction === "rtl" ? -1 : 1;
  const sideDirection = config.side === "inline-start" ? 1 : -1;
  const widthDelta = (point.clientX - state.startX) * logicalDirection * sideDirection;
  const rawWidth = state.startWidth + widthDelta;
  const moved = state.moved || Math.hypot(
    point.clientX - state.startX,
    point.clientY - state.startY,
  ) > POINTER_DRAG_SLOP;

  if (!config.collapsible) {
    return {
      ...state,
      moved,
      phase: "resizing",
      previewCollapsed: false,
      previewWidth: clamp(rawWidth, config.minWidth, config.maxWidth),
    };
  }

  if (state.startCollapsed) {
    const latestExpansion = Math.max(0, widthDelta);
    if (latestExpansion <= 0) {
      return {
        ...state,
        latestExpansion,
        moved,
        phase: "collapse-preview",
        previewCollapsed: true,
        previewWidth: config.collapsedWidth,
      };
    }
    return {
      ...state,
      latestExpansion,
      moved,
      // Animate the snap from the collapsed edge to the minimum. Once the
      // pointer enters the legal width range, direct manipulation takes over;
      // restarting an expand transition on every move would trail the pointer.
      phase: rawWidth >= config.minWidth ? "resizing" : "expand-preview",
      previewCollapsed: false,
      previewWidth: clamp(rawWidth, config.minWidth, config.maxWidth),
    };
  }

  const collapseBoundary = config.collapseThreshold > 0
    ? config.minWidth - config.collapseThreshold
    : config.collapsedWidth;
  const remainsArmed = state.collapseArmed
    && rawWidth <= collapseBoundary + config.collapseHysteresis;
  const collapseArmed = rawWidth <= collapseBoundary || remainsArmed;

  if (collapseArmed) {
    return {
      ...state,
      collapseArmed: true,
      moved,
      phase: "collapse-preview",
      // Crossing the snap boundary changes only the gesture preview. Pointer
      // capture remains active, so retreating beyond hysteresis restores the
      // expanded preview before pointerup commits anything.
      previewCollapsed: true,
      previewWidth: config.collapsedWidth,
    };
  }

  return {
    ...state,
    collapseArmed: false,
    moved,
    // Leaving an armed compact preview is a state transition back to the
    // expanded track. Hosts can animate it without adding lag to ordinary
    // pointer-synchronous resizing.
    phase: state.collapseArmed ? "expand-preview" : "resizing",
    previewCollapsed: false,
    previewWidth: clamp(rawWidth, config.minWidth, config.maxWidth),
  };
}

export function finishCollapsiblePaneGesture(
  state: CollapsiblePaneGestureState,
  config: CollapsiblePaneGestureConfig,
): CollapsiblePaneGestureCommit | null {
  if (!config.collapsible) {
    return state.previewWidth === state.startWidth
      ? null
      : { type: "resize", width: state.previewWidth };
  }

  if (state.startCollapsed) {
    if (!state.moved) return null;
    return state.latestExpansion >= config.collapseThreshold
      ? { type: "expand", width: state.previewWidth }
      : null;
  }

  if (state.collapseArmed) {
    return { type: "collapse", restoreWidth: config.minWidth };
  }
  return state.previewWidth === state.startWidth
    ? null
    : { type: "resize", width: state.previewWidth };
}

export function resolveCollapsiblePaneGestureConfig({
  collapsedWidth,
  collapseHysteresis,
  collapseThreshold,
  collapsible,
  direction,
  maxWidth,
  minWidth,
  side,
}: Readonly<{
  collapsedWidth: number;
  collapseHysteresis?: number;
  collapseThreshold: number;
  collapsible: boolean;
  direction: CollapsiblePaneDirection;
  maxWidth: number;
  minWidth: number;
  side: CollapsiblePaneSide;
}>): CollapsiblePaneGestureConfig {
  const resolvedMinWidth = normalize(minWidth);
  const resolvedMaxWidth = Math.max(resolvedMinWidth, normalize(maxWidth));
  const resolvedCollapseThreshold = clamp(collapseThreshold, 0, resolvedMinWidth);
  const defaultHysteresis = Math.min(24, resolvedCollapseThreshold * 0.25);
  return {
    collapsedWidth: clamp(collapsedWidth, 0, resolvedMinWidth),
    collapseHysteresis: clamp(
      collapseHysteresis ?? defaultHysteresis,
      0,
      resolvedCollapseThreshold,
    ),
    collapseThreshold: resolvedCollapseThreshold,
    collapsible,
    direction,
    maxWidth: resolvedMaxWidth,
    minWidth: resolvedMinWidth,
    side,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(normalize(value), min), max);
}

function normalize(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
