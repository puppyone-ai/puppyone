import path from "node:path";

export const claudeInstallationDefinition = Object.freeze({
  id: "claude",
  displayName: "Claude Code",
  executableNames: Object.freeze(["claude"]),
  candidatePaths: ({ env, homedir, platform }) => {
    const executable = platform === "win32" ? "claude.exe" : "claude";
    return [
      env?.CLAUDE_CODE_PATH
        ? { path: env.CLAUDE_CODE_PATH, source: "environment-override" }
        : null,
      { path: path.join(homedir, ".local", "bin", executable), source: "product-fallback" },
      { path: path.join(homedir, ".claude", "local", executable), source: "product-fallback" },
    ].filter(Boolean);
  },
});
