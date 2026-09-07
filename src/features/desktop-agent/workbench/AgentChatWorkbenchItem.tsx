import { useCallback, useMemo } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type {
  AuxiliaryWorkbenchItemRenderContext,
  AuxiliaryWorkbenchItemSnapshot,
  AuxiliaryWorkbenchProject,
} from "../../app-shell/auxiliary-workbench/types";
import {
  closeAgentSessionController,
  discardPreparedAgentSessionController,
  getAgentSessionController,
} from "../application/controllerRegistry";
import type { AgentChatTabPresentation } from "../domain/agent-chat-tabs";
import { AgentControllerRegistry } from "../application/AgentControllerRegistry";
import type { AgentRoutePreference } from "../domain/agent-route-preference";
import { createProjectAgentClientProvider, getElectronAgentClient, openExternalAgentUrl } from "../infrastructure/electron/electronAgentClient";
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
  preferredModel: string | null;
  preferredRoute: Readonly<AgentRoutePreference>;
  preferredRuntimeId: string | null;
  resolveWorkspaceReference?: AgentWorkspaceReferenceResolver;
}>;

export function AgentChatWorkbenchItem({
  hiddenRuntimeIds,
  item,
  project,
  onOpenFile,
  onPreferredModelChange,
  onPreferredRouteChange,
  onPreferredRuntimeChange,
  onPresentationChange,
  preferredModel,
  preferredRoute,
  preferredRuntimeId,
  presentation,
  resolveWorkspaceReference,
}: AgentChatWorkbenchItemProps) {
  const { t } = useLocalization();
  const controller = useMemo(
    () => getController(item.rootId, item.id, project),
    [item.id, item.rootId, project],
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

function projectRegistry(project: AuxiliaryWorkbenchProject) {
  return project.getResource("agent", () => new AgentControllerRegistry(project.context.rootPath, () => createProjectAgentClientProvider(project.context)));
}

function getController(rootId: string, itemId: string, project?: AuxiliaryWorkbenchProject) {
  return project ? projectRegistry(project).get(itemId) : getAgentSessionController(rootId, getElectronAgentClient, itemId);
}

export async function requestCloseAgentChatWorkbenchItem(rootId: string, itemId: string, project?: AuxiliaryWorkbenchProject) {
  return project ? projectRegistry(project).close(itemId) : closeAgentSessionController(rootId, itemId);
}

export function prepareAgentChatWorkbenchItem(
  rootId: string,
  itemId: string,
  runtimeId: string | null,
  project?: AuxiliaryWorkbenchProject,
) {
  project?.assertOpen();
  if (!runtimeId) return;
  const controller = getController(rootId, itemId, project);
  controller.beginInitializeForRuntime(runtimeId);
}

export async function restoreAgentChatWorkbenchItem(
  rootId: string,
  itemId: string,
  sessionId: string,
  runtimeId: string,
  project?: AuxiliaryWorkbenchProject,
) {
  project?.assertOpen();
  const controller = getController(rootId, itemId, project);
  await controller.openSavedSession(sessionId, runtimeId);
}

export async function discardPreparedAgentChatWorkbenchItem(rootId: string, itemId: string, project?: AuxiliaryWorkbenchProject) {
  if (project?.disposed) return;
  if (project) await projectRegistry(project).discard(itemId);
  else await discardPreparedAgentSessionController(rootId, itemId);
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
