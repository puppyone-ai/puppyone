import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createChecksumsFile,
  createDesktopReleaseManifest,
  createLatestPointer,
  inspectDesktopReleaseManifest,
  jsonFile,
  mergeReleaseCatalog,
  verifyDesktopReleaseBundle,
} from "../../../../scripts/release-support/desktop-release-metadata.mjs";
import { resolveDesktopBuildIdentity } from "../../../../shared/desktop-build-identity.mjs";

const temporaryDirectories = [];
const commitSha = "a".repeat(40);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

describe("desktop release metadata", () => {
  it("creates a deterministic internal manifest, checksums file, and latest pointer", async () => {
    const fixture = await createFixture();
    const manifest = await internalManifest(fixture.assets);

    expect(manifest.assets.map((asset) => asset.name)).toEqual([
      "puppyone-0.1.2-internal.5-arm64.dmg",
      "puppyone-0.1.2-internal.5-arm64.zip",
      "puppyone-desktop-terminal-preview-0.1.2-internal.5.tgz",
    ]);
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      baseVersion: "0.1.2",
      version: "0.1.2-internal.5",
      build: { id: "5", platformBuildNumber: "5" },
    });
    expect(manifest.assets.find((asset) => asset.kind === "dmg")?.latestAlias)
      .toBe("puppyone-latest-arm64.dmg");
    expect(createChecksumsFile(manifest).split("\n").filter(Boolean)).toHaveLength(3);

    const latest = createLatestPointer(manifest);
    expect(latest.tag).toBe("v0.1.2-internal.5");
    expect(latest.assets.find((asset) => asset.kind === "terminal-preview")?.latestUrl)
      .toBe("https://downloads.puppyone.ai/desktop/internal/mac/latest/puppyone-terminal-preview-latest-arm64.tgz");
  });

  it("requires signed, notarized updater-ready artifacts for stable releases", async () => {
    const fixture = await createFixture("0.1.2");
    const updaterMetadata = path.join(fixture.directory, "stable-mac.yml");
    await fs.writeFile(updaterMetadata, "version: 0.1.2\n");
    const manifest = await createDesktopReleaseManifest({
      ...baseMetadata(),
      assetPaths: [...fixture.assets.slice(0, 2), updaterMetadata],
      buildInfo: releaseBuildInfo("stable", 6),
      channel: "stable",
      prerelease: false,
      provenance: "pipeline",
      developerIdSigned: true,
      notarized: true,
      r2Prefix: "desktop/stable/mac/v0.1.2",
      tag: "v0.1.2",
      version: "0.1.2",
      promotionSourceTag: "v0.1.2-internal.5",
    });
    manifest.security.developerIdSigned = false;
    manifest.security.notarized = false;
    manifest.assets = manifest.assets.filter((asset) => asset.kind !== "updater-metadata");
    const errors = inspectDesktopReleaseManifest(manifest);
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/Developer ID signed/),
      expect.stringMatching(/notarized/),
      expect.stringMatching(/stable-mac\.yml/),
    ]));
  });

  it("creates an independently addressable signed Windows NSIS release", async () => {
    const fixture = await createWindowsFixture();
    const manifest = await createDesktopReleaseManifest({
      ...baseMetadata(),
      arch: "x64",
      assetPaths: fixture.assets,
      authenticodeSigned: true,
      authenticodeTimestamped: true,
      buildInfo: releaseBuildInfo("stable", 6),
      channel: "stable",
      prerelease: false,
      provenance: "pipeline",
      publisherNames: ["CN=PuppyOne Test Publisher"],
      r2Prefix: "desktop/stable/windows/v0.1.2/x64",
      tag: "v0.1.2",
      target: "windows-x64",
      version: "0.1.2",
      promotionSourceTag: "v0.1.2-internal.5",
    });

    expect(manifest).toMatchObject({
      target: {
        id: "windows-x64",
        platform: "windows",
        arch: "x64",
        updateTrack: "nsis",
      },
      r2: {
        catalogKey: "desktop/stable/windows/x64/nsis/releases.json",
        latestPrefix: "desktop/stable/windows/x64/nsis/latest",
      },
      security: {
        kind: "authenticode",
        signed: true,
        timestamped: true,
        digestAlgorithm: "sha256",
      },
    });
    expect(manifest.assets.map((asset) => asset.kind)).toEqual([
      "nsis",
      "blockmap",
      "updater-metadata",
    ]);
    expect(createLatestPointer(manifest).assets[0].latestUrl)
      .toContain("/desktop/stable/windows/x64/nsis/latest/");

    manifest.security.timestamped = false;
    expect(inspectDesktopReleaseManifest(manifest)).toContain(
      "signed stable Windows releases must have a trusted timestamp",
    );
  });

  it("records an explicitly unsigned Stable Windows NSIS release without publisher claims", async () => {
    const fixture = await createWindowsFixture();
    const manifest = await createDesktopReleaseManifest({
      ...baseMetadata(),
      arch: "x64",
      assetPaths: fixture.assets,
      authenticodeSigned: false,
      authenticodeTimestamped: false,
      buildInfo: releaseBuildInfo("stable", 6),
      channel: "stable",
      prerelease: false,
      provenance: "pipeline",
      publisherNames: [],
      r2Prefix: "desktop/stable/windows/v0.1.2/x64",
      tag: "v0.1.2",
      target: "windows-x64",
      version: "0.1.2",
      promotionSourceTag: "v0.1.2-internal.5",
    });

    expect(manifest.security).toEqual({
      kind: "authenticode",
      signed: false,
      timestamped: false,
      publisherNames: [],
      digestAlgorithm: "sha256",
    });
    expect(inspectDesktopReleaseManifest(manifest)).toEqual([]);

    manifest.security.timestamped = true;
    manifest.security.publisherNames = ["CN=Unverified Publisher Claim"];
    expect(inspectDesktopReleaseManifest(manifest)).toEqual(expect.arrayContaining([
      "unsigned stable Windows releases cannot claim a trusted timestamp",
      "unsigned stable Windows releases cannot claim publisher names",
    ]));
  });

  it("allows a GitHub-backed internal release to be backfilled without a modern Terminal launcher", async () => {
    const fixture = await createFixture();
    const manifest = await createDesktopReleaseManifest({
      ...baseMetadata(),
      assetPaths: fixture.assets.slice(0, 2),
      channel: "internal",
      developerIdSigned: false,
      notarized: false,
      prerelease: true,
      provenance: "backfill",
      r2Prefix: "desktop/internal/mac/v0.1.1-internal.1",
      tag: "v0.1.1-internal.1",
      version: "0.1.1",
    });
    expect(manifest).toMatchObject({
      channel: "internal",
      provenance: "backfill",
      github: {
        releaseUrl: "https://github.com/puppyone-ai/puppyone/releases/tag/v0.1.1-internal.1",
      },
    });
  });

  it("merges immutable releases and rejects a conflicting tag", async () => {
    const fixture = await createFixture();
    const manifest = await internalManifest(fixture.assets);
    const catalog = mergeReleaseCatalog(null, manifest, "2026-07-24T12:30:00.000Z");
    expect(catalog.releases.map((release) => release.tag)).toEqual(["v0.1.2-internal.5"]);
    expect(mergeReleaseCatalog(catalog, manifest, "2026-07-24T12:31:00.000Z").releases).toHaveLength(1);

    const conflicting = structuredClone(manifest);
    conflicting.commitSha = "b".repeat(40);
    expect(() => mergeReleaseCatalog(catalog, conflicting)).toThrow(/different immutable release/);
  });

  it("enforces channel-specific catalogs and removes legacy channel pollution", async () => {
    const fixture = await createFixture();
    const internal = await internalManifest(fixture.assets);
    const internalCatalog = mergeReleaseCatalog(
      null,
      internal,
      "2026-07-24T12:30:00.000Z",
      ["internal"],
    );

    const archive = await createDesktopReleaseManifest({
      ...baseMetadata(),
      assetPaths: [fixture.assets[1]],
      channel: "archive",
      commitSha: null,
      developerIdSigned: false,
      notarized: false,
      prerelease: false,
      provenance: "archive",
      r2Prefix: "desktop/archive/mac/v0.1.0-legacy.0",
      tag: "v0.1.0-legacy.0",
      version: "0.1.0",
      workflowRunUrl: null,
    });
    const publicCatalog = mergeReleaseCatalog(
      internalCatalog,
      archive,
      "2026-07-24T12:31:00.000Z",
      ["stable", "archive"],
    );

    expect(publicCatalog.releases.map((release) => release.tag)).toEqual([
      "v0.1.0-legacy.0",
    ]);
    expect(() => mergeReleaseCatalog(
      publicCatalog,
      internal,
      "2026-07-24T12:32:00.000Z",
      ["stable", "archive"],
    )).toThrow(/not allowed in this catalog/);
  });

  it("rejects non-canonical timestamps and credential-bearing release URLs", async () => {
    const fixture = await createFixture();
    const manifest = await internalManifest(fixture.assets);
    manifest.publishedAt = "2026-07-24 12:00:00Z";
    manifest.assets[0].r2.url = "https://token:secret@downloads.puppyone.ai/asset";

    expect(inspectDesktopReleaseManifest(manifest)).toEqual(expect.arrayContaining([
      expect.stringMatching(/canonical UTC ISO timestamp/),
      expect.stringMatching(/invalid R2 coordinates/),
    ]));
  });

  it("represents a pre-pipeline DMG honestly as an archive release", async () => {
    const fixture = await createFixture();
    const manifest = await createDesktopReleaseManifest({
      ...baseMetadata(),
      assetPaths: [fixture.assets[1]],
      channel: "archive",
      commitSha: null,
      developerIdSigned: false,
      notarized: false,
      prerelease: false,
      provenance: "archive",
      r2Prefix: "desktop/archive/mac/v0.1.0-legacy.0",
      tag: "v0.1.0-legacy.0",
      version: "0.1.0",
      workflowRunUrl: null,
    });
    expect(manifest).toMatchObject({
      channel: "archive",
      commitSha: null,
      github: { releaseUrl: null },
      assets: [{ github: { url: null } }],
    });
  });

  it("verifies every bundled file and detects asset tampering", async () => {
    const fixture = await createFixture();
    const bundle = path.join(fixture.directory, "bundle");
    await fs.mkdir(path.join(bundle, "assets"), { recursive: true });
    const copied = [];
    for (const assetPath of fixture.assets) {
      const destination = path.join(bundle, "assets", path.basename(assetPath));
      await fs.copyFile(assetPath, destination);
      copied.push(destination);
    }
    const manifest = await internalManifest(copied);
    await fs.writeFile(
      path.join(bundle, "build-info.json"),
      jsonFile(releaseBuildInfo("internal", 5)),
    );
    await fs.writeFile(path.join(bundle, "release.json"), jsonFile(manifest));
    await fs.writeFile(path.join(bundle, "SHA256SUMS"), createChecksumsFile(manifest));
    await fs.writeFile(path.join(bundle, "latest.json"), jsonFile(createLatestPointer(manifest)));
    await fs.writeFile(path.join(bundle, "release-notes.md"), "Internal release.\n");

    await expect(verifyDesktopReleaseBundle(bundle)).resolves.toMatchObject({
      manifest: { tag: "v0.1.2-internal.5" },
    });
    await fs.appendFile(copied[0], "tampered");
    await expect(verifyDesktopReleaseBundle(bundle)).rejects.toThrow(/byte length/);
  });
});

async function createFixture(version = "0.1.2-internal.5") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-release-metadata-"));
  temporaryDirectories.push(directory);
  const assets = [
    path.join(directory, `puppyone-${version}-arm64.zip`),
    path.join(directory, `puppyone-${version}-arm64.dmg`),
    path.join(directory, "puppyone-desktop-terminal-preview-0.1.2-internal.5.tgz"),
  ];
  await Promise.all(assets.map((assetPath, index) => fs.writeFile(assetPath, `asset-${index}`)));
  return { assets, directory };
}

async function createWindowsFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-windows-release-metadata-"));
  temporaryDirectories.push(directory);
  const assets = [
    path.join(directory, "puppyone-0.1.2-x64-setup.exe"),
    path.join(directory, "puppyone-0.1.2-x64-setup.exe.blockmap"),
    path.join(directory, "stable.yml"),
  ];
  await Promise.all(assets.map((assetPath, index) => fs.writeFile(assetPath, `windows-asset-${index}`)));
  return { assets, directory };
}

function baseMetadata() {
  return {
    arch: "arm64",
    commitSha,
    publicOrigin: "https://downloads.puppyone.ai",
    publishedAt: "2026-07-24T12:00:00.000Z",
    repository: "puppyone-ai/puppyone",
    version: "0.1.2",
    workflowRunUrl: "https://github.com/puppyone-ai/puppyone/actions/runs/123",
  };
}

function internalManifest(assetPaths) {
  const buildInfo = releaseBuildInfo("internal", 5);
  return createDesktopReleaseManifest({
    ...baseMetadata(),
    assetPaths,
    buildInfo,
    channel: "internal",
    developerIdSigned: false,
    notarized: false,
    prerelease: true,
    r2Prefix: "desktop/internal/mac/v0.1.2-internal.5",
    tag: "v0.1.2-internal.5",
    version: buildInfo.version,
  });
}

function releaseBuildInfo(channel, buildNumber) {
  return resolveDesktopBuildIdentity({
    baseVersion: "0.1.2",
    buildNumber,
    builtAt: "2026-07-24T11:55:00.000Z",
    channel,
    commitSha,
    sourceDirty: false,
  });
}
