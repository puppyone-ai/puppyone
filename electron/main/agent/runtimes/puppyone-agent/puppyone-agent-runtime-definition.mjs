import { createOpenCodeDiscovery } from "./managed-opencode-discovery.mjs";
import { OpenCodeAcpAdapter } from "../opencode-protocol/opencode-acp-adapter.mjs";
import {
  PUPPYONE_AGENT_RUNTIME_DESCRIPTOR,
  PUPPYONE_AGENT_RUNTIME_MANIFEST,
} from "./puppyone-agent-identity.mjs";

export function createPuppyOneAgentRuntimeDefinition({
  appPath = null,
  resourcesPath = process.resourcesPath,
  managedConfigDir = null,
  allowExternal = false,
  logger = console,
  appVersion = "0.0.0",
  discovery = createOpenCodeDiscovery({ appPath, resourcesPath, managedConfigDir, allowExternal }),
  adapterFactory = (options) => new OpenCodeAcpAdapter(options),
} = {}) {
  return {
    manifest: PUPPYONE_AGENT_RUNTIME_MANIFEST,
    discovery,
    createAdapter: ({ readiness, ...options }) => adapterFactory({
        ...options,
        readiness,
        appVersion,
        logger,
        runtimeDescriptor: PUPPYONE_AGENT_RUNTIME_DESCRIPTOR,
        managed: true,
    }),
  };
}
