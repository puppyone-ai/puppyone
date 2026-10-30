import type { HomepageDesktopPoint, HomepageDesktopPositions } from "../../preferenceStorage";

/**
 * The Homepage Grid is a desktop: a fixed area whose projects stay where they
 * were put. Nothing here reads the window, so resizing it can only scroll.
 */
export const DESKTOP_WIDTH = 760;
export const DESKTOP_TILE = { width: 104, height: 92 } as const;

const COLUMNS = 7;
const MIN_ROWS = 6;
const COLUMN_PITCH = 109;
const ROW_PITCH = 98;
const NUDGE_STEP = 8;
const NUDGE_DIRECTIONS = 16;

function slot(index: number): HomepageDesktopPoint {
  return { x: (index % COLUMNS) * COLUMN_PITCH + 1, y: Math.floor(index / COLUMNS) * ROW_PITCH };
}

function overlaps(a: HomepageDesktopPoint, b: HomepageDesktopPoint) {
  return Math.abs(a.x - b.x) < DESKTOP_TILE.width && Math.abs(a.y - b.y) < DESKTOP_TILE.height;
}

/** Saved projects keep their place; anything new takes the first free slot. */
export function arrangeDesktop(ids: readonly string[], saved: HomepageDesktopPositions) {
  const points = new Map<string, HomepageDesktopPoint>();
  for (const id of ids) {
    const point = saved[id];
    if (point) points.set(id, point);
  }
  let next = 0;
  for (const id of ids) {
    if (points.has(id)) continue;
    while ([...points.values()].some((point) => overlaps(point, slot(next)))) next += 1;
    points.set(id, slot(next));
  }
  return points;
}

/** Tall enough for every project, and never shorter than the empty desktop. */
export function desktopHeight(points: ReadonlyMap<string, HomepageDesktopPoint>) {
  const rows = Math.max(MIN_ROWS, Math.ceil(points.size / COLUMNS));
  const lowest = Math.max(0, ...[...points.values()].map((point) => point.y + DESKTOP_TILE.height));
  return Math.max((rows - 1) * ROW_PITCH + DESKTOP_TILE.height, lowest);
}

export function clampToDesktop(point: HomepageDesktopPoint, height: number): HomepageDesktopPoint {
  return {
    x: Math.round(Math.min(Math.max(0, point.x), DESKTOP_WIDTH - DESKTOP_TILE.width)),
    y: Math.round(Math.min(Math.max(0, point.y), height - DESKTOP_TILE.height)),
  };
}

/** Where a dropped project lands: there, or the nearest spot not on top of another. */
export function settleOnDesktop(
  point: HomepageDesktopPoint,
  others: readonly HomepageDesktopPoint[],
  height: number,
): HomepageDesktopPoint {
  const start = clampToDesktop(point, height);
  const free = (candidate: HomepageDesktopPoint) => !others.some((other) => overlaps(candidate, other));
  if (free(start)) return start;
  for (let radius = NUDGE_STEP; radius < DESKTOP_WIDTH + height; radius += NUDGE_STEP) {
    for (let step = 0; step < NUDGE_DIRECTIONS; step += 1) {
      const angle = (step / NUDGE_DIRECTIONS) * Math.PI * 2;
      const candidate = clampToDesktop({
        x: start.x + Math.cos(angle) * radius,
        y: start.y + Math.sin(angle) * radius,
      }, height);
      if (free(candidate)) return candidate;
    }
  }
  return start;
}
