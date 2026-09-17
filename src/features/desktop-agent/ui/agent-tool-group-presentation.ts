import { isContextCompactionActivity } from "../domain/agent-activity-presentation";
import type { AgentPart, TimelineRow } from "../domain/agent-projection-types";
import { STANDARD_CONTROL_SIZE } from "@puppyone/shared-ui";

export type AgentTranscriptRow = TimelineRow & Readonly<{
  partIds: readonly string[];
  toolGroup: boolean;
}>;

export const AGENT_TOOL_GROUP_LIMIT = 64;
export const AGENT_TOOL_RAIL_FALLBACK_VISIBLE = 12;
export const AGENT_TOOL_RAIL_MAX_VISIBLE = 24;
export const AGENT_TOOL_RAIL_ITEM_WIDTH = 28;
export const AGENT_TOOL_RAIL_GAP = 4;
export const AGENT_TOOL_RAIL_OVERFLOW_WIDTH = 36;
export const AGENT_TOOL_RAIL_GROUP_INSET = 8;

type AgentToolRailVisibilityInput = Readonly<{
  total: number;
  width: number;
  itemWidth: number;
  gap: number;
  overflowWidth: number;
}>;

/** Keeps the default rail on one line and reserves one complete slot for +N. */
export function agentToolRailVisibleCount({
  total,
  width,
  itemWidth,
  gap,
  overflowWidth,
}: AgentToolRailVisibilityInput) {
  if (total <= 0) return 0;
  if (![width, itemWidth, gap, overflowWidth].every(Number.isFinite) || width <= 0 || itemWidth <= 0) {
    return Math.min(total, AGENT_TOOL_RAIL_FALLBACK_VISIBLE);
  }
  const boundedGap = Math.max(0, gap);
  const fullCapacity = Math.max(0, Math.floor((width + boundedGap) / (itemWidth + boundedGap)));
  if (total <= fullCapacity && total <= AGENT_TOOL_RAIL_MAX_VISIBLE) return total;
  const capacityWithOverflow = Math.max(
    0,
    Math.floor((width - Math.max(0, overflowWidth)) / (itemWidth + boundedGap)),
  );
  return Math.min(total - 1, AGENT_TOOL_RAIL_MAX_VISIBLE, capacityWithOverflow);
}

/**
 * Groups adjacent tools only at the Renderer boundary. The durable event
 * ledger, provider ordering, and individual tool identities remain untouched.
 */
export function groupAgentToolRows(
  rows: readonly TimelineRow[],
  parts: ReadonlyMap<string, AgentPart>,
  compactRowHeight = STANDARD_CONTROL_SIZE,
): AgentTranscriptRow[] {
  const grouped: AgentTranscriptRow[] = [];
  for (let index = 0; index < rows.length;) {
    const row = rows[index];
    if (!isGroupableToolRow(row, parts)) {
      grouped.push({ ...row, partIds: [row.partId], toolGroup: false });
      index += 1;
      continue;
    }

    const toolRows = [row];
    let cursor = index + 1;
    while (
      cursor < rows.length
      && toolRows.length < AGENT_TOOL_GROUP_LIMIT
      && rows[cursor].turnId === row.turnId
      && isGroupableToolRow(rows[cursor], parts)
    ) {
      toolRows.push(rows[cursor]);
      cursor += 1;
    }

    grouped.push({
      ...row,
      id: `tool-group:${row.id}`,
      updatedSequence: Math.max(...toolRows.map((entry) => entry.updatedSequence ?? entry.sequence)),
      estimatedHeight: compactRowHeight,
      partIds: toolRows.map((entry) => entry.partId),
      toolGroup: true,
    });
    index = cursor;
  }
  return grouped;
}

function isGroupableToolRow(row: TimelineRow, parts: ReadonlyMap<string, AgentPart>) {
  if (!isToolKind(row.kind)) return false;
  const part = parts.get(row.partId);
  return Boolean(part && isToolPart(part) && !isContextCompactionActivity(part));
}

function isToolKind(kind: AgentPart["kind"]): kind is "tool" | "command" | "file-change" {
  return kind === "tool" || kind === "command" || kind === "file-change";
}

function isToolPart(part: AgentPart): part is Extract<AgentPart, { kind: "tool" | "command" | "file-change" }> {
  return isToolKind(part.kind);
}
