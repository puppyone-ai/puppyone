import { useDesktopPreference } from "../../../src/preferencesStore";
import { useDesktopAppearance } from "../../../src/features/settings/useDesktopAppearance";
import { selectAgentPreferredRoute } from "../../../src/features/settings/agentSlice";
export function usePreferenceSnapshot() {
  const state = useDesktopPreference(s => s);
  const appearance = useDesktopAppearance();
  const agentPreferredRoute = selectAgentPreferredRoute(state);
  return { ...state, ...appearance, agentPreferredRoute,
    agentPreferredRuntime: state.agentRoutingPreferences.selectedRuntimeId,
    agentPreferredModel: agentPreferredRoute.modelId ?? null,
    terminalToolEnabled: state.rightSidebarToolsSettings.enabled.terminal };
}
