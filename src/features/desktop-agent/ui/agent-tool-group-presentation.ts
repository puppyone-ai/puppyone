import { isContextCompactionActivity } from "../domain/agent-activity-presentation";
import type { AgentPart, TimelineRow } from "../domain/agent-projection-types";
import { STANDARD_CONTROL_SIZE } from "@puppyone/shared-ui";

export type AgentTranscriptRow = TimelineRow & Readonly<{
  partIds: readonly string[];
  toolGroup: boolean;
}>;

export const AGENT_TOOL_GROUP_LIMIT = 12;

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
      estimatedHeight: compactRowHeight * Math.max(1, Math.ceil(toolRows.length / 2)),
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
