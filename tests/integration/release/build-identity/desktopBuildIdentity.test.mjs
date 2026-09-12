import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertDesktopBuildInfo,
  createDesktopBuildTag,
  getDesktopBuildChannelPolicy,
  resolveDesktopBuildIdentity,
} from "../../../../shared/desktop-build-identity.mjs";
import {
  createDesktopElectronBuilderConfig,
  prepareDesktopBuild,
} from "../../../../scripts/release-support/desktop-build-preparation.mjs";
import {
  DESKTOP_INTERNAL_UPDATE_FEED_URL,
  DESKTOP_SHIPPED_STABLE_UPDATE_CONTRACTS,
  DESKTOP_STABLE_UPDATE_FEED_URL,
  DESKTOP_SUPPORTED_STABLE_UPDATE_FEED_URLS,
} from "../../../../shared/desktop-distribution-contract.mjs";

const commitSha = "a".repeat(40);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { force: true, recursive: true })
  )));
});

describe("desktop build identity", () => {
  it("resolves the three supported channels deterministically", () => {
    const common = {
      baseVersion: "1.4.0",
      builtAt: "2026-07-26T10:00:00.000Z",
      commitSha,
    };

    expect(resolveDesktopBuildIdentity({ ...common, channel: "dev" })).toMatchObject({
      channel: "dev",
      version: "1.4.0-dev.gaaaaaaaa",
      buildId: "gaaaaaaaa",
      platformBuildNumber: null,
    });
    expect(resolveDesktopBuildIdentity({
      ...common,
      channel: "internal",
      buildNumber: 42,
    })).toMatchObject({
      channel: "internal",
      version: "1.4.0-internal.42",
      buildId: "42",
      platformBuildNumber: "42",
    });
    const stable = resolveDesktopBuildIdentity({
      ...common,
      channel: "stable",
      buildNumber: "43",
    });
    expect(stable).toMatchObject({
      channel: "stable",
      version: "1.4.0",
      buildId: "43",
      platformBuildNumber: "43",
    });
    expect(createDesktopBuildTag(stable)).toBe("v1.4.0");
  });

  it("marks dirty development builds and rejects dirty published builds", () => {
    const dirtyDev = resolveDesktopBuildIdentity({
      baseVersion: "1.4.0",
      builtAt: "2026-07-26T10:00:00.000Z",
      channel: "dev",
      commitSha,
      sourceDirty: true,
    });
    expect(dirtyDev.version).toBe("1.4.0-dev.gaaaaaaaa.dirty");

    expect(() => resolveDesktopBuildIdentity({
      baseVersion: "1.4.0",
      buildNumber: 1,
      channel: "internal",
      commitSha,
      sourceDirty: true,
    })).toThrow(/clean source tree/);
  });

  it.each(["beta", "preview", "rc", "archive", "production"])(
    "rejects the unsupported %s channel",
    (channel) => {
      expect(() => resolveDesktopBuildIdentity({
        baseVersion: "1.4.0",
        buildNumber: 1,
        channel,
        commitSha,
      })).toThrow(/dev, internal, or stable/);
    },
  );

  it("rejects non-canonical versions, commits, and build numbers", () => {
    expect(() => resolveDesktopBuildIdentity({
      baseVersion: "1.4.0-beta.1",
      channel: "dev",
      commitSha,
    })).toThrow(/stable SemVer/);
    expect(() => resolveDesktopBuildIdentity({
      baseVersion: "1.4.0",
      channel: "dev",
      commitSha: "abc123",
    })).toThrow(/full lowercase Git commit SHA/);
    expect(() => resolveDesktopBuildIdentity({
      baseVersion: "1.4.0",
      buildNumber: 0,
      channel: "stable",
      commitSha,
    })).toThrow(/positive numeric CI build number/);
  });

  it("rejects non-canonical persisted timestamps and unknown schema fields", () => {
    const buildInfo = resolveDesktopBuildIdentity({
      baseVersion: "1.4.0",
      builtAt: "2026-07-26T10:00:00.000Z",
      channel: "dev",
      commitSha,
    });
    expect(() => assertDesktopBuildInfo({
      ...buildInfo,
      builtAt: "2026-07-26 10:00:00Z",
    })).toThrow(/canonical UTC ISO timestamp/);
    expect(() => assertDesktopBuildInfo({
      ...buildInfo,
      releaseChannel: "dev",
    })).toThrow(/unsupported fields/);
  });

  it("keeps application, data, and updater identities isolated by channel", () => {
    const dev = getDesktopBuildChannelPolicy("dev");
    const internal = getDesktopBuildChannelPolicy("internal");
    const stable = getDesktopBuildChannelPolicy("stable");

    expect(new Set([dev.applicationId, internal.applicationId, stable.applicationId])).toHaveLength(3);
    expect(new Set([dev.userDataName, internal.userDataName, stable.userDataName])).toHaveLength(3);
    expect(dev.updateFeedUrl).toBeNull();
    expect(internal.updateFeedUrl).toBe(DESKTOP_INTERNAL_UPDATE_FEED_URL);
    expect(stable.updateFeedUrl).toBe(DESKTOP_STABLE_UPDATE_FEED_URL);
    expect(DESKTOP_SUPPORTED_STABLE_UPDATE_FEED_URLS).toContain(stable.updateFeedUrl);
    expect(DESKTOP_SHIPPED_STABLE_UPDATE_CONTRACTS).toContainEqual({
      feedUrl: DESKTOP_STABLE_UPDATE_FEED_URL,
      introducedInVersion: "0.1.4",
    });
  });

  it("derives electron-builder configuration from the same immutable identity", () => {
    const buildInfo = resolveDesktopBuildIdentity({
      baseVersion: "1.4.0",
      buildNumber: 42,
      builtAt: "2026-07-26T10:00:00.000Z",
      channel: "internal",
      commitSha,
    });
    const config = createDesktopElectronBuilderConfig({
      buildInfo,
      buildInfoPath: "generated/build-info.json",
      packageMetadata: {
        build: {
          appId: "wrong",
          extraResources: [{ from: "logo.png", to: "logo.png" }],
          mac: { hardenedRuntime: true, notarize: true, strictVerify: true },
        },
      },
    });

    expect(config).toMatchObject({
      appId: "ai.puppyone.desktop.internal",
      productName: "PuppyOne Internal",
      executableName: "PuppyOne Internal",
      extraMetadata: { version: "1.4.0-internal.42" },
      buildVersion: "42",
      publish: [{
        channel: "internal",
        url: DESKTOP_INTERNAL_UPDATE_FEED_URL,
      }],
      mac: {
        bundleShortVersion: "1.4.0",
        bundleVersion: "42",
        executableName: "PuppyOne Internal",
        hardenedRuntime: false,
        identity: "-",
        notarize: false,
        strictVerify: false,
      },
    });
    expect(config.extraResources).toContainEqual({
      from: "generated/build-info.json",
      to: "build-info.json",
    });
  });

  it("uses the badged App Image only for Development builds", () => {
    const build = (channel, buildNumber = null) => createDesktopElectronBuilderConfig({
      buildInfo: resolveDesktopBuildIdentity({
        baseVersion: "1.4.0",
        buildNumber,
        builtAt: "2026-07-26T10:00:00.000Z",
        channel,
        commitSha,
      }),
      packageMetadata: {
        build: {
          extraResources: [{
            from: "assets/brand/puppy/puppy-app-image.png",
            to: "puppy-app-image.png",
          }],
          mac: { icon: "assets/brand/puppy/puppy-app-image.png" },
        },
      },
    });

    const development = build("dev");
    const stable = build("stable", 43);
    expect(development.mac.icon).toBe("generated/app-icons/dev/icon.icns");
    expect(development.extraResources).toEqual(expect.arrayContaining([
      {
        from: "assets/brand/puppy/puppy-app-image-dev.png",
        to: "puppy-app-image.png",
      },
    ]));
    expect(development.extraResources).not.toEqual(expect.arrayContaining([
      {
        from: "assets/brand/puppy/puppy-app-image.png",
        to: "puppy-app-image.png",
      },
    ]));
    expect(stable.mac.icon).toBe("generated/app-icons/stable/icon.icns");
    expect(stable.extraResources).toEqual(expect.arrayContaining([
      {
        from: "assets/brand/puppy/puppy-app-image.png",
        to: "puppy-app-image.png",
      },
    ]));
  });

  it("writes one build-info file and validates the release tag", async () => {
    const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-build-identity-"));
    temporaryDirectories.push(repositoryRoot);
    await fs.writeFile(path.join(repositoryRoot, "package.json"), JSON.stringify({
      version: "1.4.0",
      build: {
        appId: "ai.puppyone.desktop",
        mac: {},
      },
    }));

    const prepared = await prepareDesktopBuild({
      repositoryRoot,
      buildNumber: 42,
      builtAt: "2026-07-26T10:00:00.000Z",
      channel: "internal",
      commitSha,
      expectedTag: "v1.4.0-internal.42",
      sourceDirty: false,
    });
    const persisted = JSON.parse(
      await fs.readFile(path.join(repositoryRoot, prepared.buildInfoPath), "utf8"),
    );

    expect(assertDesktopBuildInfo(persisted)).toEqual(prepared.buildInfo);
    await expect(prepareDesktopBuild({
      repositoryRoot,
      buildNumber: 42,
      channel: "internal",
      commitSha,
      expectedTag: "v1.4.0-internal.41",
      sourceDirty: false,
    })).rejects.toThrow(/must exactly match/);
  });
});
