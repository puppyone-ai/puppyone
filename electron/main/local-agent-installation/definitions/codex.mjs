import path from "node:path";
import { managedInstallationCandidate } from "../managed-installation-layout.mjs";

export const codexInstallationDefinition = Object.freeze({
  id: "codex",
  displayName: "Codex",
  executableNames: Object.freeze(["codex"]),
  candidatePaths: ({ env, homedir, platform }) => {
    const executable = executableName("codex", platform);
    return [
      env?.CODEX_PATH ? { path: env.CODEX_PATH, source: "environment-override" } : null,
      env?.CODEX_INSTALL_DIR
        ? { path: path.join(env.CODEX_INSTALL_DIR, executable), source: "product-fallback" }
        : null,
      platform === "win32" && env?.LOCALAPPDATA
        ? {
          path: path.join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin", executable),
          source: "product-fallback",
        }
        : null,
      { path: path.join(homedir, ".local", "bin", executable), source: "product-fallback" },
      ...managedInstallationCandidate({ homedir, platform }, "codex"),
    ].filter(Boolean);
  },
});

function executableName(name, platform) {
  return platform === "win32" ? `${name}.exe` : name;
}
