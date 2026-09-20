import { defineLocalAgent } from "./agent-definition.mjs";
import { codexAgent } from "./definitions/codex.mjs";
import { claudeAgent } from "./definitions/claude.mjs";
import { cursorAgent } from "./definitions/cursor.mjs";
import { opencodeAgent } from "./definitions/opencode.mjs";
import { piAgent } from "./definitions/pi.mjs";
import { workBuddyChinaAgent, workBuddyInternationalAgent } from "./definitions/workbuddy.mjs";
import { hermesAgent } from "./definitions/hermes.mjs";

/** One trusted product composition. Runtime factories stay in their own host. */
export function createLocalAgentCatalog(definitions) {
  const ids = new Set(); const runtimes = new Set(); const terminals = new Set(); const companions = new Set();
  return Object.freeze(Array.from(definitions, value => {
    const agent = defineLocalAgent(value);
    for (const [set, id] of [[ids, agent.installation.id], [runtimes, agent.runtimeId],
      [terminals, agent.terminalRecipeId], [companions, agent.companion?.bundleId]]) {
      if (id == null) continue;
      if (set.has(id)) throw new TypeError(`Duplicate Local Agent mapping: ${id}`);
      set.add(id);
    }
    return agent;
  }));
}

export const defaultLocalAgentCatalog = createLocalAgentCatalog([
  codexAgent, claudeAgent, cursorAgent, opencodeAgent, piAgent,
  workBuddyChinaAgent, workBuddyInternationalAgent, hermesAgent,
]);
