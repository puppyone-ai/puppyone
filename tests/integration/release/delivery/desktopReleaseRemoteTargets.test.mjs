import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectRemoteReleaseEntries } from "../../../../scripts/release-support/desktop-release-remote-verifier.mjs";
import { createChecksumsFile, createDesktopReleaseManifest, createLatestPointer, jsonFile, sha256File } from "../../../../scripts/release-support/desktop-release-metadata.mjs";
import { resolveDesktopBuildIdentity } from "../../../../shared/desktop-build-identity.mjs";

const temporary = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

async function bundle(target, content = "fixture") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "remote release bundle "));
  temporary.push(directory);
  await fs.mkdir(path.join(directory, "assets"));
  const mac = target === "macos-arm64";
  const names = mac ? ["puppyone-1.2.3-arm64.dmg", "puppyone-1.2.3-arm64.zip", "stable-mac.yml"]
    : ["puppyone-1.2.3-x64-setup.exe", "puppyone-1.2.3-x64-setup.exe.blockmap", "stable.yml"];
  const assetPaths = names.map(name => path.join(directory, "assets", name));
  await Promise.all(assetPaths.map(file => fs.writeFile(file, `${content}:${path.basename(file)}`)));
  const buildInfo = resolveDesktopBuildIdentity({ baseVersion: "1.2.3", buildNumber: 42,
    builtAt: "2026-09-17T00:00:00.000Z", channel: "stable", commitSha: "a".repeat(40) });
  const manifest = await createDesktopReleaseManifest({
    arch: mac ? "arm64" : "x64", assetPaths, buildInfo, target,
    authenticodeSigned: false, authenticodeTimestamped: false, publisherNames: [],
    channel: "stable", commitSha: buildInfo.commitSha, developerIdSigned: mac, notarized: mac,
    prerelease: false, provenance: "pipeline", publicOrigin: "https://downloads.example",
    publishedAt: buildInfo.builtAt, promotionSourceTag: "v1.2.3-internal.41",
    repository: "puppyone-ai/puppyone", r2Prefix: mac ? "desktop/stable/mac/v1.2.3" : "desktop/stable/windows/v1.2.3/x64",
    tag: "v1.2.3", version: "1.2.3", workflowRunUrl: "https://github.com/puppyone-ai/puppyone/actions/runs/42",
  });
  await Promise.all([
    fs.writeFile(path.join(directory, "release.json"), jsonFile(manifest)),
    fs.writeFile(path.join(directory, "build-info.json"), jsonFile(buildInfo)),
    fs.writeFile(path.join(directory, "SHA256SUMS"), createChecksumsFile(manifest)),
    fs.writeFile(path.join(directory, "latest.json"), jsonFile(createLatestPointer(manifest))),
    fs.writeFile(path.join(directory, "release-notes.md"), "Release transfer fixture\n"),
  ]);
  return { directory, manifest };
}

describe("complete remote release target queue", () => {
  it("interleaves both platforms and origins while retaining every filename, alias and metadata digest", async () => {
    const mac = await bundle("macos-arm64");
    const win = await bundle("windows-x64");
    const targets = [
      { bundle: mac.directory, urlPrefix: "https://downloads.example/mac" },
      { bundle: win.directory, urlPrefix: "https://downloads.example/win" },
      { bundle: mac.directory, urlPrefix: "https://updates.example/mac" },
      { bundle: win.directory, urlPrefix: "https://updates.example/win" },
    ];
    const entries = await collectRemoteReleaseEntries(targets, { includeAliases: true, includeMetadata: true });
    expect(entries.slice(0, 4).map(item => item.url.slice(0, item.url.lastIndexOf("/"))))
      .toEqual(targets.map(target => target.urlPrefix));
    const expected = [];
    for (const target of targets) {
      const { manifest } = target.bundle === mac.directory ? mac : win;
      for (const asset of manifest.assets) {
        for (const name of new Set([asset.name, asset.latestAlias].filter(Boolean))) {
          expected.push({ url: `${target.urlPrefix}/${encodeURIComponent(name)}`, bytes: asset.bytes, sha256: asset.sha256 });
        }
      }
      for (const name of ["release.json", "SHA256SUMS", "build-info.json"]) {
        const file = path.join(target.bundle, name);
        expected.push({ url: `${target.urlPrefix}/${name}`, bytes: (await fs.stat(file)).size, sha256: await sha256File(file) });
      }
    }
    expect(entries).toHaveLength(expected.length);
    expect(entries).toEqual(expect.arrayContaining(expected));
    expect(await collectRemoteReleaseEntries([...targets, targets[0]], { includeAliases: true, includeMetadata: true })).toEqual(entries);
  });

  it("keeps legacy immutable verification limited to manifest assets by default", async () => {
    const mac = await bundle("macos-arm64");
    const entries = await collectRemoteReleaseEntries([{ bundle: mac.directory, urlPrefix: "https://host.example/immutable/" }]);
    expect(entries).toHaveLength(mac.manifest.assets.length);
    expect(entries.every(entry => !entry.url.includes("//immutable") && !entry.url.endsWith("release.json"))).toBe(true);
  });

  it("rejects conflicting payloads for one URL before a download queue can be returned", async () => {
    const first = await bundle("macos-arm64", "first");
    const second = await bundle("macos-arm64", "second");
    await expect(collectRemoteReleaseEntries([first, second].map(value => ({ bundle: value.directory, urlPrefix: "https://host.example/same" }))))
      .rejects.toThrow("Conflicting release digests");
  });

  it("rejects a damaged second platform before returning any remote verification work", async () => {
    const mac = await bundle("macos-arm64");
    const win = await bundle("windows-x64");
    await fs.writeFile(path.join(win.directory, "assets", win.manifest.assets[0].name), "tampered");
    await expect(collectRemoteReleaseEntries([
      { bundle: mac.directory, urlPrefix: "https://host.example/mac" },
      { bundle: win.directory, urlPrefix: "https://host.example/win" },
    ])).rejects.toThrow("does not match its declared byte length");
  });
});
