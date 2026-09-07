import { createPiDiscovery } from "./pi-discovery.mjs";
import { PiRpcAdapter } from "./pi-rpc-adapter.mjs";
import { PI_RUNTIME_DESCRIPTOR, PI_RUNTIME_MANIFEST } from "./pi-identity.mjs";

export { PI_RUNTIME_DESCRIPTOR, PI_RUNTIME_MANIFEST } from "./pi-identity.mjs";

export function createPiRuntimeDefinition({
  discovery = createPiDiscovery(),
  logger = console,
  adapterFactory = (options) => new PiRpcAdapter(options),
} = {}) {
  return {
    manifest: PI_RUNTIME_MANIFEST,
    discovery,
    createAdapter: ({ readiness, ...options }) => adapterFactory({
        ...options,
        readiness,
        logger,
        runtimeDescriptor: PI_RUNTIME_DESCRIPTOR,
    }),
  };
}
