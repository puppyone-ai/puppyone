import type { AuxiliaryWorkbenchCreationRecipe } from "./types";

const AGENT_CHAT_RECIPE_LABEL_COLLATOR = new Intl.Collator("en", {
  sensitivity: "base",
});

const LOCAL_AGENT_ID_BY_RUNTIME_ID: Readonly<Record<string, string>> = Object.freeze({
  "opencode-native": "opencode",
});

export function compareAgentChatCreationRecipesAlphabetically(
  left: AuxiliaryWorkbenchCreationRecipe,
  right: AuxiliaryWorkbenchCreationRecipe,
) {
  return AGENT_CHAT_RECIPE_LABEL_COLLATOR.compare(left.label, right.label)
    || AGENT_CHAT_RECIPE_LABEL_COLLATOR.compare(left.id, right.id);
}

export function sortAgentChatCreationRecipesAlphabetically(
  recipes: readonly AuxiliaryWorkbenchCreationRecipe[],
) {
  return [...recipes].sort(compareAgentChatCreationRecipesAlphabetically);
}

export function localAgentIdForAgentChatRuntime(runtimeId: string) {
  return LOCAL_AGENT_ID_BY_RUNTIME_ID[runtimeId] ?? runtimeId;
}

export function filterAgentChatCreationRecipesByLocalAgentIds(
  recipes: readonly AuxiliaryWorkbenchCreationRecipe[],
  localAgentIds: readonly string[],
) {
  const visible = new Set(localAgentIds);
  return recipes.filter((recipe) => (
    recipe.availability === "bundled"
    || visible.has(localAgentIdForAgentChatRuntime(recipe.id))
  ));
}

/**
 * Product-owned Agent. Its managed Pi SDK kernel ships with PuppyOne and does
 * not participate in user-installed Agent discovery or visibility settings.
 */
export const WORKSPACE_AGENT_CREATION_RECIPE = Object.freeze({
  id: "puppyone-agent",
  label: "Workspace Agent",
  iconKey: "workspace-agent",
  status: "available",
  availability: "bundled",
} as const satisfies AuxiliaryWorkbenchCreationRecipe);

/** Registration order has no display semantics; the exported catalog is sorted below. */
const AGENT_CHAT_CREATION_RECIPE_REGISTRY = Object.freeze([
  WORKSPACE_AGENT_CREATION_RECIPE,
  Object.freeze({ id: "claude", label: "Claude Code", iconKey: "claude", status: "available", availability: "local-installation" }),
  Object.freeze({ id: "codex", label: "Codex", iconKey: "codex", status: "available", availability: "local-installation" }),
  Object.freeze({ id: "cursor", label: "Cursor", iconKey: "cursor", status: "available", availability: "local-installation" }),
  Object.freeze({ id: "hermes", label: "Hermes Agent", iconKey: "hermes", status: "available", availability: "local-installation" }),
  Object.freeze({ id: "opencode-native", label: "OpenCode", iconKey: "opencode", status: "available", availability: "local-installation" }),
  Object.freeze({ id: "pi", label: "Pi", iconKey: "pi", status: "available", availability: "local-installation" }),
  Object.freeze({ id: "workbuddy", label: "WorkBuddy", iconKey: "workbuddy", status: "available", availability: "local-installation" }),
] as const satisfies readonly AuxiliaryWorkbenchCreationRecipe[]);

/** Display catalog ordered by English label, independent of registration order. */
export const AGENT_CHAT_CREATION_RECIPES = Object.freeze(
  sortAgentChatCreationRecipesAlphabetically(AGENT_CHAT_CREATION_RECIPE_REGISTRY),
);

export const AGENT_CHAT_LOCAL_AGENT_IDS = Object.freeze(
  AGENT_CHAT_CREATION_RECIPES
    .filter((recipe) => recipe.availability !== "bundled")
    .map((recipe) => localAgentIdForAgentChatRuntime(recipe.id)),
);
