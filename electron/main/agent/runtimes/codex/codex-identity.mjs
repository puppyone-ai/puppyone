import {
  defineAgentRuntimeManifest,
  runtimeDescriptorFromManifest,
} from "../../runtime/agent-runtime-manifest.mjs";

/** Codex keeps its product name while Agent Chat presents the ChatGPT mark. */
export const CODEX_RUNTIME_MANIFEST = defineAgentRuntimeManifest({
  id: "codex",
  displayName: "Codex",
  description: "Codex's native app-server, login, models, tools, approvals and sessions.",
  iconKey: "chatgpt",
  priority: 50,
  execution: {
    kind: "local-process",
    distribution: "user-installed",
    controller: "bundled-adapter",
  },
  protocol: { kind: "app-server", transport: "stdio-json-rpc" },
  integration: { kind: "specialized-native", adapter: "specialized" },
  trust: { level: "first-party", publisher: "OpenAI" },
  ownership: {
    harness: "runtime",
    credentials: ["runtime"],
    models: "runtime",
    billing: ["runtime"],
    session: "runtime",
  },
});

export const CODEX_RUNTIME_DESCRIPTOR = runtimeDescriptorFromManifest(CODEX_RUNTIME_MANIFEST);
