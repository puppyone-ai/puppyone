import { WorkBuddyAcpAdapter } from "./workbuddy-acp-adapter.mjs";
import {
  WORKBUDDY_CHINA_CHANNEL,
  WORKBUDDY_INTERNATIONAL_CHANNEL,
  requireWorkBuddyChannel,
} from "./workbuddy-channels.mjs";
import { createWorkBuddyDiscovery } from "./workbuddy-discovery.mjs";
import { workBuddyRuntimeIdentity } from "./workbuddy-identity.mjs";

export {
  WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR,
  WORKBUDDY_CHINA_RUNTIME_MANIFEST,
  WORKBUDDY_INTERNATIONAL_RUNTIME_DESCRIPTOR,
  WORKBUDDY_INTERNATIONAL_RUNTIME_MANIFEST,
} from "./workbuddy-identity.mjs";

export function createWorkBuddyRuntimeDefinition(channelValue, {
  discovery,
  logger = console,
  appVersion = "0.0.0",
  adapterFactory = (options) => new WorkBuddyAcpAdapter(options),
} = {}) {
  const channel = requireWorkBuddyChannel(channelValue);
  const identity = workBuddyRuntimeIdentity(channel);
  return {
    manifest: identity.manifest,
    discovery: discovery ?? createWorkBuddyDiscovery(channel),
    createAdapter: ({ readiness, ...options }) => adapterFactory({
      ...options,
      readiness,
      appVersion,
      logger,
      channel,
      runtimeDescriptor: identity.descriptor,
    }),
  };
}

export function createWorkBuddyChinaRuntimeDefinition(options = {}) {
  return createWorkBuddyRuntimeDefinition(WORKBUDDY_CHINA_CHANNEL, options);
}

export function createWorkBuddyInternationalRuntimeDefinition(options = {}) {
  return createWorkBuddyRuntimeDefinition(WORKBUDDY_INTERNATIONAL_CHANNEL, options);
}
