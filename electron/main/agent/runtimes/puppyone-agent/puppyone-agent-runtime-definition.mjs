import { PuppyOneAgentAdapter } from "./puppyone-agent-adapter.mjs";
import { createPuppyOneAgentDiscovery } from "./puppyone-agent-discovery.mjs";
import {
  PUPPYONE_AGENT_RUNTIME_DESCRIPTOR,
  PUPPYONE_AGENT_RUNTIME_MANIFEST,
} from "./puppyone-agent-identity.mjs";

export function createPuppyOneAgentRuntimeDefinition({
  appPath,
  userDataPath,
  executablePath,
  logger = console,
  discovery = createPuppyOneAgentDiscovery({ appPath, userDataPath, executablePath }),
  adapterFactory = (options) => new PuppyOneAgentAdapter(options),
} = {}) {
  return {
    manifest: PUPPYONE_AGENT_RUNTIME_MANIFEST,
    discovery,
    createAdapter: ({ readiness, ...options }) => adapterFactory({
        ...options,
        readiness,
        logger,
        runtimeDescriptor: PUPPYONE_AGENT_RUNTIME_DESCRIPTOR,
    }),
  };
}
