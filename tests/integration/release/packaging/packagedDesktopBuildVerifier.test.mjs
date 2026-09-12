import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import asarPackage from "@electron/asar";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import plistPackage from "plist";
import { verifyPackagedDesktopBuild } from "../../../../scripts/release-support/packaged-desktop-build-verifier.mjs";
import {
  getDesktopBuildChannelPolicy,
  resolveDesktopBuildIdentity,
} from "../../../../shared/desktop-build-identity.mjs";
import {
  DESKTOP_STABLE_UPDATE_FEED_URL,
} from "../../../../shared/desktop-distribution-contract.mjs";
import { verifyMacosAppIcon } from "../../../../tooling/desktop/build/macos-app-icon.mjs";

vi.mock("../../../../tooling/desktop/build/macos-app-icon.mjs", () => ({ verifyMacosAppIcon: vi.fn() }));
beforeEach(() => { vi.mocked(verifyMacosAppIcon).mockReset().mockResolvedValue(undefined); });

const { createPackage } = asarPackage;
const { build: buildPlist } = plistPackage;
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { force: true, recursive: true })
  )));
});

describe("packaged Desktop Build Identity verification", () => {
  it("verifies app metadata, embedded identity, update feed, and artifact names", async () => {
    const fixture = await createFixture();
    await expect(verifyPackagedDesktopBuild({
      releaseDirectory: fixture.releaseDirectory,
      buildInfo: fixture.buildInfo,
    })).resolves.toMatchObject({
      applications: [fixture.applicationPath],
    });
    expect(verifyMacosAppIcon).toHaveBeenCalledWith(fixture.applicationPath);
  });

  it("fails when a packaged Internal app embeds a Stable update feed", async () => {
    const fixture = await createFixture();
    await fs.writeFile(
      path.join(fixture.applicationPath, "Contents", "Resources", "app-update.yml"),
      `provider: generic\nurl: ${DESKTOP_STABLE_UPDATE_FEED_URL}\nchannel: stable\n`,
    );

    await expect(verifyPackagedDesktopBuild({
      releaseDirectory: fixture.releaseDirectory,
      buildInfo: fixture.buildInfo,
    })).rejects.toThrow(/canonical update feed/);
  });

  it("fails release verification when native icon verification fails", async () => {
    const fixture = await createFixture();
    vi.mocked(verifyMacosAppIcon).mockRejectedValue(new Error("Invalid native icon"));
    await expect(verifyPackagedDesktopBuild({
      releaseDirectory: fixture.releaseDirectory,
      buildInfo: fixture.buildInfo,
    })).rejects.toThrow("Invalid native icon");
  });
});

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-packaged-identity-"));
  temporaryDirectories.push(root);
  const releaseDirectory = path.join(root, "release");
  const buildInfo = resolveDesktopBuildIdentity({
    baseVersion: "1.4.0",
    buildNumber: 72,
    builtAt: "2026-07-26T10:00:00.000Z",
    channel: "internal",
    commitSha: "a".repeat(40),
  });
  const policy = getDesktopBuildChannelPolicy(buildInfo.channel);
  const applicationPath = path.join(
    releaseDirectory,
    "mac-arm64",
    `${policy.applicationName.toLocaleLowerCase("en-US")}.app`,
  );
  const resourcesDirectory = path.join(applicationPath, "Contents", "Resources");
  const sourceDirectory = path.join(root, "asar-source");
  await fs.mkdir(resourcesDirectory, { recursive: true });
  await fs.mkdir(sourceDirectory, { recursive: true });
  await fs.writeFile(
    path.join(sourceDirectory, "package.json"),
    JSON.stringify({ name: "@puppyone/desktop", version: buildInfo.version }),
  );
  await createPackage(sourceDirectory, path.join(resourcesDirectory, "app.asar"));
  await fs.writeFile(
    path.join(resourcesDirectory, "build-info.json"),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(resourcesDirectory, "app-update.yml"),
    `provider: generic\nurl: ${policy.updateFeedUrl}\nchannel: ${policy.updateChannel}\n`,
  );
  await fs.writeFile(
    path.join(applicationPath, "Contents", "Info.plist"),
    buildPlist({
      CFBundleIdentifier: policy.applicationId,
      CFBundleName: policy.applicationName,
      CFBundleDisplayName: policy.applicationName,
      CFBundleShortVersionString: buildInfo.baseVersion,
      CFBundleVersion: buildInfo.platformBuildNumber,
    }),
  );
  await fs.writeFile(
    path.join(releaseDirectory, `puppyone-${buildInfo.version}-arm64.dmg`),
    "dmg",
  );
  await fs.writeFile(
    path.join(releaseDirectory, `puppyone-${buildInfo.version}-arm64.zip`),
    "zip",
  );
  await fs.writeFile(
    path.join(releaseDirectory, `${policy.updateChannel}-mac.yml`),
    `version: ${buildInfo.version}\npath: puppyone-${buildInfo.version}-arm64.zip\n`,
  );
  return { applicationPath, buildInfo, releaseDirectory };
}
