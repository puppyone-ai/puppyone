import { codexInstallationDefinition } from "../../local-agent-installation/definitions/codex.mjs";
import { codexActivationRecipe } from "../../local-agent-activation/recipes/codex.mjs";
import { defineLocalAgent } from "../agent-definition.mjs";

export const codexAgent = defineLocalAgent({
  installation: codexInstallationDefinition,
  runtimeId: "codex", terminalRecipeId: "codex",
  setup: {
    strategy: "external-cli", publisher: "OpenAI",
    guideUrl: "https://developers.openai.com/codex/cli",
    platforms: ["darwin","linux","win32"], reviewedAt: "2026-09-19",
  },
  companion: { bundleId: "com.openai.codex" },
  provision: { kind: "managed-artifact", recipeFor: codexActivationRecipe },
});
