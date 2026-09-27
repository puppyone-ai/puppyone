import type { AgentPromptReferenceMention, AgentReferenceDisplay } from "../domain/agent-contract";
import { splitAgentPromptMentions } from "../domain/agent-prompt-mentions";

export function AgentPromptInlineContent({ text, mentions = [], references = [] }: {
  text: string;
  mentions?: AgentPromptReferenceMention[];
  references?: AgentReferenceDisplay[];
}) {
  const referencesById = new Map(references.map((reference) => [reference.id, reference]));
  return (
    <div className="desktop-agent-message-text">
      {splitAgentPromptMentions(text, mentions).map((part, index) => part.kind === "mention"
        ? <span
            className="desktop-agent-history-mention"
            data-reference-id={part.mention.referenceId}
            data-reference-kind={referencesById.get(part.mention.referenceId)?.kind ?? "unknown"}
            data-tooltip={referenceTitle(referencesById.get(part.mention.referenceId))}
            key={`${part.mention.referenceId}:${part.mention.start}`}
          >{part.text}</span>
        : <span key={`text:${index}`}>{part.text}</span>)}
    </div>
  );
}

function referenceTitle(reference: AgentReferenceDisplay | undefined) {
  return reference?.relativePath || reference?.displayName || undefined;
}
