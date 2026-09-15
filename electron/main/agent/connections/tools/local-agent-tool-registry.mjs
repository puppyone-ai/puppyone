import { CODEX_LOCAL_TOOL } from "./codex-tool.mjs";
import { CLAUDE_LOCAL_TOOL } from "./claude-tool.mjs";
import { CURSOR_LOCAL_TOOL } from "./cursor-tool.mjs";
import { OPENCODE_LOCAL_TOOL } from "./opencode-tool.mjs";
import { getLocalAgentInstallationDefinition } from "../../../local-agent-installation/installation-registry.mjs";

const DEFAULT_LOCAL_AGENT_TOOLS = Object.freeze([
  CODEX_LOCAL_TOOL,
  CLAUDE_LOCAL_TOOL,
  CURSOR_LOCAL_TOOL,
  OPENCODE_LOCAL_TOOL,
]);

export function createLocalAgentToolRegistry(descriptors = DEFAULT_LOCAL_AGENT_TOOLS) {
  const seen = new Set();
  return Object.freeze(Array.from(descriptors, (descriptor) => {
    validateDescriptor(descriptor);
    if (seen.has(descriptor.id)) throw new Error(`Duplicate local Agent tool descriptor: ${descriptor.id}`);
    seen.add(descriptor.id);
    const installationId = descriptor.installationId ?? (descriptor.id === "cursor-agent" ? "cursor" : descriptor.id);
    const installation = getLocalAgentInstallationDefinition(installationId) ?? customInstallation(descriptor);
    if (!installation) throw new Error(`Unknown Local Agent installation definition: ${installationId}`);
    return Object.freeze({
      id: descriptor.id,
      installationId,
      displayName: descriptor.displayName,
      executableNames: installation.executableNames,
      ...(installation.candidatePaths ? { candidatePaths: installation.candidatePaths } : {}),
      probe: descriptor.probe,
      unavailableMessage: descriptor.unavailableMessage,
    });
  }));
}

function validateDescriptor(descriptor) {
  if (!descriptor || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(descriptor.id)) {
    throw new TypeError("Local Agent tool descriptor id is invalid.");
  }
  if (typeof descriptor.displayName !== "string" || !descriptor.displayName.trim()) {
    throw new TypeError(`Local Agent tool ${descriptor.id} requires a display name.`);
  }
  if (typeof descriptor.probe !== "function") {
    throw new TypeError(`Local Agent tool ${descriptor.id} requires a probe.`);
  }
  if (typeof descriptor.unavailableMessage !== "string" || !descriptor.unavailableMessage.trim()) {
    throw new TypeError(`Local Agent tool ${descriptor.id} requires an unavailable-state message.`);
  }
}

export const localAgentToolRegistryDefaults = DEFAULT_LOCAL_AGENT_TOOLS;

function customInstallation(descriptor) {
  if (!Array.isArray(descriptor.executableNames) || descriptor.executableNames.length === 0) return null;
  return Object.freeze({
    executableNames: Object.freeze([...descriptor.executableNames]),
    ...(typeof descriptor.candidatePaths === "function" ? { candidatePaths: descriptor.candidatePaths } : {}),
  });
}
