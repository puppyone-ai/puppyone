import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo } from "react";
import type { Workspace } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import {
  closeAgentSessionController,
  getAgentSessionController,
} from "../application/controllerRegistry";
import type { AgentChatTabPresentation } from "../domain/agent-chat-tabs";
import type { AgentRoutePreference } from "../domain/agent-route-preference";
import { getElectronAgentClient, openExternalAgentUrl } from "../infrastructure/electron/electronAgentClient";
import { AgentChatTabPanel } from "./AgentChatTabPanel";
import { AgentSessionTabs, agentPanelId, agentTabId } from "./AgentSessionTabs";
import { useAgentChatTabs } from "./useAgentChatTabs";
import { AgentMarkdownEnvironmentProvider } from "./markdown/AgentMarkdownEnvironment";
import "./desktop-agent.css";

export type RightAgentPanelHandle = { newSession: () => void };

type RightAgentPanelProps = {
  workspace: Workspace;
  active: boolean;
  onViewChanges?: () => void;
  onOpenFile?: (path: string) => void;
  onRunningChange?: (running: boolean) => void;
  preferredRuntimeId?: string | null;
  onPreferredRuntimeChange?: (runtimeId: string | null) => void;
  preferredRoute?: Readonly<AgentRoutePreference>;
  onPreferredRouteChange?: (route: AgentRoutePreference) => void;
  /** @deprecated Use preferredRoute.modelId. */
  preferredModel?: string | null;
  /** @deprecated Use onPreferredRouteChange. */
  onPreferredModelChange?: (model: string) => void;
  hiddenRuntimeIds?: readonly string[];
};

export const RightAgentPanel = forwardRef<RightAgentPanelHandle, RightAgentPanelProps>(function RightAgentPanel({
  workspace,
  active,
  onViewChanges,
  onOpenFile,
  onRunningChange,
  preferredRuntimeId = null,
  onPreferredRuntimeChange,
  preferredRoute = {},
  onPreferredRouteChange,
  preferredModel = null,
  onPreferredModelChange,
  hiddenRuntimeIds = [],
}, ref) {
  const { t } = useLocalization();
  const closeController = useCallback((tabId: string) => (
    closeAgentSessionController(workspace.path, tabId)
  ), [workspace.path]);
  const tabs = useAgentChatTabs({
    workspaceRoot: workspace.path,
    newChatTitle: t("agent.header.newChat"),
    closeController,
  });

  useImperativeHandle(ref, () => ({ newSession: tabs.createTab }), [tabs.createTab]);
  useEffect(() => {
    onRunningChange?.(tabs.running);
  }, [onRunningChange, tabs.running]);

  return (
    <AgentMarkdownEnvironmentProvider openExternalUrl={openExternalAgentUrl}>
      <section className="desktop-agent-workspace" aria-label={t("agent.panel.chat", { agent: t("agent.name") })}>
        <AgentSessionTabs
          tabs={tabs.tabs}
          activeTabId={tabs.activeTabId}
          onActivate={tabs.activateTab}
          onClose={(tabId) => { void tabs.closeTab(tabId); }}
          onCreate={tabs.createTab}
          createDisabled={!tabs.canCreate}
        />
        <div className="desktop-agent-tabpanels">
          {tabs.tabs.map((tab) => (
            <div
              key={tab.id}
              id={agentPanelId(tab.id)}
              className="desktop-agent-tabpanel"
              role="tabpanel"
              aria-labelledby={agentTabId(tab.id)}
              hidden={tab.id !== tabs.activeTabId}
            >
              <AgentTabHost
                tabId={tab.id}
                active={active && tab.id === tabs.activeTabId}
                workspace={workspace}
                onPresentationChange={tabs.presentTab}
                onViewChanges={onViewChanges}
                onOpenFile={onOpenFile}
                preferredRuntimeId={preferredRuntimeId}
                onPreferredRuntimeChange={onPreferredRuntimeChange}
                preferredRoute={preferredRoute}
                onPreferredRouteChange={onPreferredRouteChange}
                preferredModel={preferredModel}
                onPreferredModelChange={onPreferredModelChange}
                hiddenRuntimeIds={hiddenRuntimeIds}
              />
            </div>
          ))}
        </div>
      </section>
    </AgentMarkdownEnvironmentProvider>
  );
});

type AgentTabHostProps = Omit<RightAgentPanelProps, "onRunningChange"> & {
  tabId: string;
  onPresentationChange: (tabId: string, presentation: AgentChatTabPresentation) => void;
};

function AgentTabHost({
  tabId,
  active,
  workspace,
  onPresentationChange,
  ...panelProps
}: AgentTabHostProps) {
  const controller = useMemo(
    () => getAgentSessionController(workspace.path, getElectronAgentClient, tabId),
    [tabId, workspace.path],
  );
  const present = useCallback((presentation: AgentChatTabPresentation) => {
    onPresentationChange(tabId, presentation);
  }, [onPresentationChange, tabId]);

  return <AgentChatTabPanel
    {...panelProps}
    active={active}
    controller={controller}
    workspaceId={workspace.id}
    onPresentationChange={present}
    preferredRuntimeId={panelProps.preferredRuntimeId ?? null}
    preferredRoute={panelProps.preferredRoute ?? {}}
    preferredModel={panelProps.preferredModel ?? null}
    hiddenRuntimeIds={panelProps.hiddenRuntimeIds ?? []}
  />;
}
