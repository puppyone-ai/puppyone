import type {
  AgentPart,
  AgentProjection,
  TimelineRow,
} from "../domain/agent-projection-types";
import { outputForActivity } from "../domain/agent-activity-presentation";
import { isLiveAgentActivityStatus } from "../domain/agent-turn-lifecycle";

export type AgentTimeline = {
  rows: TimelineRow[];
  parts: Map<string, AgentPart>;
};

/**
 * Projects durable Agent state into visible transcript rows. Non-visual state,
 * such as token usage, must not occupy virtual-list geometry.
 */
export function buildAgentTimeline(projection: AgentProjection): AgentTimeline {
  let parts: AgentPart[];
  let rows: TimelineRow[];
  if (projection.rows.length > 0 && projection.parts.length > 0) {
    parts = [...projection.parts];
    rows = [...projection.rows];
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
  return appendTurnSummaries(rows, parts, projection.turns);
}

export function isVisibleAgentTimelinePart(part: AgentPart | undefined): part is AgentPart {
  if (!part || part.kind === "usage") return false;
  // Resolved approvals remain in the durable projection for replay/audit, but
  // are no longer conversation content. Removing their row also lets the
  // surrounding tool activity collapse back into one compact visual group.
  if (part.kind === "permission" && part.state === "resolved") return false;
  if (part.kind !== "reasoning") return true;
  if (isLiveAgentActivityStatus(part.status)) return false;
  const summary = typeof part.detail.delta === "string"
    ? part.detail.delta
    : outputForActivity(part);
  return summary.trim().length > 0;
}

function appendTurnSummaries(
  rows: TimelineRow[],
  parts: AgentPart[],
  turns: AgentProjection["turns"],
): AgentTimeline {
  const partMap = new Map(parts.map((part) => [part.id, part]));
  const nextRows = rows.filter((row) => isVisibleAgentTimelinePart(partMap.get(row.partId)));
  for (const turn of turns) {
    if (turn.status === "running" || turn.durationMs === null || turn.completedAtSequence === null) continue;
    const id = `turn-summary:${turn.id}`;
    const lastTurnSequence = nextRows.reduce((latest, row) => (
      row.turnId === turn.id ? Math.max(latest, row.sequence) : latest
    ), turn.completedAtSequence);
    const sequence = lastTurnSequence + 0.5;
    const part: AgentPart = {
      id,
      kind: "turn-summary",
      turnId: turn.id,
      itemId: null,
      durationMs: turn.durationMs,
      status: turn.status,
      sequence,
      updatedSequence: turn.completedAtSequence,
    };
    partMap.set(id, part);
    nextRows.push({
      id: `row:${id}`,
      partId: id,
      turnId: turn.id,
      kind: "turn-summary",
      sequence,
      updatedSequence: turn.completedAtSequence,
      estimatedHeight: 30,
    });
  }
  return {
    rows: nextRows.sort((left, right) => left.sequence - right.sequence),
    parts: partMap,
  };
}

function estimateLegacyPartHeight(part: AgentPart) {
  if (part.kind === "assistant") return Math.min(640, 50 + Math.ceil(part.text.length / 64) * 20);
  if (part.kind === "user") return 64;
  return 34;
}
