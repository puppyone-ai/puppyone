import { describe, expect, it } from "vitest";
import {
  createDesktopArtifactDescriptor,
} from "../../../../shared/desktop/artifact-contract.mjs";
import {
  getDesktopTargetSecurityPolicy,
  resolveDesktopApplicationIdentity,
} from "../../../../shared/desktop/application-identity.mjs";
import {
  DESKTOP_STABLE_UPDATE_FEED_URL,
  createDesktopImmutableReleasePrefix,
  getDesktopTargetUpdateFeedUrl,
} from "../../../../shared/desktop/distribution-contract.mjs";
import {
  createDesktopTarget,
  createDesktopTargetFromNode,
  desktopPlatformFromNode,
  nodePlatformFromDesktop,
} from "../../../../shared/desktop/platform-contract.mjs";
import {
  resolveDesktopReleaseIdentity,
} from "../../../../shared/desktop/release-identity.mjs";
import { resolveDesktopBuildIdentity } from "../../../../shared/desktop-build-identity.mjs";
import {
  createDesktopElectronBuilderConfig,
} from "../../../../tooling/desktop/build/create-builder-config.mjs";
import {
  assertDesktopTargetManifest,
  createDesktopCiMatrix,
  getDesktopTargetDefinition,
} from "../../../../tooling/desktop/targets/target-manifest.mjs";

const commitSha = "a".repeat(40);
const packageMetadata = {
  build: {
    afterPack: "legacy-macos-hook.mjs",
    asar: true,
    extraResources: [{ from: "vendor/opencode", to: "opencode" }],
    mac: { category: "public.app-category.productivity" },
    dmg: { background: "build/dmg-background.tiff" },
  },
};

describe("Desktop platform contract", () => {
  it("normalizes Node identifiers only at the platform boundary", () => {
    expect(desktopPlatformFromNode("darwin")).toBe("macos");
    expect(desktopPlatformFromNode("win32")).toBe("windows");
    expect(desktopPlatformFromNode("linux")).toBe("linux");
    expect(nodePlatformFromDesktop("windows")).toBe("win32");
    expect(createDesktopTargetFromNode({ platform: "darwin", arch: "arm64" })).toEqual({
      id: "macos-arm64",
      platform: "macos",
      arch: "arm64",
    });
    expect(() => desktopPlatformFromNode("freebsd")).toThrow(/unsupported/i);
  });

  it("declares one native contract runner for each initial platform", () => {
    expect(assertDesktopTargetManifest()).toHaveLength(3);
    expect(createDesktopCiMatrix({ scope: "contracts" }).include).toEqual([
      expect.objectContaining({ id: "macos-arm64", runner: "macos-15" }),
      expect.objectContaining({ id: "windows-x64", runner: "windows-2025" }),
      expect.objectContaining({ id: "linux-x64", runner: "ubuntu-24.04" }),
    ]);
    expect(createDesktopCiMatrix({ scope: "release", channel: "stable" }).include)
      .toEqual([expect.objectContaining({ id: "macos-arm64", participation: "required" })]);
  });
});

describe("Desktop release and target identities", () => {
  it("keeps common release identity separate from target application identity", () => {
    const releaseIdentity = resolveDesktopReleaseIdentity({
      baseVersion: "2.1.0",
      buildNumber: 42,
      builtAt: "2026-08-29T00:00:00.000Z",
      channel: "stable",
      commitSha,
    });
    expect(releaseIdentity).not.toHaveProperty("platformBuildNumber");
    expect(releaseIdentity).not.toHaveProperty("platform");

    const windowsIdentity = resolveDesktopApplicationIdentity({
      releaseIdentity,
      target: createDesktopTarget({ platform: "windows", arch: "x64" }),
    });
    expect(windowsIdentity).toMatchObject({
      platform: "windows",
      arch: "x64",
      applicationId: "ai.puppyone.desktop",
      platformBuildNumber: "42",
      updateFeedUrl: "https://updates.puppyone.ai/desktop/stable/windows/x64/nsis/latest",
    });
  });

  it("preserves the shipped macOS feed while assigning new target coordinates", () => {
    const macos = createDesktopTarget({ platform: "macos", arch: "arm64" });
    const linux = createDesktopTarget({ platform: "linux", arch: "x64" });
    expect(getDesktopTargetUpdateFeedUrl({ channel: "stable", target: macos }))
      .toBe(DESKTOP_STABLE_UPDATE_FEED_URL);
    expect(getDesktopTargetUpdateFeedUrl({ channel: "stable", target: linux }))
      .toBe("https://updates.puppyone.ai/desktop/stable/linux/x64/appimage/latest");
    expect(createDesktopImmutableReleasePrefix({
      channel: "internal",
      releaseTag: "v2.1.0-internal.42",
      target: linux,
    })).toBe("desktop/internal/linux/v2.1.0-internal.42/x64");
  });

  it("uses platform-specific security evidence", () => {
    expect(getDesktopTargetSecurityPolicy({
      channel: "stable",
      target: createDesktopTarget({ platform: "macos", arch: "arm64" }),
    })).toMatchObject({ kind: "apple", requiresNotarization: true });
    expect(getDesktopTargetSecurityPolicy({
      channel: "stable",
      target: createDesktopTarget({ platform: "windows", arch: "x64" }),
    })).toMatchObject({ kind: "authenticode", requiresAuthenticodeSignature: true });

    expect(createDesktopArtifactDescriptor({
      target: createDesktopTarget({ platform: "linux", arch: "x64" }),
      kind: "appimage",
      updateTrack: "appimage",
      name: "puppyone-2.1.0-x64.AppImage",
      bytes: 10,
      sha256: "b".repeat(64),
      security: { kind: "linux", provenanceAttested: true },
    })).toMatchObject({
      platform: "linux",
      security: { kind: "linux", provenanceAttested: true },
    });
  });
});

describe("target-driven Electron builder configuration", () => {
  const buildInfo = resolveDesktopBuildIdentity({
    baseVersion: "2.1.0",
    buildNumber: 42,
    builtAt: "2026-08-29T00:00:00.000Z",
    channel: "internal",
    commitSha,
  });

  it("keeps the existing macOS package behavior in the macOS adapter", () => {
    const config = createDesktopElectronBuilderConfig({
      packageMetadata,
      buildInfo,
      target: getDesktopTargetDefinition("macos-arm64"),
    });
    expect(config).toMatchObject({
      beforePack: "scripts/before-pack-macos-icon.mjs",
      afterPack: "scripts/after-pack-macos-icon.mjs",
      appId: "ai.puppyone.desktop.internal",
      mac: {
        target: ["dmg", "zip"],
        identity: "-",
        notarize: false,
      },
      dmg: { background: "build/dmg-background.tiff" },
    });
    expect(config).not.toHaveProperty("win");
    expect(config).not.toHaveProperty("linux");
  });

  it("removes Mac-only hooks and emits Windows NSIS configuration", () => {
    const config = createDesktopElectronBuilderConfig({
      packageMetadata,
      buildInfo,
      target: getDesktopTargetDefinition("windows-x64"),
    });
    expect(config).not.toHaveProperty("beforePack");
    expect(config).not.toHaveProperty("afterPack");
    expect(config).not.toHaveProperty("mac");
    expect(config).not.toHaveProperty("dmg");
    expect(config).toMatchObject({
      win: { target: ["nsis"] },
      nsis: { oneClick: false, perMachine: false },
      publish: [{
        channel: "internal",
        url: "https://downloads.puppyone.ai/desktop/internal/windows/x64/nsis/latest",
      }],
    });
  });

  it("emits an AppImage-only Linux configuration", () => {
    const config = createDesktopElectronBuilderConfig({
      packageMetadata,
      buildInfo,
      target: getDesktopTargetDefinition("linux-x64"),
    });
    expect(config).not.toHaveProperty("beforePack");
    expect(config).not.toHaveProperty("afterPack");
    expect(config).not.toHaveProperty("mac");
    expect(config).toMatchObject({
      linux: { target: ["AppImage"] },
      appImage: { artifactName: "puppyone-${version}-${arch}.${ext}" },
    });
  });
});
