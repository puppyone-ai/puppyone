import type { AgentPart } from "../domain/agent-projection-types";
import { useLocalization } from "@puppyone/localization/react";
import { SafeMarkdown } from "./SafeMarkdown";
import { AgentReferenceDisplayList } from "./AgentReferenceDisplayList";
import { AgentPromptInlineContent } from "./AgentPromptInlineContent";
import { useAgentStreamPresentation } from "./useAgentStreamPresentation";

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
  const deliveryLabel = !isAssistant && part.deliveryStatus && part.deliveryStatus !== "accepted"
    ? t(part.deliveryStatus === "queued" ? "agent.status.queued" : part.deliveryStatus === "dispatching"
      ? "agent.status.sending" : part.deliveryStatus === "outcome-unknown" ? "agent.status.deliveryUnknown" : "agent.status.notSent")
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
            <AgentReferenceDisplayList references={(part.references ?? []).filter((reference) => reference.mime?.startsWith("image/") === true)} />
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
      {!isAssistant && <span className="desktop-agent-queued-submission-status"
        role={deliveryLabel ? "status" : undefined} aria-hidden={deliveryLabel ? undefined : true}
        title={deliveryLabel ?? undefined}
      >{deliveryLabel}</span>}
      {isAssistant && part.truncated && <span className="desktop-agent-message-status" role="status">{t("agent.message.partial")}</span>}
    </article>
  );
}
