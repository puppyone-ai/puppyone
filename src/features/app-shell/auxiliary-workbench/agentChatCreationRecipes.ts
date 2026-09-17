import type { AuxiliaryWorkbenchCreationRecipe } from "./types";

const LOCAL_AGENT_ID_BY_RUNTIME_ID: Readonly<Record<string, string>> = Object.freeze({
  "opencode-native": "opencode",
});

export function localAgentIdForAgentChatRuntime(runtimeId: string) {
  return LOCAL_AGENT_ID_BY_RUNTIME_ID[runtimeId] ?? runtimeId;
}

export function filterAgentChatCreationRecipesByLocalAgentIds(
  recipes: readonly AuxiliaryWorkbenchCreationRecipe[],
  localAgentIds: readonly string[],
) {
  const visible = new Set(localAgentIds);
  return recipes.filter((recipe) => visible.has(localAgentIdForAgentChatRuntime(recipe.id)));
}

/**
 * Reserved product definition for a future launch. It is intentionally absent
 * from both the production runtime registry and the customer-facing recipes.
 */
export const PUPPYONE_AGENT_CREATION_RECIPE = Object.freeze({
  id: "puppyone-agent",
  label: "PuppyOne",
  iconKey: "puppyone-agent",
  status: "coming-soon",
} as const satisfies AuxiliaryWorkbenchCreationRecipe);

/** Composition-owned product order for recipes currently exposed in the launcher. */
export const AGENT_CHAT_CREATION_RECIPES = Object.freeze([
  Object.freeze({ id: "codex", label: "Codex", iconKey: "codex", status: "available" }),
  Object.freeze({ id: "claude", label: "Claude Code", iconKey: "claude", status: "available" }),
  Object.freeze({ id: "cursor", label: "Cursor", iconKey: "cursor", status: "available" }),
  Object.freeze({ id: "workbuddy", label: "WorkBuddy", iconKey: "workbuddy", status: "available" }),
  Object.freeze({ id: "hermes", label: "Hermes Agent", iconKey: "hermes", status: "available" }),
  Object.freeze({ id: "opencode-native", label: "OpenCode", iconKey: "opencode", status: "available" }),
  Object.freeze({ id: "pi", label: "Pi", iconKey: "pi", status: "available" }),
] as const satisfies readonly AuxiliaryWorkbenchCreationRecipe[]);

export const AGENT_CHAT_LOCAL_AGENT_IDS = Object.freeze(
  AGENT_CHAT_CREATION_RECIPES.map((recipe) => localAgentIdForAgentChatRuntime(recipe.id)),
);
