import type { AgentLocalConnectionsSnapshot } from "../../../../shared/agent-contract/types";

export function discoverLocalAgents(
  workspaceRoot: string,
  refresh: boolean,
): Promise<AgentLocalConnectionsSnapshot> {
  const discover = window.puppyoneDesktop?.discoverLocalAgentConnections;
  if (!discover) return Promise.reject(new Error("LOCAL_AGENT_INVENTORY_UNAVAILABLE"));
  return discover({ rootPath: workspaceRoot, refresh });
}
