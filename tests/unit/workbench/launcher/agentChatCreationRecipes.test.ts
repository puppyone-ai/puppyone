import { describe, expect, it } from "vitest";
import {
  AGENT_CHAT_CREATION_RECIPES,
  BUILT_IN_AGENT_RUNTIME_ID,
  resolveAgentChatRuntimeVisibility,
  sortAgentChatCreationRecipesAlphabetically,
  sortAgentChatCreationRecipesForDisplay,
} from "../../../../src/features/app-shell/auxiliary-workbench/agentChatCreationRecipes";
import type { AuxiliaryWorkbenchCreationRecipe } from "../../../../src/features/app-shell/auxiliary-workbench/types";

function recipe(id: string, label: string): AuxiliaryWorkbenchCreationRecipe {
  return {
    id,
    label,
    iconKey: null,
    status: "available",
  };
}

describe("Agent Chat creation recipe ordering", () => {
  it("alphabetizes local products and keeps the bundled route last", () => {
    expect(AGENT_CHAT_CREATION_RECIPES.map(({ label }) => label)).toEqual([
      "Claude Code",
      "Codex",
      "Cursor",
      "Hermes Agent",
      "OpenCode",
      "Pi",
      "WorkBuddy (China)",
      "WorkBuddy (International)",
      "Built-in Agent",
    ]);
    expect(Object.isFrozen(AGENT_CHAT_CREATION_RECIPES)).toBe(true);
    expect(AGENT_CHAT_CREATION_RECIPES.find(({ id }) => id === "codex")).toMatchObject({
      label: "Codex",
      iconKey: "codex",
    });
  });

  it("does not couple bundled placement to its display name", () => {
    const bundled = { ...recipe("bundled", "Aardvark"), availability: "bundled" as const };
    const local = { ...recipe("local", "Zulu"), availability: "local-installation" as const };

    expect(sortAgentChatCreationRecipesForDisplay([bundled, local]).map(({ id }) => id))
      .toEqual(["local", "bundled"]);
  });

  it("hides Built-in Agent by default and exposes it only after experimental opt-in", () => {
    const disabled = resolveAgentChatRuntimeVisibility(AGENT_CHAT_CREATION_RECIPES, {
      hiddenLocalAgentIds: [],
      builtInAgentEnabled: false,
    });
    expect(disabled.activeRecipes.map(({ id }) => id)).not.toContain(BUILT_IN_AGENT_RUNTIME_ID);
    expect(disabled.hiddenRuntimeIds).toContain(BUILT_IN_AGENT_RUNTIME_ID);

    const enabled = resolveAgentChatRuntimeVisibility(AGENT_CHAT_CREATION_RECIPES, {
      hiddenLocalAgentIds: ["codex"],
      builtInAgentEnabled: true,
    });
    expect(enabled.activeRecipes.at(-1)?.id).toBe(BUILT_IN_AGENT_RUNTIME_ID);
    expect(enabled.activeRecipes.map(({ id }) => id)).not.toContain("codex");
    expect(enabled.hiddenRuntimeIds).toEqual(["codex"]);
  });

  it("sorts case-insensitively, uses id as a stable tie-breaker, and preserves the registry", () => {
    const registry = [
      recipe("zulu", "Zulu"),
      recipe("alpha-b", "alpha"),
      recipe("bravo", "Bravo"),
      recipe("alpha-a", "Alpha"),
    ];
    const originalOrder = [...registry];

    const sorted = sortAgentChatCreationRecipesAlphabetically(registry);

    expect(sorted.map(({ id }) => id)).toEqual([
      "alpha-a",
      "alpha-b",
      "bravo",
      "zulu",
    ]);
    expect(registry).toEqual(originalOrder);
    expect(sorted).not.toBe(registry);
  });
});
