export const PROJECT_SWITCHER_RAIL_INLINE_GUTTER = 12;
// Medium typography default: 12px + 32px control + 12px.
export const PROJECT_SWITCHER_RAIL_COLLAPSED_WIDTH = 56;
export const DEFAULT_PROJECT_SWITCHER_EXPANDED_WIDTH = 220;
export const MIN_PROJECT_SWITCHER_EXPANDED_WIDTH = 160;
export const MAX_PROJECT_SWITCHER_EXPANDED_WIDTH = 360;

export function clampProjectSwitcherExpandedWidth(width: number): number {
  const normalized = Number.isFinite(width)
    ? Math.round(width)
    : DEFAULT_PROJECT_SWITCHER_EXPANDED_WIDTH;
  return Math.min(
    Math.max(normalized, MIN_PROJECT_SWITCHER_EXPANDED_WIDTH),
    MAX_PROJECT_SWITCHER_EXPANDED_WIDTH,
  );
}

export function resolveProjectSwitcherRailWidth(
  expanded = false,
  expandedWidth = DEFAULT_PROJECT_SWITCHER_EXPANDED_WIDTH,
): number {
  return expanded
    ? clampProjectSwitcherExpandedWidth(expandedWidth)
    : PROJECT_SWITCHER_RAIL_COLLAPSED_WIDTH;
}

/** Keeps the compact frame symmetric around the same square row control. */
export function resolveProjectSwitcherCompactWidth(controlSize: number): number {
  const normalizedControlSize = Number.isFinite(controlSize)
    ? Math.max(0, Math.round(controlSize))
    : 32;
  return PROJECT_SWITCHER_RAIL_INLINE_GUTTER * 2 + normalizedControlSize;
}
