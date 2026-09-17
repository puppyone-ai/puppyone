import { AgentRuntimeHost, AgentRuntimeRegistry } from "../runtime/agent-runtime-registry.mjs";
import { createClaudeRuntimeDefinition } from "../runtimes/claude/claude-runtime-definition.mjs";
import { createCodexRuntimeDefinition } from "../runtimes/codex/codex-runtime-definition.mjs";
import { createCursorRuntimeDefinition } from "../runtimes/cursor/cursor-runtime-definition.mjs";
import { createOpenCodeNativeRuntimeDefinition } from "../runtimes/opencode-native/opencode-native-runtime-definition.mjs";
import { createPiRuntimeDefinition } from "../runtimes/pi/pi-runtime-definition.mjs";
import { createWorkBuddyRuntimeDefinition } from "../runtimes/workbuddy/workbuddy-runtime-definition.mjs";

export const DEFAULT_AGENT_RUNTIME_ID = "codex";

/** The only production composition root that imports concrete Agent runtimes. */
export function createDefaultAgentRuntimeHost({
  logger = console,
  appVersion = "0.0.0",
  codex = {},
  claude = {},
  cursor = {},
  openCodeNative = {},
  pi = {},
  workBuddy = {},
} = {}) {
  const definitions = [
    createCodexRuntimeDefinition({ appVersion, ...codex }),
    createClaudeRuntimeDefinition({ appVersion, logger, ...claude }),
    createOpenCodeNativeRuntimeDefinition({ appVersion, logger, ...openCodeNative }),
    createPiRuntimeDefinition({ logger, ...pi }),
    createCursorRuntimeDefinition(cursor),
    createWorkBuddyRuntimeDefinition({ appVersion, logger, ...workBuddy }),
  ];
  return new AgentRuntimeHost(new AgentRuntimeRegistry(definitions, {
    defaultRuntimeId: DEFAULT_AGENT_RUNTIME_ID,
  }));
}
