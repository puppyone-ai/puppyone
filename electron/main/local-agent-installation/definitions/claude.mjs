import path from "node:path";

export const claudeInstallationDefinition = Object.freeze({
  id: "claude",
  displayName: "Claude Code",
  executableNames: Object.freeze(["claude"]),
  candidatePaths: ({ env, homedir, platform }) => {
    const executable = platform === "win32" ? "claude.exe" : "claude";
    const candidates = [
      env?.CLAUDE_CODE_PATH
        ? { path: env.CLAUDE_CODE_PATH, source: "environment-override" }
        : null,
      { path: path.join(homedir, ".claude", "local", executable), source: "product-fallback" },
    ].filter(Boolean);
    if (platform !== "win32") {
      for (const packageParent of [
        path.join(homedir, ".npm-global", "lib"),
        "/usr/local/lib",
        "/usr/lib",
      ]) {
        candidates.push({
          path: path.join(packageParent, "node_modules", "@anthropic-ai", "claude-code", "cli-wrapper.cjs"),
          source: "product-fallback",
        });
        candidates.push({
          path: path.join(packageParent, "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
          source: "product-fallback",
        });
      }
    }
    return candidates;
  },
});
