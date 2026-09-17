import { describe, expect, it } from "vitest";
import {
  AGENT_CHAT_CREATION_RECIPES,
  sortAgentChatCreationRecipesAlphabetically,
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
  it("orders the product catalog alphabetically by English display label", () => {
    expect(AGENT_CHAT_CREATION_RECIPES.map(({ label }) => label)).toEqual([
      "Claude Code",
      "Codex",
      "Cursor",
      "Hermes Agent",
      "OpenCode",
      "Pi",
      "WorkBuddy",
      "Workspace Agent",
    ]);
    expect(Object.isFrozen(AGENT_CHAT_CREATION_RECIPES)).toBe(true);
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
