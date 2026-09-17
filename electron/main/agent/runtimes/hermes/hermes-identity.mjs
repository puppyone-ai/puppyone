import {
  defineAgentRuntimeManifest,
  runtimeDescriptorFromManifest,
} from "../../runtime/agent-runtime-manifest.mjs";

export const HERMES_RUNTIME_MANIFEST = defineAgentRuntimeManifest({
  id: "hermes",
  displayName: "Hermes Agent",
  description: "The user's Hermes Agent providers, models and native sessions through its first-party ACP server.",
  iconKey: "hermes",
  priority: 20,
  execution: {
    kind: "local-process",
    distribution: "user-installed",
    controller: "bundled-adapter",
  },
  protocol: { kind: "acp", transport: "stdio-json-rpc" },
  integration: { kind: "native-protocol", adapter: "generic-acp" },
  trust: { level: "first-party", publisher: "Nous Research" },
  ownership: {
    harness: "runtime",
    credentials: ["runtime"],
    models: "runtime",
    billing: ["runtime"],
    session: "runtime",
  },
  source: "github.com/NousResearch/hermes-agent",
  compatibility: "hermes-acp",
});

export const HERMES_RUNTIME_DESCRIPTOR = runtimeDescriptorFromManifest(HERMES_RUNTIME_MANIFEST);
