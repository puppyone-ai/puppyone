export const PROJECT_SWITCHER_RAIL_COLLAPSED_WIDTH = 38;
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
