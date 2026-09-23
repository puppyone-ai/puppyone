import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import packageMetadata from "../../../../package.json";
import {
  inspectContinuousIntegrationWorkflow,
  inspectAtomicStableReleasePublisherWorkflow,
  inspectInternalReleaseWorkflow,
  inspectLegacyArchiveWorkflow,
  inspectReleasePublisherWorkflow,
  inspectStableReleaseWorkflow,
  inspectUpdateFeedMonitorWorkflow,
} from "../../../../scripts/release-support/internal-release-workflow-policy.mjs";
import {
  getStableReleaseCoordinates,
  inspectMacReleaseReadiness,
} from "../../../../scripts/release-support/macos-release-policy.mjs";
import { resolveDesktopBuildIdentity } from "../../../../shared/desktop-build-identity.mjs";
import { createDesktopElectronBuilderConfig } from "../../../../tooling/desktop/build/create-builder-config.mjs";
import { getDesktopTargetDefinition } from "../../../../tooling/desktop/targets/target-manifest.mjs";

const signingEnvironment = {
  CSC_LINK: "certificate.p12",
  CSC_KEY_PASSWORD: "password",
  APPLE_API_KEY: "AuthKey.p8",
  APPLE_API_KEY_ID: "KEY123",
  APPLE_API_ISSUER: "issuer-id",
};
const stableBuilderConfig = createDesktopElectronBuilderConfig({
  packageMetadata,
  buildInfo: resolveDesktopBuildIdentity({
    baseVersion: packageMetadata.version,
    buildNumber: 42,
    builtAt: "2026-08-29T00:00:00.000Z",
    channel: "stable",
    commitSha: "a".repeat(40),
  }),
  target: getDesktopTargetDefinition("macos-arm64"),
});

describe("macOS stable release policy", () => {
  it("accepts the production package config with complete signing and notarization credentials", () => {
    expect(inspectMacReleaseReadiness({
      packageMetadata,
      builderConfig: stableBuilderConfig,
      env: signingEnvironment,
      platform: "darwin",
    })).toEqual([]);
  });

  it("rejects internal signing overrides and partial notarization credentials", () => {
    const unsafeBuilderConfig = {
      ...stableBuilderConfig,
      mac: {
        ...stableBuilderConfig.mac,
        identity: "-",
        hardenedRuntime: false,
        notarize: false,
        strictVerify: false,
      },
    };
    const errors = inspectMacReleaseReadiness({
      packageMetadata,
      builderConfig: unsafeBuilderConfig,
      env: {
        CSC_IDENTITY_AUTO_DISCOVERY: "false",
        APPLE_ID: "release@example.com",
      },
      platform: "darwin",
    });

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/ad-hoc or disabled signing/i),
      expect.stringMatching(/hardenedRuntime/i),
      expect.stringMatching(/notarization credentials are incomplete/i),
      expect.stringMatching(/reserved for internal ad-hoc builds/i),
    ]));
  });

  it("requires upload credentials and a tag matching the package version", () => {
    const errors = inspectMacReleaseReadiness({
      packageMetadata,
      builderConfig: stableBuilderConfig,
      env: {
        ...signingEnvironment,
        PUPPYONE_RELEASE_TAG: "v9.9.9",
      },
      platform: "darwin",
      requireUploadCredentials: true,
    });

    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/must exactly match package version/i),
      expect.stringMatching(/AWS_ACCESS_KEY_ID/),
      expect.stringMatching(/AWS_SECRET_ACCESS_KEY/),
      expect.stringMatching(/CLOUDFLARE_ACCOUNT_ID/),
    ]));
  });

  it("uses immutable version and mutable latest R2 prefixes", () => {
    const coordinates = getStableReleaseCoordinates({
      packageMetadata,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "account",
        PUPPYONE_RELEASE_TAG: `v${packageMetadata.version}`,
      },
    });
    expect(coordinates).toEqual({
      bucket: "puppyone-desktop",
      endpoint: "https://account.r2.cloudflarestorage.com",
      latestPrefix: "desktop/stable/mac/latest",
      tag: `v${packageMetadata.version}`,
      versionPrefix: `desktop/stable/mac/v${packageMetadata.version}`,
    });
    expect(new URL(stableBuilderConfig.publish[0].url).pathname).toBe(`/${coordinates.latestPrefix}`);
  });
});

describe("continuous integration workflow", () => {
  it("runs source gates without release authority and pins actions", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    expect(inspectContinuousIntegrationWorkflow(workflow)).toEqual([]);
    expect(inspectContinuousIntegrationWorkflow(
      workflow.replace(/actions\/checkout@[a-f0-9]{40}/, "actions/checkout@v4"),
    )).toEqual(expect.arrayContaining([
      expect.stringMatching(/pinned to full commit SHAs/),
    ]));
  });
});

describe("macOS internal release workflow", () => {
  it("builds once and delegates atomic publication", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-internal-build.yml", import.meta.url),
      "utf8",
    );
    expect(inspectInternalReleaseWorkflow(workflow)).toEqual([]);
  });

  it("rejects an Internal workflow without the green-main source gate", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-internal-build.yml", import.meta.url),
      "utf8",
    ).replace("- name: Verify green main source", "- name: Unverified source");

    expect(inspectInternalReleaseWorkflow(workflow)).toContain(
      "the Internal workflow must reject non-main or unverified source commits",
    );
  });
});

describe("cross-platform stable release workflow", () => {
  it("builds macOS and Windows in parallel and publishes only their complete Release Set", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-stable-release.yml", import.meta.url),
      "utf8",
    );
    expect(inspectStableReleaseWorkflow(workflow)).toEqual([]);
  });

  it("rejects a workflow that can publish before the Windows build succeeds", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-stable-release.yml", import.meta.url),
      "utf8",
    ).replace("needs: [build-macos, build-windows]", "needs: build-macos");

    expect(inspectStableReleaseWorkflow(workflow)).toContain(
      "Stable publication must wait for both target builds",
    );
  });

  it("requires both native builders to consume one shared build timestamp", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-stable-release.yml", import.meta.url),
      "utf8",
    ).replace("--built-at \"${{ needs.resolve.outputs.built_at }}\"", "--built-at \"2026-01-01T00:00:00.000Z\"");

    expect(inspectStableReleaseWorkflow(workflow)).toContain(
      "macOS and Windows Stable builders must consume the same build timestamp",
    );
  });
});

describe("atomic Stable Release Set publisher", () => {
  it.each(["upload_bundle", "upload_asset_set", "stage_bundle"])("rejects serial %s transfers", task => {
    const workflow = readFileSync(new URL("../../../../.github/workflows/desktop-stable-release-publish.yml", import.meta.url), "utf8")
      .replace(`run_release_targets ${task}`, task);
    expect(inspectAtomicStableReleasePublisherWorkflow(workflow)).toEqual(expect.arrayContaining([
      expect.stringMatching(/must upload both targets concurrently/),
    ]));
  });

  it.each([
    ['--target "${WINDOWS_BUNDLE_DIRECTORY}" "${PUBLIC_UPDATE_ORIGIN}/${WINDOWS_LATEST_PREFIX}"', ""],
    ["--include-aliases true", "--include-aliases false"],
    ["--concurrency 3", "--concurrency 12"],
    ["# One pool bounds ALL platform/origin requests, including latest aliases.", "node scripts/verify-desktop-release-remote.mjs"],
  ])("rejects missing coverage or an independent verification pool: %s", (before, after) => {
    const workflow = readFileSync(new URL("../../../../.github/workflows/desktop-stable-release-publish.yml", import.meta.url), "utf8")
      .replace(before, after);
    expect(inspectAtomicStableReleasePublisherWorkflow(workflow).length).toBeGreaterThan(0);
  });

  it("validates both targets before mutation and compensates incomplete commits", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-stable-release-publish.yml", import.meta.url),
      "utf8",
    );
    expect(inspectAtomicStableReleasePublisherWorkflow(workflow)).toEqual([]);
  });

  it("rejects the old append-after-publication model", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-stable-release-publish.yml", import.meta.url),
      "utf8",
    ).replace("windows_artifact_name:", "append_github_assets:");

    expect(inspectAtomicStableReleasePublisherWorkflow(workflow)).toContain(
      "atomic Stable publication must never append a platform after release publication",
    );
  });
});

describe("desktop release publisher workflow", () => {
  it("publishes immutable GitHub and R2 records before mutable pointers", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-release-publish.yml", import.meta.url),
      "utf8",
    );
    expect(inspectReleasePublisherWorkflow(workflow)).toEqual([]);
  });

  it("requires the existing-release check to receive the Internal draft policy", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-release-publish.yml", import.meta.url),
      "utf8",
    ).replace(
      "          PUBLISH_GITHUB_RELEASE: ${{ inputs.publish_github_release }}\n          APPEND_GITHUB_ASSETS: ${{ inputs.append_github_assets }}\n          RELEASE_TAG: ${{ steps.release.outputs.tag }}",
      "          RELEASE_TAG: ${{ steps.release.outputs.tag }}",
    );

    expect(inspectReleasePublisherWorkflow(workflow)).toContain(
      "the GitHub release-state step must receive the caller's draft/public policy explicitly",
    );
  });

  it("requires final GitHub verification to preserve the Internal draft policy", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-release-publish.yml", import.meta.url),
      "utf8",
    ).replace(
      "          PUBLISH_GITHUB_RELEASE: ${{ inputs.publish_github_release }}\n          RELEASE_COMMIT: ${{ steps.release.outputs.commit }}",
      "          RELEASE_COMMIT: ${{ steps.release.outputs.commit }}",
    );

    expect(inspectReleasePublisherWorkflow(workflow)).toContain(
      "the final GitHub release verification must receive the caller's draft/public policy explicitly",
    );
  });

  it("requires every machine-origin verification stage to remain Stable-only", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-release-publish.yml", import.meta.url),
      "utf8",
    ).replace(
      "      - name: Verify existing Stable update origin before publication\n        if: ${{ inputs.channel == 'stable' }}",
      "      - name: Verify existing Stable update origin before publication",
    );

    expect(inspectReleasePublisherWorkflow(workflow)).toContain(
      'the "Verify existing Stable update origin before publication" stage must run only for Stable publication',
    );
  });

  it("keeps the distribution preflight read-only and ahead of deployment authority", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-release-publish.yml", import.meta.url),
      "utf8",
    ).replace(
      "    permissions:\n      contents: read",
      "    permissions:\n      contents: write",
    );

    expect(inspectReleasePublisherWorkflow(workflow)).toContain(
      "the distribution preflight must override publication authority with a read-only token",
    );
  });
});

describe("desktop legacy archive workflow", () => {
  it("verifies archive copies and catalog state before optional deletion", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-legacy-archive.yml", import.meta.url),
      "utf8",
    );
    expect(inspectLegacyArchiveWorkflow(workflow)).toEqual([]);
  });
});

describe("desktop Stable update feed monitor workflow", () => {
  it("checks every shipped feed on a schedule without deployment authority", () => {
    const workflow = readFileSync(
      new URL("../../../../.github/workflows/desktop-update-feed-monitor.yml", import.meta.url),
      "utf8",
    );
    expect(inspectUpdateFeedMonitorWorkflow(workflow)).toEqual([]);
    expect(inspectUpdateFeedMonitorWorkflow(
      workflow.replace("permissions:\n  contents: read", "permissions:\n  contents: write"),
    )).toEqual(expect.arrayContaining([
      expect.stringMatching(/read-only token/),
      expect.stringMatching(/must not receive repository write permission/),
    ]));
  });
});
