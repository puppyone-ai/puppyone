import { useCallback, useMemo } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type {
  AuxiliaryWorkbenchItemRenderContext,
  AuxiliaryWorkbenchItemSnapshot,
} from "../../app-shell/auxiliary-workbench/types";
import {
  closeAgentSessionController,
  discardPreparedAgentSessionController,
  getAgentSessionController,
} from "../application/controllerRegistry";
import type { AgentChatTabPresentation } from "../domain/agent-chat-tabs";
import type { AgentRoutePreference } from "../domain/agent-route-preference";
import { getElectronAgentClient, openExternalAgentUrl } from "../infrastructure/electron/electronAgentClient";
import { AgentChatTabPanel } from "../ui/AgentChatTabPanel";
import type { AgentWorkspaceReferenceResolver } from "../ui/useAgentReferenceIngestion";
import { AgentMarkdownEnvironmentProvider } from "../ui/markdown/AgentMarkdownEnvironment";
import "../ui/desktop-agent.css";

export type AgentChatWorkbenchItemProps = AuxiliaryWorkbenchItemRenderContext & Readonly<{
  hiddenRuntimeIds: readonly string[];
  onOpenFile?: (path: string) => void;
  onPreferredModelChange?: (model: string) => void;
  onPreferredRouteChange?: (route: AgentRoutePreference) => void;
  onPreferredRuntimeChange?: (runtimeId: string | null) => void;
  onViewChanges?: () => void;
  preferredModel: string | null;
  preferredRoute: Readonly<AgentRoutePreference>;
  preferredRuntimeId: string | null;
  resolveWorkspaceReference?: AgentWorkspaceReferenceResolver;
}>;

export function AgentChatWorkbenchItem({
  hiddenRuntimeIds,
  item,
  onOpenFile,
  onPreferredModelChange,
  onPreferredRouteChange,
  onPreferredRuntimeChange,
  onPresentationChange,
  onViewChanges,
  preferredModel,
  preferredRoute,
  preferredRuntimeId,
  presentation,
  resolveWorkspaceReference,
}: AgentChatWorkbenchItemProps) {
  const { t } = useLocalization();
  const controller = useMemo(
    () => getAgentSessionController(item.rootId, getElectronAgentClient, item.id),
    [item.id, item.rootId],
  );
  const present = useCallback((agent: AgentChatTabPresentation) => {
    onPresentationChange(presentAgentChatWorkbenchItem(agent, t("agent.name")));
  }, [onPresentationChange, t]);
  return (
    <AgentMarkdownEnvironmentProvider openExternalUrl={openExternalAgentUrl}>
      <AgentChatTabPanel
        commandTarget={presentation.commandTarget}
        presented={presentation.presented}
        controller={controller}
        workspaceId={item.contextId}
        onPresentationChange={present}
        onViewChanges={onViewChanges}
        onOpenFile={onOpenFile}
        preferredRuntimeId={preferredRuntimeId}
        onPreferredRuntimeChange={onPreferredRuntimeChange}
        preferredRoute={preferredRoute}
        onPreferredRouteChange={onPreferredRouteChange}
        preferredModel={preferredModel}
        onPreferredModelChange={onPreferredModelChange}
        hiddenRuntimeIds={hiddenRuntimeIds}
        resolveWorkspaceReference={resolveWorkspaceReference}
      />
    </AgentMarkdownEnvironmentProvider>
  );
}

export async function requestCloseAgentChatWorkbenchItem(rootId: string, itemId: string) {
  return closeAgentSessionController(rootId, itemId);
}

export function prepareAgentChatWorkbenchItem(
  rootId: string,
  itemId: string,
  runtimeId: string | null,
) {
  if (!runtimeId) return;
  const controller = getAgentSessionController(rootId, getElectronAgentClient, itemId);
  controller.beginInitializeForRuntime(runtimeId);
}

export async function restoreAgentChatWorkbenchItem(
  rootId: string,
  itemId: string,
  sessionId: string,
  runtimeId: string,
) {
  const controller = getAgentSessionController(
    rootId,
    getElectronAgentClient,
    itemId,
  );
  await controller.openSavedSession(sessionId, runtimeId);
}

export async function discardPreparedAgentChatWorkbenchItem(rootId: string, itemId: string) {
  await discardPreparedAgentSessionController(rootId, itemId);
}

export function presentAgentChatWorkbenchItem(
  presentation: AgentChatTabPresentation,
  agentLabel: string,
): AuxiliaryWorkbenchItemSnapshot {
  const status = presentation.running
    ? "running"
    : presentation.statusCode === "checking"
      ? "starting"
      : presentation.statusCode === "needs-repair"
        ? "error"
        : "idle";
  const detail = presentation.runtimeLabel
    ? `${presentation.runtimeLabel} — ${presentation.statusCode}`
    : presentation.statusCode;
  return Object.freeze({
    title: presentation.title,
    accessibleLabel: [presentation.title, presentation.runtimeLabel ?? agentLabel, presentation.statusCode]
      .filter(Boolean)
      .join(" — "),
    detail,
    iconKey: presentation.runtimeIconKey,
    status,
    running: presentation.running,
    resourceId: presentation.sessionId,
  });
}
