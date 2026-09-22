import { defaultLocalAgentCatalog } from "../local-agent-catalog/catalog.mjs";
import { defineLocalAgentInstallation } from "./installation-definition.mjs";

/** Installation discovery consumes a projection, never setup or runtime work. */
export function createLocalAgentInstallationRegistry(definitions = defaultLocalAgentCatalog.map(agent => agent.installation)) {
  const seen = new Set();
  return Object.freeze(Array.from(definitions, definition => {
    const installation = defineLocalAgentInstallation(definition);
    if (seen.has(installation.id)) throw new Error(`Duplicate Local Agent installation id: ${installation.id}`);
    seen.add(installation.id);
    return installation;
  }));
}

export function getLocalAgentInstallationDefinition(agentId, registry = defaultLocalAgentInstallationRegistry) {
  return registry.find(({ id }) => id === agentId) ?? null;
}

export const defaultLocalAgentInstallationRegistry = createLocalAgentInstallationRegistry();
