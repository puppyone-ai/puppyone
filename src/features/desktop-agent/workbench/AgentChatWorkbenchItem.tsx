import { useCallback, useMemo } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type {
  AuxiliaryWorkbenchItemRenderContext,
  AuxiliaryWorkbenchItemSnapshot,
  AuxiliaryWorkbenchProject,
} from "../../app-shell/auxiliary-workbench/types";
import type { AgentChatTabPresentation } from "../domain/agent-chat-presentation";
import { projectAgentControllers } from "./projectAgentControllers";
import type { AgentRoutePreference } from "../domain/agent-route-preference";
import { openExternalAgentUrl } from "../infrastructure/electron/electronAgentClient";
import { AgentChatTabPanel } from "../ui/AgentChatTabPanel";
import type { AgentWorkspaceReferenceResolver } from "../ui/useAgentReferenceIngestion";
import { AgentMarkdownEnvironmentProvider } from "../ui/markdown/AgentMarkdownEnvironment";
import "../ui/desktop-agent.css";

export type AgentChatWorkbenchItemProps = AuxiliaryWorkbenchItemRenderContext & Readonly<{
  hiddenRuntimeIds: readonly string[];
  onOpenFile?: (path: string) => void;
  onOpenModelConnections: () => void;
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
  onOpenModelConnections,
  onPreferredModelChange,
  onPreferredRouteChange,
  onPreferredRuntimeChange,
  onPresentationChange,
  preferredModel,
  preferredRoute,
  preferredRuntimeId,
  presentation,
  focusRequest,
  resolveWorkspaceReference,
}: AgentChatWorkbenchItemProps) {
  const { t } = useLocalization();
  const controller = useMemo(
    () => projectAgentControllers(project).get(item.id),
    [item.id, project],
  );
  const present = useCallback((agent: AgentChatTabPresentation) => {
    onPresentationChange(presentAgentChatWorkbenchItem(agent, t("agent.name")));
  }, [onPresentationChange, t]);
  return (
    <AgentMarkdownEnvironmentProvider openExternalUrl={openExternalAgentUrl}>
      <AgentChatTabPanel
        commandTarget={presentation.commandTarget}
        presented={presentation.presented}
        focusRequest={presentation.presented ? focusRequest : undefined}
        controller={controller}
        workspaceId={item.contextId}
        onPresentationChange={present}
        onOpenFile={onOpenFile}
        onOpenModelConnections={onOpenModelConnections}
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

export async function requestCloseAgentChatWorkbenchItem(project: AuxiliaryWorkbenchProject, itemId: string) {
  if (project.disposed) return true;
  return projectAgentControllers(project).close(itemId);
}

export function prepareAgentChatWorkbenchItem(
  project: AuxiliaryWorkbenchProject,
  itemId: string,
  runtimeId: string | null,
) {
  project.assertOpen();
  if (!runtimeId) return;
  const controller = projectAgentControllers(project).get(itemId);
  controller.beginInitializeForRuntime(runtimeId);
}

export async function restoreAgentChatWorkbenchItem(
  project: AuxiliaryWorkbenchProject,
  itemId: string,
  sessionId: string,
  runtimeId: string,
) {
  project.assertOpen();
  const controller = projectAgentControllers(project).get(itemId);
  await controller.openSavedSession(sessionId, runtimeId);
}

export async function discardPreparedAgentChatWorkbenchItem(project: AuxiliaryWorkbenchProject, itemId: string) {
  if (project.disposed) return;
  await projectAgentControllers(project).discard(itemId);
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
