import type { TimelineRow } from "../../domain/agent-projection-types";

export type AgentTimelineSpacing = Readonly<{ compact: number; default: number; workHandoff: number; turnHandoff: number }>;

/** CSS metrics are supplied by the viewport; these defaults also support non-DOM callers. */
export const agentTimelineSpacing: AgentTimelineSpacing = Object.freeze({
  compact: 0,
  default: 2,
  workHandoff: 8,
  turnHandoff: 24,
});

export const agentTimelineLimits = Object.freeze({
  maxMountedRows: 120,
  overscanRows: 14,
  streamBatchMs: 16,
});

export type AgentTimelineLayout = {
  offsets: number[];
  gaps: number[];
  totalHeight: number;
};

/**
 * Owns transcript vertical rhythm independently of mounted DOM adjacency.
 * Measurements contain row content only; semantic gaps are deterministic.
 */
export function buildAgentTimelineLayout(
  rows: readonly TimelineRow[],
  measurements: Readonly<Record<string, number>>,
  spacing: AgentTimelineSpacing = agentTimelineSpacing,
): AgentTimelineLayout {
  const offsets = new Array<number>(rows.length + 1);
  const gaps = new Array<number>(rows.length);
  offsets[0] = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const gap = agentTimelineGapAfter(rows[index], rows[index + 1], spacing);
    gaps[index] = gap;
    offsets[index + 1] = offsets[index] + measuredOrEstimatedHeight(rows[index], measurements) + gap;
  }
  return { offsets, gaps, totalHeight: offsets.at(-1) ?? 0 };
}

export function agentTimelineGapAfter(row: TimelineRow, next: TimelineRow | undefined, spacing: AgentTimelineSpacing = agentTimelineSpacing) {
  if (next && isTurnBoundary(row, next)) return spacing.turnHandoff;
  if (row.kind === "user") return spacing.turnHandoff;
  if (row.kind === "assistant" || row.kind === "turn-summary") {
    return spacing.workHandoff;
  }
  if (row.kind === "tool" || row.kind === "command" || row.kind === "file-change") {
    return spacing.compact;
  }
  return spacing.default;
}

export function visibleAgentTimelineRange(
  offsets: number[],
  count: number,
  scrollTop: number,
  viewportHeight: number,
) {
  const first = Math.max(
    0,
    lowerBound(offsets, Math.max(0, scrollTop)) - 1 - agentTimelineLimits.overscanRows,
  );
  const last = Math.min(
    count,
    lowerBound(offsets, scrollTop + viewportHeight) + agentTimelineLimits.overscanRows,
  );
  return { start: first, end: Math.min(last, first + agentTimelineLimits.maxMountedRows) };
}

function isTurnBoundary(row: TimelineRow, next: TimelineRow) {
  if (next.kind === "user") return true;
  if (row.turnId === next.turnId) return false;
  return row.turnId !== null || next.turnId !== null;
}

function measuredOrEstimatedHeight(
  row: TimelineRow,
  measurements: Readonly<Record<string, number>>,
) {
  const measured = measurements[row.id];
  return Number.isFinite(measured) && measured > 0 ? measured : row.estimatedHeight;
}

function lowerBound(values: number[], target: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}
