import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import type { AuxiliaryWorkbenchHistoryBrowserContext } from "../../app-shell/auxiliary-workbench/types";
import { useLocalization } from "@puppyone/localization/react";
import { ConversationHistoryController } from "../application/ConversationHistoryController";
import { createAgentChatHistoryTarget } from "../domain/agent-chat-history-target";
import { getElectronAgentClient } from "../infrastructure/electron/electronAgentClient";
import { AgentConversationHistory } from "../ui/AgentConversationHistory";
import { useAgentConversationHistory } from "../ui/useAgentConversationHistory";
import "../ui/desktop-agent.css";

/**
 * Feature-owned global history surface. It discovers Harness sessions only
 * after the user explicitly opens History and never creates a Chat session.
 */
export function AgentChatHistoryBrowser({
  rootPath,
  excludedResourceIds,
  openingTargetId,
  onBack,
  onOpen,
  historyDiscoveryEnabled,
  onHistoryDiscoveryEnabledChange,
}: AuxiliaryWorkbenchHistoryBrowserContext & Readonly<{
  historyDiscoveryEnabled: boolean;
  onHistoryDiscoveryEnabledChange: (enabled: boolean) => void;
}>) {
  const { t } = useLocalization();
  const controller = useMemo(
    () => new ConversationHistoryController(rootPath, getElectronAgentClient),
    [rootPath],
  );
  const history = useAgentConversationHistory({
    active: historyDiscoveryEnabled,
    controller,
    excludedSessionIds: excludedResourceIds,
  });

  if (!historyDiscoveryEnabled) {
    const question = t("agent.history.permission.question");
    return (
      <div className="desktop-agent-boundary desktop-agent-runtime-launcher is-history">
        <section className="desktop-agent-history-permission-view" aria-label={question}>
          <header className="desktop-agent-history-toolbar">
            <button
              type="button"
              className="desktop-agent-history-toolbar-button"
              data-po-interaction="navigation"
              aria-label={t("agent.history.back")}
              title={t("agent.history.back")}
              onClick={onBack}
            >
              <ArrowLeft size={15} strokeWidth={1.7} aria-hidden="true" />
            </button>
            <h2>{t("agent.history.title")}</h2>
            <span aria-hidden="true" />
          </header>
          <div className="desktop-agent-history-permission-content">
            <p>{question}</p>
            <button
              type="button"
              className="desktop-agent-history-permission-button"
              autoFocus
              aria-label={t("agent.history.permission.allowAria")}
              onClick={() => onHistoryDiscoveryEnabledChange(true)}
            >
              {t("agent.history.permission.allow")}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="desktop-agent-boundary desktop-agent-runtime-launcher is-history">
      <AgentConversationHistory
        sessions={history.sessions}
        runtimes={history.runtimes}
        loading={history.sessions.length === 0 && (
          history.loading || !history.loaded || history.refreshing
        )}
        refreshing={history.refreshing}
        loadingMore={history.loadingMore}
        hasMore={history.hasMore}
        error={history.error}
        openingSessionId={openingTargetId}
        onOpen={(session) => onOpen(createAgentChatHistoryTarget(session))}
        onRefresh={() => void history.refreshNative()}
        onLoadMore={() => void history.loadMoreNative()}
        onBack={onBack}
      />
    </div>
  );
}
