import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createChecksumsFile,
  createDesktopReleaseManifest,
  createLatestPointer,
  jsonFile,
} from "../../../../scripts/release-support/desktop-release-metadata.mjs";
import { resolveDesktopBuildIdentity } from "../../../../shared/desktop-build-identity.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

describe("Desktop Stable Release Set bundle aggregation", () => {
  it("accepts only the matching macOS and Windows bundles as one required-target set", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-release-set-"));
    temporaryDirectories.push(directory);
    const buildInfo = resolveDesktopBuildIdentity({
      baseVersion: "1.2.3",
      buildNumber: 42,
      builtAt: "2026-09-17T00:00:00.000Z",
      channel: "stable",
      commitSha: "a".repeat(40),
    });
    const macosBundle = path.join(directory, "macos-arm64");
    const windowsBundle = path.join(directory, "windows-x64");
    const output = path.join(directory, "release-set.json");
    await writeBundle({ bundleDirectory: macosBundle, buildInfo, target: "macos-arm64" });
    await writeBundle({ bundleDirectory: windowsBundle, buildInfo, target: "windows-x64" });

    execFileSync(process.execPath, [
      "scripts/create-desktop-release-set.mjs",
      "--macos-bundle", macosBundle,
      "--windows-bundle", windowsBundle,
      "--macos-artifact", "puppyone-desktop-v1.2.3",
      "--windows-artifact", "puppyone-desktop-v1.2.3-windows-x64",
      "--tag", "v1.2.3",
      "--commit", "a".repeat(40),
      "--output", output,
    ], { cwd: repositoryRoot });

    const releaseSet = JSON.parse(await fs.readFile(output, "utf8"));
    expect(releaseSet).toMatchObject({
      release: {
        version: "1.2.3",
        commitSha: "a".repeat(40),
      },
      targetPolicy: {
        required: ["macos-arm64", "windows-x64"],
        optional: [],
      },
      targets: [
        { targetId: "macos-arm64", artifactName: "puppyone-desktop-v1.2.3" },
        { targetId: "windows-x64", artifactName: "puppyone-desktop-v1.2.3-windows-x64" },
      ],
    });
  });
});

async function writeBundle({ bundleDirectory, buildInfo, target }) {
  const assetsDirectory = path.join(bundleDirectory, "assets");
  await fs.mkdir(assetsDirectory, { recursive: true });
  const isMacos = target === "macos-arm64";
  const assetNames = isMacos
    ? ["puppyone-1.2.3-arm64.dmg", "puppyone-1.2.3-arm64.zip", "stable-mac.yml"]
    : ["puppyone-1.2.3-x64-setup.exe", "puppyone-1.2.3-x64-setup.exe.blockmap", "stable.yml"];
  const assetPaths = [];
  for (const assetName of assetNames) {
    const assetPath = path.join(assetsDirectory, assetName);
    await fs.writeFile(assetPath, `fixture:${target}:${assetName}\n`, "utf8");
    assetPaths.push(assetPath);
  }
  const manifest = await createDesktopReleaseManifest({
    arch: isMacos ? "arm64" : "x64",
    assetPaths,
    authenticodeSigned: false,
    authenticodeTimestamped: false,
    buildInfo,
    channel: "stable",
    commitSha: buildInfo.commitSha,
    developerIdSigned: isMacos,
    notarized: isMacos,
    prerelease: false,
    provenance: "pipeline",
    publicOrigin: "https://downloads.puppyone.ai",
    publishedAt: buildInfo.builtAt,
    promotionSourceTag: "v1.2.3-internal.41",
    publisherNames: [],
    repository: "puppyone-ai/puppyone-desktop",
    r2Prefix: isMacos
      ? "desktop/stable/mac/v1.2.3"
      : "desktop/stable/windows/v1.2.3/x64",
    tag: "v1.2.3",
    target,
    version: "1.2.3",
    workflowRunUrl: "https://github.com/puppyone-ai/puppyone-desktop/actions/runs/42",
  });
  await Promise.all([
    fs.writeFile(path.join(bundleDirectory, "release.json"), jsonFile(manifest), "utf8"),
    fs.writeFile(path.join(bundleDirectory, "build-info.json"), jsonFile(buildInfo), "utf8"),
    fs.writeFile(path.join(bundleDirectory, "SHA256SUMS"), createChecksumsFile(manifest), "utf8"),
    fs.writeFile(path.join(bundleDirectory, "latest.json"), jsonFile(createLatestPointer(manifest)), "utf8"),
    fs.writeFile(path.join(bundleDirectory, "release-notes.md"), `Fixture ${target}\n`, "utf8"),
  ]);
}
