import path from "node:path";

export const piInstallationDefinition = Object.freeze({
  id: "pi",
  displayName: "Pi Agent",
  executableNames: Object.freeze(["pi"]),
  candidatePaths: ({ env, homedir, platform }) => {
    const executable = platform === "win32" ? "pi.exe" : "pi";
    return [
      env?.PI_CODING_AGENT_DIR
        ? { path: path.join(env.PI_CODING_AGENT_DIR, "bin", executable), source: "product-fallback" }
        : null,
      env?.PI_MANAGED_INSTALL_ROOT
        ? { path: path.join(path.dirname(env.PI_MANAGED_INSTALL_ROOT), "bin", executable), source: "product-fallback" }
        : null,
      { path: path.join(homedir, ".pi", "agent", "bin", executable), source: "product-fallback" },
      { path: path.join(homedir, ".local", "bin", executable), source: "product-fallback" },
    ].filter(Boolean);
  },
  identityPolicy: Object.freeze({
    requiredForInvocations: Object.freeze(["pi"]),
    packageNames: Object.freeze([
      "@earendil-works/pi-coding-agent",
      "@mariozechner/pi-coding-agent",
    ]),
    pathFragments: Object.freeze([
      "/pi-coding-agent/",
      "/.pi/agent/bin/",
    ]),
    fileMarkers: Object.freeze(["pi_coding_agent", "pi-coding-agent"]),
  }),
});
