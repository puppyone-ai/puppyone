export const DEFAULT_EXPLORER_WIDTH = 320;
export const MIN_EXPLORER_WIDTH = 220;
export const MAX_EXPLORER_WIDTH = 520;
export const COLLAPSED_EXPLORER_WIDTH = 0;
export const EXPLORER_COLLAPSE_THRESHOLD = MIN_EXPLORER_WIDTH * 0.5;

export const DEFAULT_RIGHT_SIDEBAR_WIDTH = 560;
export const MIN_RIGHT_SIDEBAR_WIDTH = 320;
export const RIGHT_SIDEBAR_COLLAPSE_THRESHOLD = MIN_RIGHT_SIDEBAR_WIDTH * 0.5;

export const MIN_MAIN_PANE_WIDTH = 320;
export const EXPLORER_RESIZE_GUTTER_WIDTH = 8;

export type DesktopPaneLayoutInput = Readonly<{
  availableWidth: number;
  explorer: Readonly<{
    collapsed: boolean;
    maxWidth?: number;
    minWidth?: number;
    preferredWidth: number;
    present: boolean;
  }>;
  mainMinWidth?: number;
  rightSidebar: Readonly<{
    maxWidth?: number;
    minWidth?: number;
    open: boolean;
    preferredWidth: number;
    present: boolean;
  }>;
}>;

export type ResolvedDesktopPaneLayout = Readonly<{
  availableWidth: number;
  explorer: Readonly<{
    collapsed: boolean;
    maxWidth: number;
    minWidth: number;
    width: number;
  }>;
  main: Readonly<{
    minWidth: number;
    width: number;
  }>;
  minimumWidth: number;
  rightSidebar: Readonly<{
    maxWidth: number;
    minWidth: number;
    open: boolean;
    width: number;
  }>;
  surfaceMinWidth: number;
}>;

/**
 * Resolves the desktop shell as an asymmetric three-pane workbench.
 *
 * Visibility belongs exclusively to user state. Passive window resizing
 * consumes the main pane first, then the auxiliary pane, then the explorer;
 * it never interpolates all three panes or changes an open/collapsed flag.
 * Every pane owns an independent minimum and maximum. When all pane minima
 * cannot fit, `minimumWidth` raises the native window constraint instead of
 * silently violating a pane contract.
 */
export function resolveDesktopPaneLayout({
  availableWidth,
  explorer,
  mainMinWidth = MIN_MAIN_PANE_WIDTH,
  rightSidebar,
}: DesktopPaneLayoutInput): ResolvedDesktopPaneLayout {
  const width = normalizeSize(availableWidth);
  const resolvedMainMinWidth = normalizeSize(mainMinWidth);
  const explorerOpen = explorer.present && !explorer.collapsed;
  const rightSidebarOpen = rightSidebar.present && rightSidebar.open;
  const explorerRange = resolveRange(
    explorer.minWidth,
    explorer.maxWidth,
    MIN_EXPLORER_WIDTH,
    MAX_EXPLORER_WIDTH,
  );
  const rightSidebarRange = resolveRange(
    rightSidebar.minWidth,
    rightSidebar.maxWidth,
    MIN_RIGHT_SIDEBAR_WIDTH,
    Math.max(width, MIN_RIGHT_SIDEBAR_WIDTH),
  );
  const explorerGutterWidth = explorerOpen ? EXPLORER_RESIZE_GUTTER_WIDTH : 0;
  const minimumWidth = resolvedMainMinWidth
    + explorerGutterWidth
    + (explorerOpen ? explorerRange.min : 0)
    + (rightSidebarOpen ? rightSidebarRange.min : 0);
  const layoutWidth = Math.max(width, minimumWidth);

  let explorerWidth = explorerOpen
    ? clamp(explorer.preferredWidth, explorerRange.min, explorerRange.max)
    : COLLAPSED_EXPLORER_WIDTH;
  let rightSidebarWidth = rightSidebarOpen
    ? clamp(rightSidebar.preferredWidth, rightSidebarRange.min, rightSidebarRange.max)
    : 0;

  // The center owns ordinary window compression. Once it reaches its floor,
  // reclaim only the required deficit from one side at a time. The auxiliary
  // pane yields first, matching its role as secondary context; the explorer
  // remains stable until the auxiliary pane has reached its own floor.
  let deficit = Math.max(
    0,
    resolvedMainMinWidth
      - (layoutWidth - explorerGutterWidth - explorerWidth - rightSidebarWidth),
  );
  if (deficit > 0 && rightSidebarOpen) {
    const reclaimed = Math.min(deficit, rightSidebarWidth - rightSidebarRange.min);
    rightSidebarWidth -= reclaimed;
    deficit -= reclaimed;
  }
  if (deficit > 0 && explorerOpen) {
    const reclaimed = Math.min(deficit, explorerWidth - explorerRange.min);
    explorerWidth -= reclaimed;
  }

  const mainWidth = layoutWidth
    - explorerGutterWidth
    - explorerWidth
    - rightSidebarWidth;
  const explorerMaxWidth = explorerOpen
    ? clamp(
      layoutWidth
        - explorerGutterWidth
        - resolvedMainMinWidth
        - (rightSidebarOpen ? rightSidebarRange.min : 0),
      explorerRange.min,
      explorerRange.max,
    )
    : explorerRange.max;
  /* The auxiliary pane has no arbitrary pixel ceiling. Its live maximum is
   * whatever remains after preserving the current Explorer and the Editor
   * floor, so a Terminal can grow with a wide window without consuming either
   * pane's interaction contract. */
  const rightSidebarMaxWidth = clamp(
    layoutWidth
      - explorerGutterWidth
      - resolvedMainMinWidth
      - explorerWidth,
    rightSidebarRange.min,
    rightSidebarRange.max,
  );

  return {
    availableWidth: width,
    explorer: {
      collapsed: !explorerOpen,
      maxWidth: explorerMaxWidth,
      minWidth: explorerRange.min,
      width: explorerWidth,
    },
    main: {
      minWidth: resolvedMainMinWidth,
      width: mainWidth,
    },
    minimumWidth,
    rightSidebar: {
      maxWidth: rightSidebarMaxWidth,
      minWidth: rightSidebarRange.min,
      open: rightSidebarOpen,
      width: rightSidebarWidth,
    },
    surfaceMinWidth: explorerWidth + explorerGutterWidth + resolvedMainMinWidth,
  };
}

function resolveRange(
  minValue: number | undefined,
  maxValue: number | undefined,
  fallbackMin: number,
  fallbackMax: number,
) {
  const min = normalizeMinimum(minValue, fallbackMin);
  const max = Math.max(min, normalizeMinimum(maxValue, fallbackMax));
  return { max, min };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(normalizeSize(value), min), max);
}

function normalizeSize(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function normalizeMinimum(value: number | undefined, fallback: number) {
  return value === undefined ? fallback : normalizeSize(value);
}
