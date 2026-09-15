import path from "node:path";

export const piInstallationDefinition = Object.freeze({
  id: "pi",
  displayName: "Pi Agent",
  executableNames: Object.freeze(["pi"]),
  candidatePaths: ({ homedir, platform }) => [{
    path: path.join(homedir, ".hermes", "node", "bin", platform === "win32" ? "pi.exe" : "pi"),
    source: "product-fallback",
  }],
  identityPolicy: Object.freeze({
    requiredForInvocations: Object.freeze(["pi"]),
    packageNames: Object.freeze([
      "@earendil-works/pi-coding-agent",
      "@mariozechner/pi-coding-agent",
    ]),
    pathFragments: Object.freeze(["/pi-coding-agent/", "/.hermes/node/"]),
    fileMarkers: Object.freeze(["pi_coding_agent", "pi-coding-agent"]),
  }),
});
