import path from "node:path";
import { managedInstallationCandidate } from "../managed-installation-layout.mjs";

export const cursorInstallationDefinition = Object.freeze({
  id: "cursor",
  displayName: "Cursor Agent",
  executableNames: Object.freeze(["cursor-agent", "agent", "cursor agent"]),
  candidatePaths: ({ homedir, platform }) => platform === "win32" ? [] : [...["cursor-agent", "agent"].map((name) => ({
    path: path.join(homedir, ".local", "bin", name), source: "product-fallback",
  })), ...managedInstallationCandidate({ homedir, platform }, "cursor")],
  identityPolicy: Object.freeze({
    requiredForInvocations: Object.freeze(["agent"]),
    pathFragments: Object.freeze(["cursor-agent", "/cursor/"]),
    fileMarkers: Object.freeze(["cursor-agent", "cursor_invoked_as"]),
  }),
});
