import {
  defineAgentRuntimeManifest,
  runtimeDescriptorFromManifest,
} from "../../runtime/agent-runtime-manifest.mjs";
import {
  WORKBUDDY_CHINA_CHANNEL,
  WORKBUDDY_INTERNATIONAL_CHANNEL,
  requireWorkBuddyChannel,
} from "./workbuddy-channels.mjs";

function createWorkBuddyRuntimeManifest(channelValue) {
  const channel = requireWorkBuddyChannel(channelValue);
  return defineAgentRuntimeManifest({
    id: channel.id,
    displayName: channel.displayName,
    description: `The user's ${channel.displayName} account, models and native sessions through CodeBuddy Code ACP.`,
    iconKey: "workbuddy",
    priority: 20,
    execution: {
      kind: "local-process",
      distribution: "user-installed",
      controller: "bundled-adapter",
    },
    protocol: { kind: "acp", transport: "stdio-json-rpc" },
    integration: { kind: "native-protocol", adapter: "generic-acp" },
    trust: { level: "first-party", publisher: "Tencent" },
    ownership: {
      harness: "runtime",
      credentials: ["runtime"],
      models: "runtime",
      billing: ["runtime"],
      session: "runtime",
    },
  });
}

export const WORKBUDDY_CHINA_RUNTIME_MANIFEST = createWorkBuddyRuntimeManifest(WORKBUDDY_CHINA_CHANNEL);
export const WORKBUDDY_INTERNATIONAL_RUNTIME_MANIFEST = createWorkBuddyRuntimeManifest(WORKBUDDY_INTERNATIONAL_CHANNEL);

export const WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR = runtimeDescriptorFromManifest(WORKBUDDY_CHINA_RUNTIME_MANIFEST);
export const WORKBUDDY_INTERNATIONAL_RUNTIME_DESCRIPTOR = runtimeDescriptorFromManifest(WORKBUDDY_INTERNATIONAL_RUNTIME_MANIFEST);

export function workBuddyRuntimeIdentity(channelValue) {
  const channel = requireWorkBuddyChannel(channelValue);
  return channel.id === WORKBUDDY_CHINA_CHANNEL.id
    ? { manifest: WORKBUDDY_CHINA_RUNTIME_MANIFEST, descriptor: WORKBUDDY_CHINA_RUNTIME_DESCRIPTOR }
    : { manifest: WORKBUDDY_INTERNATIONAL_RUNTIME_MANIFEST, descriptor: WORKBUDDY_INTERNATIONAL_RUNTIME_DESCRIPTOR };
}
