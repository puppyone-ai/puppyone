import type { LocalAgentsSettings } from "./localAgentSetupPreferences";

export function setTerminalAgentVisible(
  settings: LocalAgentsSettings,
  agentId: string,
  visible: boolean,
): LocalAgentsSettings {
  const hidden = new Set(settings.hiddenTerminalAgentIds);
  if (visible) hidden.delete(agentId);
  else hidden.add(agentId);
  return {
    ...settings,
    hiddenTerminalAgentIds: Array.from(hidden).sort((left, right) => left.localeCompare(right)),
  };
}

export function isTerminalAgentVisible(settings: LocalAgentsSettings, agentId: string) {
  return !settings.hiddenTerminalAgentIds.includes(agentId);
}
