import { parseAgentRoutingPreferences, selectAgentRuntime, updateAgentRoutePreference, type AgentRoutePreference } from "../../agentRoutingPreferences";
import { parseLocalAgentsSettings } from "../../preferences";
import { applyPreferenceUpdate, type PreferenceSlice } from "./preferenceActions";
import type { AgentSlice } from "./preferenceTypes";

export const createAgentSlice: PreferenceSlice<AgentSlice> = (set, get) => ({
  localAgentsSettings: parseLocalAgentsSettings(null),
  setLocalAgentsSettings: (update) => set((state) => ({ localAgentsSettings: applyPreferenceUpdate(update, state.localAgentsSettings) })),
  agentFileActivityIndicatorsEnabled: false,
  setAgentFileActivityIndicatorsEnabled: (update) => set((state) => ({ agentFileActivityIndicatorsEnabled: applyPreferenceUpdate(update, state.agentFileActivityIndicatorsEnabled) })),
  agentRoutingPreferences: parseAgentRoutingPreferences(null),
  setAgentPreferredRuntime: (runtimeId) => set((state) => ({
    agentRoutingPreferences: selectAgentRuntime(state.agentRoutingPreferences, runtimeId),
  })),
  setAgentPreferredRoute: (patch) => set((state) => {
    const current = state.agentRoutingPreferences;
    return current.selectedRuntimeId ? {
      agentRoutingPreferences: updateAgentRoutePreference(current, current.selectedRuntimeId, patch),
    } : state;
  }),
  setAgentPreferredModel: (modelId) => get().setAgentPreferredRoute({ modelId: modelId ?? undefined }),
});

const EMPTY_ROUTE: Readonly<AgentRoutePreference> = Object.freeze({});
export function selectAgentPreferredRoute(state: AgentSlice): Readonly<AgentRoutePreference> {
  const { selectedRuntimeId, routes } = state.agentRoutingPreferences;
  return selectedRuntimeId ? routes[selectedRuntimeId] ?? EMPTY_ROUTE : EMPTY_ROUTE;
}
