import type { AuxiliaryWorkbenchPreparationContext, AuxiliaryWorkbenchProject } from "../app-shell/auxiliary-workbench/types";
import { parseAgentChatHistoryTarget } from "./domain/agent-chat-history-target";
export { isDesktopAgentChatEnabled } from "./featureGate";
export { resolveAgentWorkspaceProviderPath } from "./domain/agent-workspace-path";

/** Public lazy entrypoint for the experimental Agent Chat renderer. */
export function loadRightAgentPanel() {
  return import("./ui/RightAgentPanel").then(({ RightAgentPanel }) => ({ default: RightAgentPanel }));
}

let workbenchItemModule: ReturnType<typeof importAgentChatWorkbenchItem> | null = null;
let resolvedWorkbenchItemModule: Awaited<ReturnType<typeof importAgentChatWorkbenchItem>> | null = null;

export function loadAgentChatWorkbenchItem() {
  return getAgentChatWorkbenchItemModule().then((module) => ({
    default: module.AgentChatWorkbenchItem,
  }));
}

export function loadAgentChatHistoryBrowser() {
  return import("./workbench/AgentChatHistoryBrowser").then(({ AgentChatHistoryBrowser }) => ({
    default: AgentChatHistoryBrowser,
  }));
}

export async function prepareAgentChatWorkbenchItem(context: AuxiliaryWorkbenchPreparationContext) {
  const module = await getAgentChatWorkbenchItemModule();
  context.project?.assertOpen();
  if (context.historyTarget) {
    const target = parseAgentChatHistoryTarget(context.historyTarget);
    if (!target) throw new Error("Invalid Agent chat history target.");
    await module.restoreAgentChatWorkbenchItem(
      context.item.rootId,
      context.item.id,
      target.sessionId,
      target.runtimeId,
      context.project,
    );
    return;
  }
  await module.prepareAgentChatWorkbenchItem(
    context.item.rootId,
    context.item.id,
    context.recipe?.id ?? null,
    context.project,
  );
}

export async function discardPreparedAgentChatWorkbenchItem(
  context: AuxiliaryWorkbenchPreparationContext,
) {
  await resolvedWorkbenchItemModule?.discardPreparedAgentChatWorkbenchItem(
    context.item.rootId,
    context.item.id,
    context.project,
  );
}

export async function closeAgentChatWorkbenchItem(rootId: string, itemId: string, project?: AuxiliaryWorkbenchProject) {
  const module = await getAgentChatWorkbenchItemModule();
  return module.requestCloseAgentChatWorkbenchItem(rootId, itemId, project);
}

function getAgentChatWorkbenchItemModule() {
  if (!workbenchItemModule) {
    const pendingModule = importAgentChatWorkbenchItem();
    workbenchItemModule = pendingModule
      .then((module) => {
        resolvedWorkbenchItemModule = module;
        return module;
      })
      .catch((error: unknown) => {
        // A stale renderer chunk or transient read failure must not poison every
        // later Chat creation attempt for the lifetime of the window.
        workbenchItemModule = null;
        throw error;
      });
  }
  return workbenchItemModule;
}

function importAgentChatWorkbenchItem() {
  return import("./workbench/AgentChatWorkbenchItem");
}
