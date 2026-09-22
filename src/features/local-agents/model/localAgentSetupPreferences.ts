import { LOCAL_AGENT_INSTALLATION_IDS } from "../../../../shared/local-agent-installation/types";
import type { LocalAgentSetupPreferences } from "../../../../shared/local-agent-installation/setup-types";

export const DEFAULT_SETUP_PREFERENCES: LocalAgentSetupPreferences = {
  enabled: true, dismissedSetupIds: [], snoozedUntil: {},
};

export function normalizeSetupPreferences(value: unknown): LocalAgentSetupPreferences {
  if (!value || typeof value !== "object") return DEFAULT_SETUP_PREFERENCES;
  const input = value as Partial<LocalAgentSetupPreferences>;
  const ids: readonly string[] = LOCAL_AGENT_INSTALLATION_IDS;
  return {
    enabled: input.enabled !== false,
    dismissedSetupIds: [...new Set(Array.isArray(input.dismissedSetupIds)
      ? input.dismissedSetupIds.filter((id) => ids.includes(id)) : [])],
    snoozedUntil: Object.fromEntries(Object.entries(input.snoozedUntil ?? {}).filter(([id, until]) =>
      ids.includes(id) && Number.isSafeInteger(until) && until >= 0)),
  };
}
