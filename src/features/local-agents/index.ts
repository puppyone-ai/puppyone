export { LocalAgentsSettingsView } from "./setup/LocalAgentsSettingsView";
export { LocalAgentHooksSettingsSection } from "./setup/LocalAgentHooksSettingsView";
export { useLocalAgentInstallations } from "./installation/useLocalAgentInstallations";
export {
  isTerminalAgentVisible,
  setTerminalAgentVisible,
} from "./setup/localAgentSelection";
export { LocalAgentSetupSection } from "./setup/LocalAgentSetupSection";
export { normalizeSetupPreferences } from "./setup/localAgentSetupPreferences";
export type { LocalAgentsSettings } from "./setup/localAgentSetupPreferences";
export { normalizeAvailableLocalAgentIds } from "./installation/localAgentInstallationAvailability";
export type { LocalAgentInstallationDiscoveryPhase } from "./installation/localAgentInstallationAvailability";
export { LOCAL_AGENT_CHAT_RECIPES, localAgentIdForAgentChatRuntime } from "./setup/localAgentCatalog";
