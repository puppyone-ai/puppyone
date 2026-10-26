/** User-installed chat products, shared by Settings and the workbench launcher. */
const labelCollator = new Intl.Collator("en", { sensitivity: "base" });

const LOCAL_AGENT_ID_BY_RUNTIME_ID: Readonly<Record<string, string>> = Object.freeze({
  "opencode-native": "opencode",
});

export function localAgentIdForAgentChatRuntime(runtimeId: string) {
  return LOCAL_AGENT_ID_BY_RUNTIME_ID[runtimeId] ?? runtimeId;
}

export const LOCAL_AGENT_CHAT_RECIPES = Object.freeze([
  Object.freeze({ id: "claude", label: "Claude Code", iconKey: "claude", status: "available", availability: "local-installation" }),
  Object.freeze({ id: "codex", label: "Codex", iconKey: "codex", status: "available", availability: "local-installation" }),
  Object.freeze({ id: "cursor", label: "Cursor", iconKey: "cursor", status: "available", availability: "local-installation" }),
  Object.freeze({ id: "hermes", label: "Hermes Agent", iconKey: "hermes", status: "available", availability: "local-installation" }),
  Object.freeze({ id: "opencode-native", label: "OpenCode", iconKey: "opencode", status: "available", availability: "local-installation" }),
  Object.freeze({ id: "pi", label: "Pi", iconKey: "pi", status: "available", availability: "local-installation" }),
  Object.freeze({ id: "workbuddy-china", label: "WorkBuddy (China)", iconKey: "workbuddy", status: "available", availability: "local-installation" }),
  Object.freeze({ id: "workbuddy-international", label: "WorkBuddy (International)", iconKey: "workbuddy", status: "available", availability: "local-installation" }),
].sort((left, right) => labelCollator.compare(left.label, right.label) || labelCollator.compare(left.id, right.id)));

export const LOCAL_AGENT_CHAT_IDS = Object.freeze(
  LOCAL_AGENT_CHAT_RECIPES.map((recipe) => localAgentIdForAgentChatRuntime(recipe.id)),
);
