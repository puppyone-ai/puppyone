import path from "node:path";

export const hermesInstallationDefinition = Object.freeze({
  id: "hermes",
  displayName: "Hermes Agent",
  executableNames: Object.freeze(["hermes"]),
  candidatePaths: ({ homedir, platform }) => [{
    path: path.join(homedir, ".hermes", "bin", platform === "win32" ? "hermes.exe" : "hermes"),
    source: "product-fallback",
  }],
});
