import { defaultLocalAgentCatalog } from "../../local-agent-catalog/catalog.mjs";

/** Projections of one catalog; neither projection evaluates an install recipe. */
export function createSetupRegistry(catalog = defaultLocalAgentCatalog) {
  return Object.freeze(catalog.map(agent => Object.freeze({
    id: agent.installation.id, installationId: agent.installation.id,
    displayName: agent.installation.displayName,
    runtimeId: agent.runtimeId, terminalRecipeId: agent.terminalRecipeId,
    ...agent.setup,
    companionId: agent.companion ? agent.installation.id : null,
  })).sort((a, b) => a.displayName.localeCompare(b.displayName, "en") || a.id.localeCompare(b.id, "en")));
}

export function createCompanionIdentities(catalog = defaultLocalAgentCatalog) {
  return Object.freeze(catalog.filter(agent => agent.companion).map(agent => Object.freeze({
    id: agent.installation.id, ...agent.companion,
  })));
}

export const setupRegistry = createSetupRegistry();
export const companionIdentities = createCompanionIdentities();
