import {
  defineAgentRuntimeManifest,
  runtimeDescriptorFromManifest,
} from "../../runtime/agent-runtime-manifest.mjs";

export const WORKBUDDY_RUNTIME_MANIFEST = defineAgentRuntimeManifest({
  id: "workbuddy",
  displayName: "WorkBuddy",
  description: "The user's WorkBuddy account, models and native sessions through CodeBuddy Code ACP.",
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

export const WORKBUDDY_RUNTIME_DESCRIPTOR = runtimeDescriptorFromManifest(WORKBUDDY_RUNTIME_MANIFEST);
