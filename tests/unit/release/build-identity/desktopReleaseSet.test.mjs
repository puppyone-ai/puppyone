import { describe, expect, it } from "vitest";
import { resolveDesktopReleaseIdentity } from "../../../../shared/desktop/release-identity.mjs";
import {
  createDesktopReleaseSet,
  createDesktopTargetBundleDescriptor,
} from "../../../../tooling/desktop/release/release-set.mjs";

const sha = (character) => character.repeat(64);

describe("desktop release set", () => {
  it("requires macOS and Windows in one stable release set without changing its release identity", () => {
    const release = releaseIdentity("stable");
    const releaseSet = createDesktopReleaseSet({
      releaseIdentity: release,
      targetBundles: [
        macBundle({ signed: true, notarized: true, stapled: true }),
        targetBundle("windows-x64", "authenticode", {
          signed: false,
          timestamped: false,
          publisherNames: [],
        }),
      ],
    });

    expect(releaseSet).toMatchObject({
      schemaVersion: 1,
      release,
      targetPolicy: { required: ["macos-arm64", "windows-x64"], optional: [] },
      targets: [
        { targetId: "macos-arm64", updateTrack: "squirrel" },
        { targetId: "windows-x64", updateTrack: "nsis" },
      ],
    });
  });

  it("allows optional Windows and Linux Internal bundles under one release identity", () => {
    const releaseSet = createDesktopReleaseSet({
      releaseIdentity: releaseIdentity("internal"),
      targetBundles: [
        macBundle({ signed: false, notarized: false, stapled: false }),
        targetBundle("windows-x64", "authenticode", {
          signed: false,
          timestamped: false,
          publisherNames: [],
        }),
        targetBundle("linux-x64", "linux", {
          provenanceAttested: true,
          packageSignature: null,
          repositorySignature: null,
        }),
      ],
    });

    expect(releaseSet.targetPolicy).toEqual({
      required: ["macos-arm64"],
      optional: ["windows-x64", "linux-x64"],
    });
    expect(releaseSet.targets.map((target) => target.targetId)).toEqual([
      "linux-x64",
      "macos-arm64",
      "windows-x64",
    ]);
  });

  it("rejects missing required targets, duplicate targets, and disabled channel targets", () => {
    expect(() => createDesktopReleaseSet({
      releaseIdentity: releaseIdentity("stable"),
      targetBundles: [targetBundle("windows-x64", "authenticode", {})],
    })).toThrow(/missing required targets: macos-arm64/);

    expect(() => createDesktopReleaseSet({
      releaseIdentity: releaseIdentity("stable"),
      targetBundles: [macBundle({})],
    })).toThrow(/missing required targets: windows-x64/);

    const internal = releaseIdentity("internal");
    expect(() => createDesktopReleaseSet({
      releaseIdentity: internal,
      targetBundles: [
        macBundle({}),
        macBundle({}),
      ],
    })).toThrow(/duplicate target macos-arm64/);

    expect(() => createDesktopReleaseSet({
      releaseIdentity: internal,
      targetBundles: [targetBundle("linux-x64", "linux", {})],
    })).toThrow(/missing required targets: macos-arm64/);
  });

  it("uses platform-discriminated security evidence", () => {
    expect(() => createDesktopTargetBundleDescriptor({
      ...targetBundle("windows-x64", "apple", {}),
    })).toThrow(/windows artifacts require authenticode/);
  });
});

function releaseIdentity(channel) {
  return resolveDesktopReleaseIdentity({
    baseVersion: "0.3.11",
    channel,
    commitSha: "a".repeat(40),
    buildNumber: "42",
    builtAt: "2026-08-29T00:00:00.000Z",
  });
}

function macBundle(security) {
  return targetBundle("macos-arm64", "apple", security);
}

function targetBundle(target, securityKind, security) {
  return {
    target,
    artifactName: `${target}.tar.gz`,
    bundleSha256: sha("b"),
    releaseManifestSha256: sha("c"),
    assetCount: 3,
    security: { kind: securityKind, ...security },
  };
}
