import { claudeInstallationDefinition } from "../../local-agent-installation/definitions/claude.mjs";
import { defineLocalAgent } from "../agent-definition.mjs";

export const claudeAgent = defineLocalAgent({
  installation: claudeInstallationDefinition,
  runtimeId: "claude", terminalRecipeId: "claude",
  setup: {
    strategy: "external-cli", publisher: "Claude Code",
    guideUrl: "https://code.claude.com/docs/en/setup",
    platforms: ["darwin","linux","win32"], reviewedAt: "2026-09-19",
  },
  companion: null,
  provision: { kind: "guided" },
});
