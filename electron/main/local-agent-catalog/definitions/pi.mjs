import { piInstallationDefinition } from "../../local-agent-installation/definitions/pi.mjs";
import { defineLocalAgent } from "../agent-definition.mjs";

export const piAgent = defineLocalAgent({
  installation: piInstallationDefinition,
  runtimeId: "pi", terminalRecipeId: "pi",
  setup: {
    strategy: "external-cli", publisher: "Pi Agent",
    guideUrl: "https://github.com/earendil-works/pi/tree/main/packages/coding-agent",
    platforms: ["darwin","linux","win32"], reviewedAt: "2026-09-19",
  },
  companion: null,
  provision: { kind: "guided" },
});
