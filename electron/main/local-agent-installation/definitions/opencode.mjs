import path from "node:path";

export const opencodeInstallationDefinition = Object.freeze({
  id: "opencode",
  displayName: "OpenCode",
  executableNames: Object.freeze(["opencode"]),
  candidatePaths: ({ homedir, platform }) => [{
    path: path.join(homedir, ".opencode", "bin", platform === "win32" ? "opencode.exe" : "opencode"),
    source: "product-fallback",
  }],
});
