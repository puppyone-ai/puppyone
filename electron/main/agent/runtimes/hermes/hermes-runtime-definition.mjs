import { HermesAcpAdapter } from "./hermes-acp-adapter.mjs";
import { createHermesDiscovery } from "./hermes-discovery.mjs";
import {
  HERMES_RUNTIME_DESCRIPTOR,
  HERMES_RUNTIME_MANIFEST,
} from "./hermes-identity.mjs";

export { HERMES_RUNTIME_DESCRIPTOR, HERMES_RUNTIME_MANIFEST } from "./hermes-identity.mjs";

export function createHermesRuntimeDefinition({
  discovery = createHermesDiscovery(),
  logger = console,
  appVersion = "0.0.0",
  adapterFactory = (options) => new HermesAcpAdapter(options),
} = {}) {
  return {
    manifest: HERMES_RUNTIME_MANIFEST,
    discovery,
    createAdapter: ({ readiness, ...options }) => adapterFactory({
      ...options,
      readiness,
      appVersion,
      logger,
      runtimeDescriptor: HERMES_RUNTIME_DESCRIPTOR,
    }),
  };
}
