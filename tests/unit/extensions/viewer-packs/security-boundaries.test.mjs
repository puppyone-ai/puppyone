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

  it("never accepts an environment-provided test signer in a packaged build", () => {
    const keys = generateTestKeyPair();
    const env = {
      PUPPYONE_VIEWER_PACK_TEST_PUBLIC_KEY: keys.publicKeyPem,
      PUPPYONE_VIEWER_PACK_TEST_KEY_ID: "puppyone-test-local",
      PUPPYONE_VIEWER_PACK_TEST_PUBLISHER: "puppyone-test",
    };
    expect(getPinnedViewerPackSigners({ env, allowTestKeys: true, isPackaged: true })).toEqual([]);
    expect(getPinnedViewerPackSigners({ env, allowTestKeys: true, isPackaged: false }))
      .toHaveLength(1);
  });

  it("injects a restrictive CSP and denies file/network requests in production", () => {
    const csp = buildPluginContentSecurityPolicy({ allowWasm: false, allowWorker: false });
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).not.toContain("wasm-unsafe-eval");

    let beforeRequest;
    const session = {
      setPermissionRequestHandler() {},
      setPermissionCheckHandler() {},
      on() {},
      webRequest: { onBeforeRequest(listener) { beforeRequest = listener; } },
    };
    applyPluginSessionSecurity(session, {
      pluginId: "ai.puppyone.viewer.glb",
      contentHash: "a".repeat(64),
      allowFileFallback: false,
    });
    const decisionFor = (url) => new Promise((resolve) => beforeRequest({ url }, resolve));
    return Promise.all([
      expect(decisionFor("file:///etc/passwd")).resolves.toEqual({ cancel: true }),
      expect(decisionFor("https://example.com/")).resolves.toEqual({ cancel: true }),
      expect(decisionFor(`puppyone-plugin://ai.puppyone.viewer.glb/${"a".repeat(64)}/viewer.html`))
        .resolves.toEqual({}),
    ]);
  });

  it("binds the asset protocol to the current plugin and attaches CSP", async () => {
    let reads = 0;
    const registryService = {
      readPackageFile: async () => {
        reads += 1;
        return {
          absolutePath: "/pack/viewer.html",
          sizeBytes: 2,
          bytes: Buffer.from("ok"),
        };
      },
    };
    const denied = await handlePluginRequest({
      request: new Request("puppyone-plugin://ai.puppyone.viewer.other/hash/viewer.html"),
      registryService,
      expectedPluginId: "ai.puppyone.viewer.glb",
      expectedContentHash: "hash",
      contentSecurityPolicy: "default-src 'none'",
    });
    expect(denied.status).toBe(404);
    expect(reads).toBe(0);

    const allowed = await handlePluginRequest({
      request: new Request("puppyone-plugin://ai.puppyone.viewer.glb/hash/viewer.html"),
      registryService,
      expectedPluginId: "ai.puppyone.viewer.glb",
      expectedContentHash: "hash",
      contentSecurityPolicy: "default-src 'none'; script-src 'self'",
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("Content-Security-Policy"))
      .toBe("default-src 'none'; script-src 'self'");
    expect(await allowed.text()).toBe("ok");
  });
});
