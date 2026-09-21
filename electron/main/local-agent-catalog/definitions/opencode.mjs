import { opencodeInstallationDefinition } from "../../local-agent-installation/definitions/opencode.mjs";
import { defineLocalAgent } from "../agent-definition.mjs";

export const opencodeAgent = defineLocalAgent({
  installation: opencodeInstallationDefinition,
  runtimeId: "opencode-native", terminalRecipeId: "opencode",
  setup: {
    strategy: "external-cli", publisher: "OpenCode",
    guideUrl: "https://opencode.ai/docs",
    platforms: ["darwin","linux","win32"], reviewedAt: "2026-09-19",
  },
  companion: null,
  provision: { kind: "guided" },
});
