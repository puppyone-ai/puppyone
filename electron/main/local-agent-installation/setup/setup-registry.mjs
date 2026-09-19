import { defaultLocalAgentInstallationRegistry } from "../installation-registry.mjs";

// Presence identifies a product, not its publisher signature or runtime readiness.
// Codex: github.com/openai/codex/blob/main/codex-rs/cli/src/desktop_app/mac.rs
// Cursor: official macOS app Info.plist, version 3.17.8. Reviewed 2026-09-19.
export const companionIdentities = Object.freeze([
  Object.freeze({ id: "codex", bundleId: "com.openai.codex" }),
  Object.freeze({ id: "cursor", bundleId: "com.todesktop.230313mzl4w4u92" }),
]);

// Guides only: no generic latest-version installer, shell string or private
// app path. Version/protocol compatibility stays with Runtime readiness.
const routes = [
  ["codex", "codex", "external-cli", "https://developers.openai.com/codex/cli", ["darwin", "linux", "win32"]],
  ["claude", "claude", "external-cli", "https://code.claude.com/docs/en/setup", ["darwin", "linux", "win32"]],
  ["cursor", "cursor", "external-cli", "https://cursor.com/docs/cli/installation", ["darwin", "linux"]],
  ["opencode", "opencode-native", "external-cli", "https://opencode.ai/docs", ["darwin", "linux", "win32"]],
  ["pi", "pi", "external-cli", "https://github.com/earendil-works/pi/tree/main/packages/coding-agent", ["darwin", "linux", "win32"]],
  ["workbuddy-china", "workbuddy-china", "app-bundled-runtime", "https://www.codebuddy.cn/docs/workbuddy/FirstTask", ["darwin"], null],
  ["workbuddy-international", "workbuddy-international", "app-bundled-runtime", "https://www.codebuddy.ai/docs/workbuddy", ["darwin"], null],
  ["hermes", "hermes", "companion-managed-runtime", "https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/README.md", ["darwin", "linux"]],
];

export const setupRegistry = Object.freeze(routes.map(([id, runtimeId, strategy, guideUrl, platforms, terminalRecipeId = id]) => {
  const installation = defaultLocalAgentInstallationRegistry.find((entry) => entry.id === id);
  if (!installation || new URL(guideUrl).protocol !== "https:") throw new Error("Invalid local Agent setup route.");
  return Object.freeze({
    id, installationId: id, runtimeId, terminalRecipeId,
    displayName: installation.displayName, strategy, guideUrl,
    platforms: Object.freeze(platforms), reviewedAt: "2026-09-19",
    companionId: companionIdentities.some((entry) => entry.id === id) ? id : null,
  });
}).sort((a, b) => a.displayName.localeCompare(b.displayName, "en") || a.id.localeCompare(b.id, "en")));

if (new Set(setupRegistry.map(({ id }) => id)).size !== setupRegistry.length) throw new Error("Duplicate setup route.");
