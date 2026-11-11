import {
  defineAgentRuntimeManifest,
  runtimeDescriptorFromManifest,
} from "../../runtime/agent-runtime-manifest.mjs";

export const CLAUDE_RUNTIME_MANIFEST = defineAgentRuntimeManifest({
  id: "claude",
  displayName: "Claude Agent",
  description: "Anthropic's official Agent SDK runtime using Claude Code's native authentication and billing.",
  iconKey: "claude",
  priority: 40,
  execution: {
    kind: "sdk-mediated-process",
    distribution: "user-installed",
    controller: "bundled-sdk",
  },
  protocol: { kind: "agent-sdk", transport: "in-process-sdk" },
  integration: { kind: "specialized-native", adapter: "specialized" },
  trust: { level: "first-party", publisher: "Anthropic" },
  ownership: {
    harness: "runtime",
    credentials: ["user-provider"],
    models: "runtime",
    billing: ["user-provider"],
    session: "runtime",
  },
});

export const CLAUDE_RUNTIME_DESCRIPTOR = runtimeDescriptorFromManifest(CLAUDE_RUNTIME_MANIFEST);
