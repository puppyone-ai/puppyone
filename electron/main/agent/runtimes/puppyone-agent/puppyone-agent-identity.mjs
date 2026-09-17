import {
  defineAgentRuntimeManifest,
  runtimeDescriptorFromManifest,
} from "../../runtime/agent-runtime-manifest.mjs";
import { PUPPYONE_PI_KERNEL } from "./puppyone-agent-kernel.mjs";
import {
  WORKSPACE_AGENT_DISPLAY_NAME,
  WORKSPACE_AGENT_ICON_KEY,
} from "./puppyone-agent-public-identity.mjs";

export const PUPPYONE_AGENT_RUNTIME_ID = "puppyone-agent";

export const PUPPYONE_AGENT_RUNTIME_MANIFEST = defineAgentRuntimeManifest({
  id: PUPPYONE_AGENT_RUNTIME_ID,
  displayName: WORKSPACE_AGENT_DISPLAY_NAME,
  description: `${WORKSPACE_AGENT_DISPLAY_NAME} is PuppyOne's managed coding Agent, powered by a pinned Pi SDK kernel.`,
  iconKey: WORKSPACE_AGENT_ICON_KEY,
  priority: 100,
  execution: {
    kind: "sdk-mediated-process",
    distribution: "bundled",
    controller: "bundled-sdk",
  },
  protocol: { kind: "rpc", transport: "stdio-jsonl" },
  integration: { kind: "managed-harness", adapter: "custom" },
  trust: { level: "bundled-verified", publisher: "PuppyOne" },
  ownership: {
    harness: "puppyone",
    credentials: ["puppyone", "user-provider"],
    models: "puppyone",
    billing: ["puppyone", "user-provider"],
    session: "puppyone",
  },
  source: "pinned-pi-sdk",
  compatibility: PUPPYONE_PI_KERNEL.protocol,
});

export const PUPPYONE_AGENT_RUNTIME_DESCRIPTOR = Object.freeze({
  ...runtimeDescriptorFromManifest(PUPPYONE_AGENT_RUNTIME_MANIFEST),
  upstream: PUPPYONE_PI_KERNEL,
});
