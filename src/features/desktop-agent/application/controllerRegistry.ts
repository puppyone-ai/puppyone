import { AgentSessionController } from "./AgentSessionController";
import type { AgentClientProvider } from "./AgentClientPort";
import { clearAgentChatTabStateRegistryForTests } from "./agent-chat-tab-state-registry";

const controllers = new Map<string, AgentSessionController>();

/**
 * Workspace-and-tab-scoped controllers deliberately outlive presentation
 * switches. Hiding the Sidebar or another tab must never stop an Agent turn.
 */
export function getAgentSessionController(
  workspaceRoot: string,
  clientProvider: AgentClientProvider,
  tabId = "default",
) {
  const controllerKey = key(workspaceRoot, tabId);
  let controller = controllers.get(controllerKey);
  if (!controller) {
    controller = new AgentSessionController(workspaceRoot, clientProvider);
  }
  controllers.set(controllerKey, controller);
  return controller;
}

export async function closeAgentSessionController(workspaceRoot: string, tabId: string) {
  const controllerKey = key(workspaceRoot, tabId);
  const controller = controllers.get(controllerKey);
  if (!controller) return true;
  const closed = await controller.closeTabSession();
  if (!closed) return false;
  controller.dispose();
  controllers.delete(controllerKey);
  return true;
}

/** Rolls back resources prepared for a Workbench Item that never committed. */
export async function discardPreparedAgentSessionController(workspaceRoot: string, tabId: string) {
  const controllerKey = key(workspaceRoot, tabId);
  const controller = controllers.get(controllerKey);
  if (!controller) return;
  // Remove ownership before awaiting native shutdown. A concurrent reservation
  // for the same topology identity must never inherit the abandoned Controller.
  controllers.delete(controllerKey);
  await controller.rollbackPreparation();
}

function key(workspaceRoot: string, tabId: string) {
  return `${workspaceRoot}\u0000${tabId}`;
}

export function clearAgentControllerRegistryForTests() {
  for (const controller of controllers.values()) controller.dispose();
  controllers.clear();
  clearAgentChatTabStateRegistryForTests();
}
