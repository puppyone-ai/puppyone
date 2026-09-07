import type { AgentDraftReference, AgentPromptReferenceMention, AgentReferenceDisplay } from "../../domain/agent-contract";
import type {
  AgentPart,
  AgentProjection,
  TimelineRow,
} from "../../domain/agent-projection-types";
import { STANDARD_CONTROL_SIZE } from "@puppyone/shared-ui";
import { outputForActivity } from "../../domain/agent-activity-presentation";


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
  pending: PendingTranscriptSubmission | null = null,
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
  // Main owns message correlation. UI only uses its opaque submission identity
  // so an admitted row continues the same mounted preview, regardless of native IDs.
  const partMap = new Map(parts.map(part => [part.id, part]));
  rows = rows.map(row => {
    const part = partMap.get(row.partId);
    return part?.kind === "user" && part.submissionId
      ? { ...row, id: submissionRowId(part.submissionId) }
      : row;
  });
  if (pending && !parts.some(part => part.kind === "user" && part.submissionId === pending.id)) {
    const part: Extract<AgentPart, { kind: "user" }> = {
      id: `pending:${pending.id}`, kind: "user", turnId: null, itemId: null,
      submissionId: pending.id, text: pending.prompt,
      references: pending.references.map(draftReferenceDisplay), promptMentions: pending.promptMentions,
      streaming: false, terminalState: null, sequence: Number.MAX_SAFE_INTEGER,
    };
    partMap.set(part.id, part);
    rows.push({ id: submissionRowId(pending.id), partId: part.id, kind: "user", turnId: null,
      sequence: part.sequence, estimatedHeight: 64 });
  }
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


export type PendingTranscriptSubmission = Readonly<{
  id: string;
  prompt: string;
  references: readonly AgentDraftReference[];
  promptMentions: AgentPromptReferenceMention[];
}>;

function submissionRowId(id: string) { return `row:submission:${id}`; }

function draftReferenceDisplay(reference: AgentDraftReference): AgentReferenceDisplay {
  return {
    id: reference.id,
    kind: reference.kind === "staged-attachment" ? "attachment"
      : reference.entryType === "directory" ? "workspace-directory" : "workspace-file",
    displayName: reference.displayName,
    ...(reference.kind === "workspace-entry" ? { relativePath: reference.relativePath } : {}),
    ...(reference.kind === "workspace-entry" && reference.workspaceName ? { workspaceName: reference.workspaceName } : {}),
    ...(reference.kind === "staged-attachment" ? { mime: reference.mime, size: reference.size } : {}),
  };
}
