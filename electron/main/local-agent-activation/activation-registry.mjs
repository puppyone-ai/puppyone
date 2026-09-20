import { setupRegistry } from "../local-agent-installation/setup/setup-registry.mjs";
import { codexActivationRecipe } from "./recipes/codex.mjs";
import { cursorActivationRecipe } from "./recipes/cursor.mjs";

export function createActivationRegistry({ platform = process.platform, arch = process.arch } = {}) {
  const recipes = { codex: codexActivationRecipe(platform, arch), cursor: cursorActivationRecipe(platform, arch) };
  return new Map(setupRegistry.filter(route => route.platforms.includes(platform)).map(route => [route.id, Object.freeze({
    ...route,
    publisher: route.id === "codex" ? "OpenAI" : route.id === "cursor" ? "Cursor" : route.displayName,
    // Unsupported platforms retain the truthful guided route. Installation
    // never depends on a runtime authentication or protocol port.
    recipe: recipes[route.id] ?? null,
  })]));
}
