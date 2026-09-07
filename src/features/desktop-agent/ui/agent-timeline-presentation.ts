import type {
  AgentPart,
  AgentProjection,
  TimelineRow,
} from "../domain/agent-projection-types";
import { STANDARD_CONTROL_SIZE } from "@puppyone/shared-ui";
import { outputForActivity } from "../domain/agent-activity-presentation";


export type AgentTimeline = {
  rows: TimelineRow[];
  parts: Map<string, AgentPart>;
};

/**
 * Arranges Main-authored display data into visible transcript rows. Non-visual state,
 * such as token usage, must not occupy virtual-list geometry.
 */
export function buildAgentTimeline(
  projection: AgentProjection,
  compactRowHeight = STANDARD_CONTROL_SIZE,
): AgentTimeline {
  let parts: AgentPart[];
  let rows: TimelineRow[];
  if (projection.rows.length > 0 && projection.parts.length > 0) {
    parts = [...projection.parts];
    rows = projection.rows.map((row) => row.kind === "turn-summary"
      ? { ...row, estimatedHeight: compactRowHeight }
      : row);
  } else {
    // Compatibility for consumers constructing the original projection shape.
    parts = [
      ...projection.messages.map((message): AgentPart => ({ ...message, kind: message.role })),
      ...projection.activities.map((activity): AgentPart => ({ ...activity })),
    ].sort((left, right) => left.sequence - right.sequence);
    rows = parts.map((part) => ({
      id: `row:${part.id}`,
      partId: part.id,
      turnId: part.turnId,
      kind: part.kind,
      sequence: part.sequence,
      updatedSequence: part.updatedSequence ?? part.sequence,
      estimatedHeight: estimateLegacyPartHeight(part),
    }));
  }
  const partMap = new Map(parts.map(part => [part.id, part]));
  return { rows: rows.filter(row => isVisibleAgentTimelinePart(partMap.get(row.partId))), parts: partMap };
}

export function isVisibleAgentTimelinePart(part: AgentPart | undefined): part is AgentPart {
  if (!part || part.kind === "usage") return false;
  // Resolved approvals remain in the display snapshot, but
  // are no longer conversation content. Removing their row also lets the
  // surrounding tool activity collapse back into one compact visual group.
  if (part.kind === "permission" && part.state !== "pending") return false;
  if (part.kind !== "reasoning") return true;
  if (["queued", "running", "pending", "in-progress", "waiting-for-user"].includes(part.status)) return false;
  const summary = typeof part.detail.delta === "string"
    ? part.detail.delta
    : outputForActivity(part);
  return summary.trim().length > 0;
}

function estimateLegacyPartHeight(part: AgentPart) {
  if (part.kind === "assistant") return Math.min(640, 50 + Math.ceil(part.text.length / 64) * 20);
  if (part.kind === "user") return 64;
  return 34;
}
