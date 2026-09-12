import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import packageMetadata from "../../../../package.json";
import {
  EXTERNAL_VIEWER_PACKS_DEV_ENV,
  EXTERNAL_VIEWER_PACKS_RENDERER_ARGUMENT,
  resolvePackagedExternalViewerPacksCapability,
  resolveViewerPackFeatureProfile,
} from "../../../../electron/main/viewer-packs/feature-profile.mjs";
import {
  getViewerPackPrivilegedSchemes,
  loadViewerPackRuntime,
} from "../../../../electron/main/viewer-packs/bootstrap.mjs";
import { evaluateViewerPackReleaseTrust } from "../../../../electron/main/viewer-packs/release-policy.mjs";

describe("external Viewer Pack product capability", () => {
  it("keeps the signed default product on the preset-viewers-only profile", () => {
    const profile = resolveViewerPackFeatureProfile({
      packageMetadata,
      environment: {},
      isPackaged: true,
    });
    expect(profile).toMatchObject({
      id: "preset-viewers-only",
      externalViewerPacks: false,
      rendererArguments: [],
    });
  });

  it("permits an explicit unpackaged override but ignores it in installed builds", () => {
    const environment = { [EXTERNAL_VIEWER_PACKS_DEV_ENV]: "1" };
    expect(resolveViewerPackFeatureProfile({
      packageMetadata,
      environment,
      isPackaged: false,
    })).toMatchObject({
      id: "external-viewer-packs",
      externalViewerPacks: true,
      rendererArguments: [EXTERNAL_VIEWER_PACKS_RENDERER_ARGUMENT],
    });
    expect(resolveViewerPackFeatureProfile({
      packageMetadata,
      environment,
      isPackaged: true,
    }).externalViewerPacks).toBe(false);
  });

  it("allows signed package metadata to opt a future release profile in", () => {
    expect(resolveViewerPackFeatureProfile({
      packageMetadata: { puppyoneCapabilities: { externalViewerPacks: true } },
      environment: {},
      isPackaged: true,
    }).externalViewerPacks).toBe(true);
  });

  it("omits the preload bridge by default and exposes it only for the main-issued profile", async () => {
    const source = await readFile(new URL("../../../../electron/preload.cjs", import.meta.url), "utf8");
    expect(runPreload(source, []).viewerPacks).toBeUndefined();
    expect(runPreload(source, [EXTERNAL_VIEWER_PACKS_RENDERER_ARGUMENT]).viewerPacks)
      .toMatchObject({
        getSnapshot: expect.any(Function),
        installLocal: expect.any(Function),
        activate: expect.any(Function),
      });
  });

  it("does not import or register the dormant runtime in the preset-only profile", async () => {
    let imports = 0;
    const importer = async () => {
      imports += 1;
      return {
        createViewerPackHost() {},
        registerViewerPackAppIpcHandlers() {},
        registerViewerPackPluginIpcHandlers() {},
      };
    };
    expect(getViewerPackPrivilegedSchemes(false)).toEqual([]);
    await expect(loadViewerPackRuntime(false, importer)).resolves.toBeNull();
    expect(imports).toBe(0);

    expect(getViewerPackPrivilegedSchemes(true).map(({ scheme }) => scheme)).toEqual([
      "puppyone-plugin",
      "puppyone-resource",
    ]);
    await expect(loadViewerPackRuntime(true, importer)).resolves.toMatchObject({
      createViewerPackHost: expect.any(Function),
    });
    expect(imports).toBe(1);
  });

  it("forbids builder metadata from changing the preflighted release profile", () => {
    expect(() => resolvePackagedExternalViewerPacksCapability({
      puppyoneCapabilities: { externalViewerPacks: false },
      build: { extraMetadata: { puppyoneCapabilities: { externalViewerPacks: true } } },
    })).toThrow(/cannot override/i);
  });

  it("skips signer enforcement by default and fails closed for an enabled release", () => {
    const script = fileURLToPath(new URL("../../../../scripts/check-viewer-pack-release.mjs", import.meta.url));
    const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
    const defaultResult = spawnSync(process.execPath, [script], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, [EXTERNAL_VIEWER_PACKS_DEV_ENV]: "0" },
    });
    expect(defaultResult.status).toBe(0);
    expect(defaultResult.stdout).toMatch(/skipped.*preset-viewers-only/i);
    expect(() => evaluateViewerPackReleaseTrust({
      externalViewerPacks: true,
      trustedSigners: [],
    })).toThrow(/failed.*production public signer/i);
    expect(evaluateViewerPackReleaseTrust({
      externalViewerPacks: true,
      trustedSigners: [{ keyId: "production" }],
    })).toEqual({ status: "passed", signerCount: 1 });
  });
});

function runPreload(source, additionalArguments) {
  let exposed = null;
  const context = {
    process: { argv: ["electron", "app", ...additionalArguments] },
    require: (specifier) => {
      if (specifier !== "electron") throw new Error(`Unexpected preload import: ${specifier}`);
      return {
        contextBridge: {
          exposeInMainWorld: (_name, value) => { exposed = value; },
        },
        ipcRenderer: {
          invoke: () => Promise.resolve(),
          on: () => undefined,
          removeListener: () => undefined,
          send: () => undefined,
        },
        webUtils: { getPathForFile: () => "" },
      };
    },
    console,
    Promise,
    Error,
  };
  vm.runInNewContext(source, context, { filename: "preload.cjs" });
  return exposed;
}
