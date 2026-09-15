import { describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { createViewerPackStore } from "../../../../electron/main/viewer-packs/store.mjs";
import { createViewerPackPackageService } from "../../../../electron/main/viewer-packs/package-service.mjs";
import { createViewerPackRegistryService } from "../../../../electron/main/viewer-packs/registry-service.mjs";
import {
  createPackageSignatureEnvelope,
  generateTestKeyPair,
  serializePackageSignatureEnvelope,
} from "../../../../electron/main/viewer-packs/package-signature.mjs";
import { extractAndValidateViewerPackArchive } from "../../../../electron/main/viewer-packs/archive-validator.mjs";

const HOST_VERSION = "0.1.2";
const manifest = {
  schemaVersion: 1,
  id: "ai.puppyone.viewer.glb",
  publisher: "puppyone",
  version: "1.0.0",
  engines: { puppyone: ">=0.1.0 <1.0.0", viewerApi: "1" },
  activationEvents: ["onFileExtension:.glb"],
  viewer: {
    entry: "viewer.html",
    source: "range-resource",
    sources: ["local"],
    runtime: [],
  },
  formats: [
    {
      id: "glb",
      label: "glTF Binary Scene",
      extensions: [".glb"],
      mimeTypes: ["model/gltf-binary"],
      category: "binary",
      defaultViewer: "plugin:ai.puppyone.viewer.glb",
      editable: false,
    },
  ],
  permissions: {
    currentDocument: ["metadata", "readRange"],
    relatedFiles: "none",
    network: [],
  },
};

async function buildArchive(files) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

function trustedSigner(keys) {
  return { keyId: "puppyone-test-release", publisher: "puppyone", publicKeyPem: keys.publicKeyPem };
}

function signArchive(keys, archiveBytes) {
  return serializePackageSignatureEnvelope(createPackageSignatureEnvelope({
    privateKeyPem: keys.privateKeyPem,
    payloadBytes: archiveBytes,
    keyId: "puppyone-test-release",
    publisher: "puppyone",
  }));
}

function createServices(userDataPath, keys, store = createViewerPackStore({ userDataPath })) {
  const getTrustedSigners = () => [trustedSigner(keys)];
  return {
    store,
    packages: createViewerPackPackageService({ store, getTrustedSigners, hostVersion: HOST_VERSION }),
    registry: createViewerPackRegistryService({ store, getTrustedSigners, hostVersion: HOST_VERSION }),
  };
}

describe("viewer pack package install", () => {
  it("installs the checked-in first-party fixture through the bounded file path", async () => {
    const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/extensions/viewer-packs");
    const archivePath = path.join(fixtureRoot, "ai.puppyone.viewer.glb-1.0.0.puppyplugin");
    const signaturePath = `${archivePath}.sig`;
    const publicKeyPem = await fsp.readFile(`${archivePath}.test-public-key.txt`, "utf8");
    const userDataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "vp-fixture-"));
    const store = createViewerPackStore({ userDataPath });
    const packages = createViewerPackPackageService({
      store,
      hostVersion: HOST_VERSION,
      getTrustedSigners: () => [{
        keyId: "puppyone-fixture-2026",
        publisher: "puppyone",
        publicKeyPem,
      }],
    });
    const installed = await packages.installFromFiles({ archivePath, signaturePath });
    expect(installed.pluginId).toBe(manifest.id);
  });

  it("rejects unsigned packages", async () => {
    const userDataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "vp-unsigned-"));
    const store = createViewerPackStore({ userDataPath });
    const packages = createViewerPackPackageService({
      store,
      getTrustedSigners: () => [],
      hostVersion: HOST_VERSION,
    });
    const archiveBytes = await buildArchive({
      "manifest.json": JSON.stringify(manifest),
      "viewer.html": "<html></html>",
    });
    await expect(packages.installFromBytes({
      archiveBytes,
      signatureEnvelope: "not-a-signature-envelope",
    })).rejects.toThrow(/signature/i);
  });

  it("rejects path traversal entries", async () => {
    const archiveBytes = await fsp.readFile(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/extensions/viewer-packs/traversal.puppyplugin"),
    );
    const destinationDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vp-trav-"));
    await expect(extractAndValidateViewerPackArchive({ archiveBytes, destinationDir }))
      .rejects.toThrow(/rejected|escape|traversal/i);
  });

  it("rejects absolute archive entry paths", async () => {
    const archiveBytes = await buildArchive({
      "manifest.json": JSON.stringify(manifest),
      "/tmp/escape.html": "nope",
      "viewer.html": "<html></html>",
    });
    const destinationDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vp-abs-"));
    await expect(extractAndValidateViewerPackArchive({ archiveBytes, destinationDir }))
      .rejects.toThrow(/rejected|absolute|escape/i);
  });

  it("installs into an immutable content-addressed directory and publishes a snapshot", async () => {
    const userDataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "vp-install-"));
    const keys = generateTestKeyPair();
    const { store, packages, registry } = createServices(userDataPath, keys);
    const archiveBytes = await buildArchive({
      "manifest.json": JSON.stringify(manifest),
      "viewer.html": "<!doctype html><title>glb</title>",
    });
    const result = await packages.installFromBytes({
      archiveBytes,
      signatureEnvelope: signArchive(keys, archiveBytes),
    });

    const snapshot = await registry.getContributionSnapshot();
    expect(snapshot.contributions).toHaveLength(1);
    expect(snapshot.contributions[0].label).toBe("glTF Binary Scene");
    expect(snapshot.contributions[0].contentHash).toBe(result.contentHash);

    const resolved = await registry.resolvePackageFile({
      pluginId: result.pluginId,
      contentHash: result.contentHash,
      relativePath: "viewer.html",
    });
    expect(resolved.absolutePath).toContain(
      path.join("packages", result.pluginId, result.version, result.contentHash),
    );
    expect((await fsp.stat(resolved.absolutePath)).mode & 0o222).toBe(0);

    await expect(registry.resolvePackageFile({
      pluginId: result.pluginId,
      contentHash: "deadbeef".padEnd(64, "0"),
      relativePath: "viewer.html",
    })).rejects.toThrow(/hash/i);

    await packages.disable(result.pluginId);
    registry.invalidate();
    expect((await registry.getContributionSnapshot({ force: true })).contributions).toHaveLength(0);
    expect(await store.listInstalledVersions(result.pluginId)).toEqual(["1.0.0"]);
  });

  it("preserves the previous enabled version when the registry commit fails", async () => {
    const userDataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "vp-rollback-"));
    const keys = generateTestKeyPair();
    const base = createServices(userDataPath, keys);
    const firstBytes = await buildArchive({
      "manifest.json": JSON.stringify(manifest),
      "viewer.html": "first",
    });
    const first = await base.packages.installFromBytes({
      archiveBytes: firstBytes,
      signatureEnvelope: signArchive(keys, firstBytes),
    });

    const failingStore = {
      ...base.store,
      writeRegistryState: async () => { throw new Error("simulated registry fsync failure"); },
    };
    const failing = createServices(userDataPath, keys, failingStore).packages;
    const nextManifest = { ...manifest, version: "1.1.0" };
    const nextBytes = await buildArchive({
      "manifest.json": JSON.stringify(nextManifest),
      "viewer.html": "second",
    });
    await expect(failing.installFromBytes({
      archiveBytes: nextBytes,
      signatureEnvelope: signArchive(keys, nextBytes),
    })).rejects.toThrow(/fsync failure/);

    const state = await base.store.readRegistryState();
    expect(state.enabled[manifest.id].version).toBe(first.version);
    const oldAsset = await base.registry.readPackageFile({
      pluginId: manifest.id,
      contentHash: first.contentHash,
      relativePath: "viewer.html",
    });
    expect(oldAsset.bytes.toString()).toBe("first");
  });

  it("rejects tampered installed assets and traversal-shaped uninstall ids", async () => {
    const userDataPath = await fsp.mkdtemp(path.join(os.tmpdir(), "vp-integrity-"));
    const keys = generateTestKeyPair();
    const { store, packages, registry } = createServices(userDataPath, keys);
    const bytes = await buildArchive({
      "manifest.json": JSON.stringify(manifest),
      "viewer.html": "trusted",
    });
    const installed = await packages.installFromBytes({
      archiveBytes: bytes,
      signatureEnvelope: signArchive(keys, bytes),
    });
    const assetPath = path.join(
      store.packageContentDir(installed.pluginId, installed.version, installed.contentHash),
      "viewer.html",
    );
    await fsp.chmod(assetPath, 0o600);
    await fsp.writeFile(assetPath, "altered");
    await expect(registry.readPackageFile({
      pluginId: installed.pluginId,
      contentHash: installed.contentHash,
      relativePath: "viewer.html",
    })).rejects.toThrow(/hash/i);

    const sentinel = path.join(userDataPath, "do-not-delete.txt");
    await fsp.writeFile(sentinel, "safe");
    await expect(packages.uninstall("../../do-not-delete.txt")).rejects.toThrow(/id is invalid/i);
    expect(await fsp.readFile(sentinel, "utf8")).toBe("safe");
  });
});
