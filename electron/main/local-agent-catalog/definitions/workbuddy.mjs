import { workBuddyChinaInstallationDefinition, workBuddyInternationalInstallationDefinition } from "../../local-agent-installation/definitions/workbuddy.mjs";
import { defineLocalAgent } from "../agent-definition.mjs";

function workBuddyAgent(installation, guideUrl) {
  return defineLocalAgent({
    installation, runtimeId: installation.id, terminalRecipeId: null,
    setup: { strategy: "app-bundled-runtime", publisher: installation.displayName,
      guideUrl, platforms: ["darwin"], reviewedAt: "2026-09-19" },
    companion: null, provision: { kind: "guided" },
  });
}
export const workBuddyChinaAgent = workBuddyAgent(workBuddyChinaInstallationDefinition,
  "https://www.codebuddy.cn/docs/workbuddy/FirstTask");
export const workBuddyInternationalAgent = workBuddyAgent(workBuddyInternationalInstallationDefinition,
  "https://www.codebuddy.ai/docs/workbuddy");
