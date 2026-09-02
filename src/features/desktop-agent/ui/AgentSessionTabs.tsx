import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { MessageSquare, Plus, X } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopMenuIconButton } from "../../../components/DesktopMenu";
import type { AgentChatTab } from "../domain/agent-chat-tabs";
import { AgentBrandMark } from "./AgentBrandMark";

type AgentSessionTabsProps = {
  tabs: readonly AgentChatTab[];
  activeTabId: string;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCreate: () => void;
  createDisabled?: boolean;
};

export function AgentSessionTabs({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  onCreate,
  createDisabled = false,
}: AgentSessionTabsProps) {
  const { t } = useLocalization();

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const tab = tabs[nextIndex];
    onActivate(tab.id);
    document.getElementById(agentTabId(tab.id))?.focus();
  };

  return (
    <header className="desktop-agent-tabs-subheader" data-window-no-drag="true">
      <div className="desktop-agent-tabs" role="tablist" aria-label={t("agent.tabs.label")} data-po-scrollbar="hidden">
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId;
          return (
            <div className={`desktop-agent-tab ${active ? "is-active" : ""}`} key={tab.id}>
              <button
                id={agentTabId(tab.id)}
                type="button"
                className="desktop-agent-tab-select"
                data-po-interaction="navigation"
                role="tab"
                aria-controls={agentPanelId(tab.id)}
                aria-label={t("agent.tabs.tabLabel", { number: tab.ordinal, title: tab.title })}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                title={tab.title}
                onClick={() => onActivate(tab.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                <span className="desktop-agent-tab-leading" aria-hidden="true">
                  {tab.runtimeLabel
                    ? <AgentBrandMark iconKey={tab.runtimeIconKey} label={tab.runtimeLabel} />
                    : <MessageSquare className="desktop-agent-tab-placeholder-mark" size={14} />}
                  <span className={`desktop-agent-tab-status is-${tab.statusCode}`} />
                </span>
                <span className="desktop-agent-tab-title">{tab.title}</span>
              </button>
              <DesktopMenuIconButton
                className="desktop-agent-tab-close"
                label={t("agent.tabs.close", { title: tab.title })}
                icon={<X size={12} strokeWidth={1.8} aria-hidden="true" />}
                disabled={tab.running}
                onClick={() => onClose(tab.id)}
              />
            </div>
          );
        })}
      </div>
      <DesktopMenuIconButton
        className="desktop-agent-new-tab"
        label={t("agent.tabs.new")}
        icon={<Plus size={14} strokeWidth={1.9} aria-hidden="true" />}
        disabled={createDisabled}
        onClick={onCreate}
      />
    </header>
  );
}

export function agentTabId(tabId: string) {
  return `desktop-agent-tab-${tabId}`;
}

export function agentPanelId(tabId: string) {
  return `desktop-agent-panel-${tabId}`;
}
