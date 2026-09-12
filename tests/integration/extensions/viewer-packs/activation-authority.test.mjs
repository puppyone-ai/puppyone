import { describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createViewerPackHost } from "../../../../electron/main/viewer-packs/index.mjs";
import { createNativeSurfaceOcclusionCoordinator } from "../../../../electron/main/native-surfaces/occlusion-coordinator.mjs";
import {
  createPackageSignatureEnvelope,
  generateTestKeyPair,
  serializePackageSignatureEnvelope,
} from "../../../../electron/main/viewer-packs/package-signature.mjs";

async function makeSignedPack(keys) {
  const manifest = {
    schemaVersion: 1,
    id: "ai.puppyone.viewer.glb",
    publisher: "puppyone",
    version: "1.0.0",
    engines: { puppyone: ">=0.1.0 <1.0.0", viewerApi: "1" },
    activationEvents: ["onFileExtension:.glb"],
    viewer: { entry: "viewer.html", source: "range-resource", sources: ["local"], runtime: [] },
    formats: [{
      id: "glb",
      label: "GLB",
      extensions: [".glb"],
      mimeTypes: ["model/gltf-binary"],
      category: "binary",
      defaultViewer: "plugin:ai.puppyone.viewer.glb",
      editable: false,
    }],
    permissions: { currentDocument: ["metadata", "readRange"], relatedFiles: "none", network: [] },
  };
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest));
  zip.file("viewer.html", "<!doctype html><title>viewer</title>");
  const archiveBytes = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
  const signatureEnvelope = serializePackageSignatureEnvelope(createPackageSignatureEnvelope({
    privateKeyPem: keys.privateKeyPem,
    payloadBytes: archiveBytes,
    keyId: "puppyone-test-release",
    publisher: "puppyone",
  }));
  return { archiveBytes, signatureEnvelope };
}

function createFakeElectronSurface() {
  let webContentsId = 100;
  const loadedUrls = [];
  const createdViews = [];
  class FakeWebContentsView {
    constructor() {
      const listeners = new Map();
      this.webContents = {
        id: webContentsId++,
        loadURL: async (url) => { loadedUrls.push(url); },
        destroy() {},
        on(event, listener) { listeners.set(event, listener); },
        once(event, listener) { listeners.set(event, listener); },
        setWindowOpenHandler() {},
        setAudioMuted: (muted) => { this.audioMuted = muted; },
      };
      this.visible = true;
      createdViews.push(this);
    }
    setBounds() {}
    setVisible(visible) { this.visible = visible; }
  }
  const owner = {
    isDestroyed: () => false,
    getContentBounds: () => ({ width: 1200, height: 800 }),
    contentView: { addChildView() {}, removeChildView() {} },
  };
  return {
    WebContentsView: FakeWebContentsView,
    loadedUrls,
    createdViews,
    getOwnerWindow: () => owner,
    sessionFromPartition: () => ({
      setPermissionRequestHandler() {},
      setPermissionCheckHandler() {},
      on() {},
      webRequest: { onBeforeRequest() {} },
      protocol: { handle() {} },
      clearStorageData: async () => undefined,
    }),
  };
}

describe("viewer pack activation authority", () => {
  it("re-routes in main, preserving core ownership and exact local-file matching", async () => {
    const userDataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "vp-authority-data-"));
    const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "vp-authority-workspace-"));
    await fsp.writeFile(path.join(workspace, "notes.md"), "# core");
    await fsp.writeFile(path.join(workspace, "scene.glb"), Buffer.from("glTFpayload"));
    const keys = generateTestKeyPair();
    const surface = createFakeElectronSurface();
    const nativeSurfaceOcclusion = createNativeSurfaceOcclusionCoordinator();
    const host = createViewerPackHost({
      ...surface,
      userDataPath,
      appVersion: "0.1.2",
      isPackaged: false,
      trustedSigners: [{
        keyId: "puppyone-test-release",
        publisher: "puppyone",
        publicKeyPem: keys.publicKeyPem,
      }],
      nativeSurfaceOcclusion,
    });
    await host.installLocalPackageBytesForTest(await makeSignedPack(keys));

    await expect(host.activateDocumentSession({
      pluginId: "ai.puppyone.viewer.glb",
      rootPath: workspace,
      relativePath: "notes.md",
      ownerWebContentsId: 7,
    })).rejects.toThrow(/built-in|core/i);

    await expect(host.activateDocumentSession({
      pluginId: "ai.puppyone.viewer.not-installed",
      rootPath: workspace,
      relativePath: "scene.glb",
      ownerWebContentsId: 7,
    })).rejects.toThrow(/not an enabled match/i);

    const activated = await host.activateDocumentSession({
      pluginId: "ai.puppyone.viewer.glb",
      rootPath: workspace,
      relativePath: "scene.glb",
      ownerWebContentsId: 7,
      bounds: { x: 10, y: 10, width: 600, height: 400 },
    });
    expect(activated.pluginId).toBe("ai.puppyone.viewer.glb");
    expect(surface.loadedUrls[0]).toMatch(/^puppyone-plugin:\/\/ai\.puppyone\.viewer\.glb\//);
    expect(surface.createdViews[0].visible).toBe(true);
    nativeSurfaceOcclusion.setOwnerOccluded(7, true);
    expect(surface.createdViews[0].visible).toBe(false);
    nativeSurfaceOcclusion.setOwnerOccluded(7, false);
    expect(surface.createdViews[0].visible).toBe(true);
    host.destroyAllSessions();
  });
});
