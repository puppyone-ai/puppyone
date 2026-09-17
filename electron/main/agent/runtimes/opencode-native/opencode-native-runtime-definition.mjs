import { OpenCodeAcpAdapter } from "../opencode-protocol/opencode-acp-adapter.mjs";
import { createUserOpenCodeDiscovery } from "./opencode-native-discovery.mjs";
import {
  defineAgentRuntimeManifest,
  runtimeDescriptorFromManifest,
} from "../../runtime/agent-runtime-manifest.mjs";

export const OPENCODE_NATIVE_RUNTIME_MANIFEST = defineAgentRuntimeManifest({
  id: "opencode-native",
  displayName: "OpenCode",
  description: "The user's OpenCode installation, profile, providers and native sessions.",
  iconKey: "opencode",
  priority: 30,
  execution: {
    kind: "local-process",
    distribution: "user-installed",
    controller: "bundled-adapter",
  },
  protocol: { kind: "acp", transport: "stdio-json-rpc" },
  integration: { kind: "native-protocol", adapter: "generic-acp" },
  trust: { level: "first-party", publisher: "Anomaly" },
  ownership: {
    harness: "runtime",
    credentials: ["user-provider"],
    models: "runtime",
    billing: ["user-provider"],
    session: "runtime",
  },
});

export const OPENCODE_NATIVE_RUNTIME_DESCRIPTOR = runtimeDescriptorFromManifest(OPENCODE_NATIVE_RUNTIME_MANIFEST);

export function createOpenCodeNativeRuntimeDefinition({
  discovery = createUserOpenCodeDiscovery(),
  logger = console,
  appVersion = "0.0.0",
  adapterFactory = (options) => new OpenCodeAcpAdapter(options),
} = {}) {
  return {
    manifest: OPENCODE_NATIVE_RUNTIME_MANIFEST,
    discovery,
    createAdapter: ({ readiness, ...options }) => adapterFactory({
        ...options,
        readiness,
        appVersion,
        logger,
        runtimeDescriptor: OPENCODE_NATIVE_RUNTIME_DESCRIPTOR,
    }),
  };
}
