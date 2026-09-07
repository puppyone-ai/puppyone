import type { TimelineRow } from "../../domain/agent-projection-types";
import type { AgentTimelineLayout } from "./transcript-layout";

import type { AgentTimelineScrollAnchor } from "../../domain/agent-ui-state";
export type { AgentTimelineScrollAnchor } from "../../domain/agent-ui-state";

/**
 * Captures one stable viewport coordinate before a width-driven reflow.
 * Native scroll anchoring is disabled because the transcript is virtualized,
 * so the virtual layout must own the anchor explicitly.
 */
export function captureAgentTimelineScrollAnchor(
  rows: readonly TimelineRow[],
  layout: AgentTimelineLayout,
  scrollTop: number,
  timelineTop: number,
): AgentTimelineScrollAnchor {
  const localScrollTop = scrollTop - timelineTop;
  if (rows.length === 0 || localScrollTop < 0) {
    return { kind: "absolute", scrollTop };
  }

  const index = Math.min(
    rows.length - 1,
    Math.max(0, upperBound(layout.offsets, localScrollTop) - 1),
  );
  return {
    kind: "row",
    rowId: rows[index].id,
    offset: localScrollTop - layout.offsets[index],
  };
}

export function resolveAgentTimelineScrollAnchor(
  anchor: AgentTimelineScrollAnchor,
  layout: AgentTimelineLayout,
  rowIndexById: ReadonlyMap<string, number>,
  timelineTop: number,
  previousRows?: readonly TimelineRow[],
  previousLayout?: AgentTimelineLayout,
) {
  if (anchor.kind === "absolute") return anchor.scrollTop;
  const index = rowIndexById.get(anchor.rowId);
  if (index === undefined) {
    if (!previousRows || !previousLayout) return null;
    const oldIndex = previousRows.findIndex(row => row.id === anchor.rowId);
    if (oldIndex < 0) return null;
    for (let distance = 1; distance < previousRows.length; distance++) {
      for (const candidate of [oldIndex + distance, oldIndex - distance]) {
        const row = previousRows[candidate];
        const replacement = row ? rowIndexById.get(row.id) : undefined;
        if (replacement === undefined) continue;
        const offset = anchor.offset + previousLayout.offsets[oldIndex] - previousLayout.offsets[candidate];
        return Math.max(0, timelineTop + layout.offsets[replacement] + offset);
      }
    }
    return null;
  }
  return Math.max(0, timelineTop + layout.offsets[index] + anchor.offset);
}

function upperBound(values: readonly number[], target: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}
