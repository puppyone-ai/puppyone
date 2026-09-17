import type { AgentPart } from "../domain/agent-projection-types";
import { useLocalization } from "@puppyone/localization/react";
import { SafeMarkdown } from "./SafeMarkdown";
import { AgentReferenceDisplayList } from "./AgentReferenceDisplayList";
import { AgentPromptInlineContent } from "./AgentPromptInlineContent";
import { useAgentStreamPresentation } from "./useAgentStreamPresentation";
import { isAgentMediaReference } from "../domain/agent-prompt-mentions";

type AgentMessagePartProps = {
  part: Extract<AgentPart, { kind: "user" | "assistant" }>;
  runtimeLabel: string;
};

/**
 * Conversation content has a different visual contract from work evidence:
 * user prompts are quiet full-width rows; Agent answers stay in the document flow.
 */
export function AgentMessagePart({ part, runtimeLabel }: AgentMessagePartProps) {
  const { t } = useLocalization();
  const isAssistant = part.kind === "assistant";
  // Routine delivery is silent. Keep only exceptional states that change what
  // the user needs to know, without a transient footer outside the bubble.
  const deliveryLabel = !isAssistant && part.deliveryStatus && !["accepted", "dispatching"].includes(part.deliveryStatus)
    ? t(part.deliveryStatus === "queued" ? "agent.status.queued"
      : part.deliveryStatus === "outcome-unknown" ? "agent.status.deliveryUnknown" : "agent.status.notSent")
    : null;
  const presentedText = useAgentStreamPresentation(part.text, isAssistant && part.streaming);
  return (
    <article
      className={`desktop-agent-message is-${part.kind}`}
      aria-label={isAssistant ? runtimeLabel : t("agent.message.you")}
      aria-busy={isAssistant && part.streaming ? true : undefined}
      data-message-surface={isAssistant ? "document" : "row"}
    >
      {isAssistant
        ? <SafeMarkdown text={presentedText || (part.streaming ? "…" : "")} streaming={part.streaming} />
        : <>
            <AgentReferenceDisplayList references={(part.references ?? []).filter(isAgentMediaReference)} />
            {part.text && <AgentPromptInlineContent
              text={part.text}
              mentions={part.promptMentions}
              references={part.references}
            />}
          </>}
      {isAssistant && part.terminalState && part.terminalState !== "completed" && (
        <footer className="desktop-agent-message-status">
          <span className={`desktop-agent-message-state is-${part.terminalState}`}>{t(`agent.turn.status.${part.terminalState}`)}</span>
        </footer>
      )}
      {deliveryLabel && <span className="desktop-agent-delivery-notice" role="status">{deliveryLabel}</span>}
      {isAssistant && part.truncated && <span className="desktop-agent-message-status" role="status">{t("agent.message.partial")}</span>}
    </article>
  );
}
