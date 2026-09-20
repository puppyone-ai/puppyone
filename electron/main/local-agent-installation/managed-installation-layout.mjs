import path from "node:path";

// Shared by discovery and the installer. Only our own stable public entrypoints
// are registered here; vendor artifact internals stay in activation recipes.
const entries = Object.freeze({ codex: "codex", cursor: "cursor-agent" });
export function managedInstallationRoot(homedir, installationId) {
  if (!Object.hasOwn(entries, installationId)) return null;
  return path.join(homedir, ".puppyone", "agent-runtimes", installationId);
}
export function managedInstallationCandidate({ homedir, platform }, installationId) {
  const root = managedInstallationRoot(homedir, installationId);
  return root && platform === "darwin" ? [{ path: path.join(root, "current", entries[installationId]), source: "product-fallback",
    ...(installationId === "cursor" ? { argsPrefix: ["--disable-auto-update"] } : {}) }] : [];
}
