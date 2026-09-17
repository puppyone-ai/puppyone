import type {
  AgentDraftReference,
  AgentPromptReferenceMention,
  AgentReferenceDisplay,
} from "./agent-contract";
import { agentReferenceMentionText } from "../../../../shared/agent-contract/reference-identity.mjs";
import { classifyAgentAttachment } from "./agent-reference-capabilities";

/** Images are native media inputs. Every other reference is an inline path mention. */
export function isAgentMediaReference(reference: Pick<AgentDraftReference | AgentReferenceDisplay, "mime" | "displayName"> & {
  kind?: AgentDraftReference["kind"] | AgentReferenceDisplay["kind"];
  entryType?: "file" | "directory";
}) {
  if (reference.kind === "workspace-directory" || reference.entryType === "directory") return false;
  return classifyAgentAttachment({ mime: reference.mime, name: reference.displayName }) === "image";
}

export function agentPromptMentionText(reference: AgentDraftReference) {
  return agentReferenceMentionText(reference);
}

export function normalizeAgentPromptMentions(
  prompt: string,
  mentions: readonly AgentPromptReferenceMention[],
  referenceIds?: ReadonlySet<string>,
) {
  let boundary = 0;
  return mentions
    .filter((mention) => (
      typeof mention.referenceId === "string"
      && Number.isSafeInteger(mention.start)
      && Number.isSafeInteger(mention.end)
      && mention.start >= boundary
      && mention.end > mention.start
      && mention.end <= prompt.length
      && (!referenceIds || referenceIds.has(mention.referenceId))
    ))
    .sort((left, right) => left.start - right.start)
    .filter((mention) => {
      if (mention.start < boundary) return false;
      boundary = mention.end;
      return true;
    })
    .map((mention) => ({ ...mention }));
}

export function splitAgentPromptMentions(
  prompt: string,
  mentions: readonly AgentPromptReferenceMention[],
) {
  const normalized = normalizeAgentPromptMentions(prompt, mentions);
  const parts: Array<
    | { kind: "text"; text: string }
    | { kind: "mention"; text: string; mention: AgentPromptReferenceMention }
  > = [];
  let cursor = 0;
  for (const mention of normalized) {
    if (mention.start > cursor) parts.push({ kind: "text", text: prompt.slice(cursor, mention.start) });
    parts.push({ kind: "mention", text: prompt.slice(mention.start, mention.end), mention });
    cursor = mention.end;
  }
  if (cursor < prompt.length) parts.push({ kind: "text", text: prompt.slice(cursor) });
  return parts;
}
