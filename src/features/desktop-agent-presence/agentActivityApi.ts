import type { AgentActivityEvent, AgentActivitySnapshot } from "../../../shared/agent-activity-contract/types";

export const agentActivityApi = {
  subscribe: async (): Promise<AgentActivitySnapshot> => window.puppyoneDesktop?.subscribeAgentActivity?.() ?? {
    schemaVersion: 1 as const,
    activities: [] as const,
  },
  onEvent(listener: (event: AgentActivityEvent) => void) {
    return window.puppyoneDesktop?.onAgentActivityEvent?.(listener) ?? (() => undefined);
  },
  unsubscribe() {
    window.puppyoneDesktop?.unsubscribeAgentActivity?.();
  },
};

export type AgentActivityClient = typeof agentActivityApi;
