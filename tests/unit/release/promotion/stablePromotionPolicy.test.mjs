import { describe, expect, it } from "vitest";
import { mergeReleaseCatalog } from "../../../../scripts/release-support/desktop-release-metadata.mjs";
import {
  assertStablePromotionCoordinates,
  selectStablePromotionSource,
} from "../../../../scripts/release-support/stable-promotion-policy.mjs";
import { resolveDesktopBuildIdentity } from "../../../../shared/desktop-build-identity.mjs";

const commitSha = "f".repeat(40);

describe("Stable promotion policy", () => {
  it("selects the newest verified Internal release for the exact source commit", () => {
    const older = releaseFixture(41, "2026-07-26T09:00:00.000Z");
    const newer = releaseFixture(42, "2026-07-26T10:00:00.000Z");
    const catalog = mergeReleaseCatalog(
      mergeReleaseCatalog(null, older, "2026-07-26T09:00:00.000Z"),
      newer,
      "2026-07-26T10:00:00.000Z",
    );

    expect(selectStablePromotionSource({
      catalog,
      baseVersion: "1.4.0",
      commitSha,
      sourceTag: "v1.4.0-internal.41",
    }).tag).toBe("v1.4.0-internal.41");
  });

  it("never substitutes a newer unapproved Internal build for the selected candidate", () => {
    const approved = releaseFixture(41, "2026-07-26T09:00:00.000Z");
    const unapproved = releaseFixture(42, "2026-07-26T10:00:00.000Z");
    const catalog = mergeReleaseCatalog(
      mergeReleaseCatalog(null, approved, "2026-07-26T09:00:00.000Z"),
      unapproved,
      "2026-07-26T10:00:00.000Z",
    );

    expect(selectStablePromotionSource({
      catalog,
      baseVersion: "1.4.0",
      commitSha,
      sourceTag: "v1.4.0-internal.41",
    })).toStrictEqual(approved);
  });

  it("rejects unknown commits, legacy manifests, and withdrawn releases", () => {
    const release = releaseFixture(42, "2026-07-26T10:00:00.000Z");
    const catalog = mergeReleaseCatalog(null, release);
    expect(() => selectStablePromotionSource({
      catalog,
      baseVersion: "1.4.0",
      commitSha: "0".repeat(40),
      sourceTag: "v1.4.0-internal.42",
    })).toThrow(/Verified Internal candidate/);

    const withdrawnCatalog = structuredClone(catalog);
    withdrawnCatalog.releases[0].withdrawnAt = "2026-07-26T11:00:00.000Z";
    expect(() => selectStablePromotionSource({
      catalog: withdrawnCatalog,
      baseVersion: "1.4.0",
      commitSha,
      sourceTag: "v1.4.0-internal.42",
    })).toThrow(/Verified Internal candidate/);
  });

  it("requires an explicit candidate tag for the same base version", () => {
    const catalog = mergeReleaseCatalog(
      null,
      releaseFixture(42, "2026-07-26T10:00:00.000Z"),
    );

    expect(() => selectStablePromotionSource({
      catalog,
      baseVersion: "1.4.0",
      commitSha,
    })).toThrow(/explicit Internal candidate tag/);
    expect(() => selectStablePromotionSource({
      catalog,
      baseVersion: "1.4.0",
      commitSha,
      sourceTag: "v1.5.0-internal.42",
    })).toThrow(/explicit Internal candidate tag/);
  });

  it("keeps authenticated promotion downloads on the Internal distribution origin", () => {
    const release = releaseFixture(42, "2026-07-26T10:00:00.000Z");
    expect(assertStablePromotionCoordinates({
      source: release,
      catalogUrl: "https://downloads.puppyone.ai/desktop/internal/catalog/releases.json",
    })).toBe(release);

    const hostile = structuredClone(release);
    hostile.assets[0].r2.url = "https://attacker.invalid/desktop/internal/build.dmg";
    expect(() => assertStablePromotionCoordinates({
      source: hostile,
      catalogUrl: "https://downloads.puppyone.ai/desktop/internal/catalog/releases.json",
    })).toThrow(/must stay on https:\/\/downloads\.puppyone\.ai/);
  });
});

function releaseFixture(buildNumber, publishedAt) {
  const buildInfo = resolveDesktopBuildIdentity({
    baseVersion: "1.4.0",
    buildNumber,
    builtAt: publishedAt,
    channel: "internal",
    commitSha,
  });
  return {
    schemaVersion: 2,
    product: "puppyone-desktop",
    tag: `v${buildInfo.version}`,
    version: buildInfo.version,
    baseVersion: buildInfo.baseVersion,
    build: {
      id: buildInfo.buildId,
      platformBuildNumber: buildInfo.platformBuildNumber,
      builtAt: buildInfo.builtAt,
      sourceDirty: false,
    },
    promotion: null,
    channel: "internal",
    provenance: "pipeline",
    prerelease: true,
    publishedAt,
    commitSha,
    source: {
      repository: "puppyone-ai/puppyone",
      workflowRunUrl: "https://github.com/puppyone-ai/puppyone/actions/runs/123",
    },
    github: {
      releaseUrl: `https://github.com/puppyone-ai/puppyone/releases/tag/v${buildInfo.version}`,
      visibility: "draft",
    },
    r2: {
      prefix: `desktop/internal/mac/v${buildInfo.version}`,
      manifestUrl: `https://downloads.puppyone.ai/desktop/internal/mac/v${buildInfo.version}/release.json`,
      checksumsUrl: `https://downloads.puppyone.ai/desktop/internal/mac/v${buildInfo.version}/SHA256SUMS`,
      buildInfoUrl: `https://downloads.puppyone.ai/desktop/internal/mac/v${buildInfo.version}/build-info.json`,
    },
    security: {
      developerIdSigned: false,
      notarized: false,
    },
    assets: [
      assetFixture(buildInfo.version, "dmg"),
      assetFixture(buildInfo.version, "zip"),
      assetFixture(buildInfo.version, "terminal-preview"),
    ],
  };
}

function assetFixture(version, kind) {
  const extension = kind === "terminal-preview" ? "tgz" : kind;
  const name = kind === "terminal-preview"
    ? `puppyone-desktop-terminal-preview-${version}.${extension}`
    : `puppyone-${version}-arm64.${extension}`;
  const prefix = `desktop/internal/mac/v${version}`;
  return {
    name,
    kind,
    platform: "macos",
    arch: "arm64",
    bytes: 10,
    sha256: "a".repeat(64),
    r2: {
      key: `${prefix}/${name}`,
      url: `https://downloads.puppyone.ai/${prefix}/${name}`,
    },
    github: {
      url: `https://github.com/puppyone-ai/puppyone/releases/download/v${version}/${name}`,
    },
    latestAlias: kind === "terminal-preview"
      ? "puppyone-terminal-preview-latest-arm64.tgz"
      : `puppyone-latest-arm64.${extension}`,
  };
}
