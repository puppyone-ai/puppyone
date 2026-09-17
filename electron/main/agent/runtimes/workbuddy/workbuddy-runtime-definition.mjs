import { WorkBuddyAcpAdapter } from "./workbuddy-acp-adapter.mjs";
import { createWorkBuddyDiscovery } from "./workbuddy-discovery.mjs";
import {
  WORKBUDDY_RUNTIME_DESCRIPTOR,
  WORKBUDDY_RUNTIME_MANIFEST,
} from "./workbuddy-identity.mjs";

export { WORKBUDDY_RUNTIME_DESCRIPTOR, WORKBUDDY_RUNTIME_MANIFEST } from "./workbuddy-identity.mjs";

export function createWorkBuddyRuntimeDefinition({
  discovery = createWorkBuddyDiscovery(),
  logger = console,
  appVersion = "0.0.0",
  adapterFactory = (options) => new WorkBuddyAcpAdapter(options),
} = {}) {
  return {
    manifest: WORKBUDDY_RUNTIME_MANIFEST,
    discovery,
    createAdapter: ({ readiness, ...options }) => adapterFactory({
      ...options,
      readiness,
      appVersion,
      logger,
      runtimeDescriptor: WORKBUDDY_RUNTIME_DESCRIPTOR,
    }),
  };
}
