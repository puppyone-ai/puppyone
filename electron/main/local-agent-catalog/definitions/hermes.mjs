import { hermesInstallationDefinition } from "../../local-agent-installation/definitions/hermes.mjs";
import { defineLocalAgent } from "../agent-definition.mjs";

export const hermesAgent = defineLocalAgent({
  installation: hermesInstallationDefinition,
  runtimeId: "hermes", terminalRecipeId: "hermes",
  setup: {
    strategy: "companion-managed-runtime", publisher: "Hermes Agent",
    guideUrl: "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/README.md",
    platforms: ["darwin","linux"], reviewedAt: "2026-09-19",
  },
  companion: null,
  provision: { kind: "guided" },
});
