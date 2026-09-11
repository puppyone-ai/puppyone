import { useCallback, useMemo } from "react";
import type { AuxiliaryWorkbenchProject } from "../../app-shell/auxiliary-workbench/types";
import type { ItemHostEvent } from "../../../../shared/item-host-contract/types";
import { HostedItemView } from "../../app-shell/auxiliary-workbench/host/HostedItemView";
import { projectItemHosts } from "../../app-shell/auxiliary-workbench/host/HostedItemPool";
import type { AgentChatWorkbenchItemProps } from "./AgentChatWorkbenchItem";
import type { AgentRoutePreference } from "../domain/agent-route-preference";
import { createHostedReferencePreview } from "./hostedReferencePreview";

export function AgentChatWorkbenchItem(props: AgentChatWorkbenchItemProps) {
  const bridge = projectItemHosts(props.project).get(props.item.id)!.bridge;
  const { hiddenRuntimeIds, preferredModel, preferredRoute, preferredRuntimeId, onOpenFile,
    onPreferredModelChange, onPreferredRouteChange, onPreferredRuntimeChange, resolveWorkspaceReference } = props;
  const settings = useMemo(() => ({ hiddenRuntimeIds, preferredModel, preferredRoute, preferredRuntimeId }),
    [hiddenRuntimeIds, preferredModel, preferredRoute, preferredRuntimeId]);
  const onEvent = useCallback((event: ItemHostEvent) => {
    if (event.type === "open-file" && typeof event.payload === "string") onOpenFile?.(event.payload);
    if (event.type === "preferred-model" && typeof event.payload === "string") onPreferredModelChange?.(event.payload);
    if (event.type === "preferred-runtime" && (event.payload === null || typeof event.payload === "string")) onPreferredRuntimeChange?.(event.payload);
    if (event.type === "preferred-route" && event.payload && typeof event.payload === "object") onPreferredRouteChange?.(event.payload as AgentRoutePreference);
    if (event.type === "resolve-reference") {
      const request = event.payload as { requestId: string; value: string };
      void Promise.resolve(resolveWorkspaceReference?.(request.value)).then(async (result) => {
        const preview = await result?.loadVisualPreview?.();
        try {
          bridge.respond({ itemId: props.item.id, requestId: request.requestId,
            value: result ? { workspaceRoot: result.workspaceRoot, referencePath: result.referencePath,
              previewUrl: preview?.url ? await createHostedReferencePreview(preview.url) : null } : null });
        } finally { preview?.release?.(); }
      }).catch((error: Error) => bridge.respond({ itemId: props.item.id, requestId: request.requestId, error: error.message }));
    }
  }, [bridge, onOpenFile, onPreferredModelChange, onPreferredRouteChange, onPreferredRuntimeChange, props.item.id, resolveWorkspaceReference]);
  return <HostedItemView {...props} settings={settings} onEvent={onEvent} />;
}

export async function prepareAgentChatWorkbenchItem(project: AuxiliaryWorkbenchProject, itemId: string, runtimeId: string | null) {
  await projectItemHosts(project).prepare(itemId, "agent", { recipeId: runtimeId });
}
export async function restoreAgentChatWorkbenchItem(project: AuxiliaryWorkbenchProject, itemId: string, sessionId: string, runtimeId: string) {
  await projectItemHosts(project).prepare(itemId, "agent", { historyTarget: { sessionId, runtimeId } });
}
export const discardPreparedAgentChatWorkbenchItem = (project: AuxiliaryWorkbenchProject, itemId: string) => projectItemHosts(project).close(itemId);
export const requestCloseAgentChatWorkbenchItem = (project: AuxiliaryWorkbenchProject, itemId: string) => projectItemHosts(project).close(itemId);
