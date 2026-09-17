import {
  defineAgentRuntimeManifest,
  runtimeDescriptorFromManifest,
} from "../../runtime/agent-runtime-manifest.mjs";
import { PUPPYONE_PI_KERNEL } from "./puppyone-agent-kernel.mjs";

export const PUPPYONE_AGENT_RUNTIME_ID = "puppyone-agent";

export const PUPPYONE_AGENT_RUNTIME_MANIFEST = defineAgentRuntimeManifest({
  id: PUPPYONE_AGENT_RUNTIME_ID,
  displayName: "PuppyOne Agent",
  description: "PuppyOne's managed coding Agent, powered by a pinned Pi SDK kernel.",
  iconKey: "puppyone-agent",
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
