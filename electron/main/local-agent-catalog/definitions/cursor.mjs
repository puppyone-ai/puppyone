import { cursorInstallationDefinition } from "../../local-agent-installation/definitions/cursor.mjs";
import { cursorActivationRecipe } from "../../local-agent-activation/recipes/cursor.mjs";
import { defineLocalAgent } from "../agent-definition.mjs";

export const cursorAgent = defineLocalAgent({
  installation: cursorInstallationDefinition,
  runtimeId: "cursor", terminalRecipeId: "cursor",
  setup: {
    strategy: "external-cli", publisher: "Cursor",
    guideUrl: "https://cursor.com/docs/cli/installation",
    platforms: ["darwin","linux"], reviewedAt: "2026-09-19",
  },
  companion: { bundleId: "com.todesktop.230313mzl4w4u92" },
  provision: { kind: "managed-artifact", recipeFor: cursorActivationRecipe },
});
