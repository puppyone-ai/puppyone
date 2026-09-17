import { describe, expect, it } from "vitest";
import {
  AGENT_CHAT_CREATION_RECIPES,
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
      "WorkBuddy",
      "Built-in Agent",
    ]);
    expect(Object.isFrozen(AGENT_CHAT_CREATION_RECIPES)).toBe(true);
  });

  it("does not couple bundled placement to its display name", () => {
    const bundled = { ...recipe("bundled", "Aardvark"), availability: "bundled" as const };
    const local = { ...recipe("local", "Zulu"), availability: "local-installation" as const };

    expect(sortAgentChatCreationRecipesForDisplay([bundled, local]).map(({ id }) => id))
      .toEqual(["local", "bundled"]);
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
