import { describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyPluginSessionSecurity,
  buildPluginContentSecurityPolicy,
} from "../../../../electron/main/viewer-packs/plugin-session-security.mjs";
import { handlePluginRequest } from "../../../../electron/main/viewer-packs/plugin-protocol.mjs";
import {
  generateTestKeyPair,
  getPinnedViewerPackSigners,
} from "../../../../electron/main/viewer-packs/package-signature.mjs";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
describe("viewer pack security boundaries", () => {
  it("ships every main-process runtime import as a production dependency", async () => {
    const packageJson = JSON.parse(await fsp.readFile(path.join(repoRoot, "package.json"), "utf8"));
    expect(packageJson.dependencies.jszip).toBeTruthy();
    expect(packageJson.dependencies.semver).toBeTruthy();
    expect(packageJson.devDependencies.jszip).toBeUndefined();
  });
});
