import { createSetupRegistry } from "../local-agent-installation/setup/setup-registry.mjs";
import { defaultLocalAgentCatalog } from "../local-agent-catalog/catalog.mjs";
import { localAgentCapabilities } from "../local-agent-catalog/agent-definition.mjs";

export function createActivationRegistry({ platform = process.platform, arch = process.arch, catalog = defaultLocalAgentCatalog } = {}) {
  const agents = new Map(catalog.map(agent => [agent.installation.id, agent]));
  return new Map(createSetupRegistry(catalog).filter(route => route.platforms.includes(platform)).map(route => {
    const capabilities = localAgentCapabilities(agents.get(route.id), { platform, arch });
    return [route.id, Object.freeze({ ...route, recipe: capabilities.recipe })];
  }));
}
