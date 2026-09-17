#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectContinuousIntegrationWorkflow,
  inspectInternalReleaseWorkflow,
  inspectLegacyArchiveWorkflow,
  inspectReleasePublisherWorkflow,
  inspectStableReleaseWorkflow,
  inspectUpdateFeedMonitorWorkflow,
} from "./release-support/internal-release-workflow-policy.mjs";
import { inspectMacReleaseReadiness } from "./release-support/macos-release-policy.mjs";
import { resolveDesktopBuildIdentity } from "../shared/desktop-build-identity.mjs";
import { createDesktopElectronBuilderConfig } from "../tooling/desktop/build/create-builder-config.mjs";
import { getDesktopTargetDefinition } from "../tooling/desktop/targets/target-manifest.mjs";
import { resolveDesktopAppIcon } from "../shared/desktop/app-icon-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const packageMetadata = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const stableMacConfig = createDesktopElectronBuilderConfig({
  packageMetadata,
  buildInfo: resolveDesktopBuildIdentity({
    baseVersion: packageMetadata.version,
    buildNumber: 1,
    builtAt: "2026-01-01T00:00:00.000Z",
    channel: "stable",
    commitSha: "a".repeat(40),
  }),
  target: getDesktopTargetDefinition("macos-arm64"),
});
const errors = inspectMacReleaseReadiness({
  packageMetadata,
  builderConfig: stableMacConfig,
  platform: "darwin",
  env: {
    CSC_LINK: "configured-by-ci",
    CSC_KEY_PASSWORD: "configured-by-ci",
    APPLE_API_KEY: "configured-by-ci",
    APPLE_API_KEY_ID: "configured-by-ci",
    APPLE_API_ISSUER: "configured-by-ci",
  },
});

const scripts = packageMetadata.scripts ?? {};
if (stableMacConfig.beforePack !== "scripts/before-pack-macos-icon.mjs"
  || stableMacConfig.afterPack !== "scripts/after-pack-macos-icon.mjs") {
  errors.push("macOS packaging must prepare and verify the native channel ICNS");
}
const canonicalAppImagePath = resolveDesktopAppIcon("stable").source;
const developmentAppImagePath = resolveDesktopAppIcon("dev").source;
readFileSync(path.join(repoRoot, canonicalAppImagePath));
readFileSync(path.join(repoRoot, developmentAppImagePath));
if (stableMacConfig.mac?.icon !== resolveDesktopAppIcon("stable").macos) {
  errors.push("the macOS application icon must use the generated native ICNS");
}
if (!stableMacConfig.extraResources?.some((entry) => (
  entry?.from === canonicalAppImagePath && entry?.to === "puppy-app-image.png"
))) {
  errors.push("the canonical App Image must be copied into native app resources");
}
const dmg = stableMacConfig.dmg ?? {};
const expectedDmgContents = [
  { x: 200, y: 204 },
  { x: 520, y: 204, type: "link", path: "/Applications" },
];
if (dmg.title !== "${productName} Installer") {
  errors.push("the macOS installer volume must use the channel-aware product name");
}
if (dmg.background !== "build/dmg-background.tiff") {
  errors.push("the macOS installer must use the PuppyOne onboarding background");
}
if (dmg.iconSize !== 128 || dmg.iconTextSize !== 14) {
  errors.push("the macOS installer icons must retain the approved visual scale");
}
if (dmg.window?.width !== 720 || dmg.window?.height !== 440) {
  errors.push("the macOS installer must retain the approved 720x440 composition");
}
if (JSON.stringify(dmg.contents) !== JSON.stringify(expectedDmgContents)) {
  errors.push("the macOS installer must keep the app and Applications drop target aligned with the paw trail");
}
try {
  readFileSync(path.join(repoRoot, dmg.background));
} catch {
  errors.push("the rendered macOS installer background is missing; run npm run generate:dmg-background");
}
if (!scripts["generate:dmg-background"]?.includes("render-dmg-background.mjs")) {
  errors.push("the macOS installer background must have a reproducible renderer");
}
if (!scripts["dist:mac"]?.includes("prepare:desktop-build:dev")) {
  errors.push("local macOS packaging must resolve Development Build Identity before packaging");
}
if (!scripts["dist:mac:prepared"]?.includes("--config generated/electron-builder.json")) {
  errors.push("prepared macOS packaging must consume the generated channel-specific configuration");
}
if (!scripts["dist:mac:prepared"]?.includes("CSC_IDENTITY_AUTO_DISCOVERY=false")) {
  errors.push("Development and Internal packaging must disable certificate auto-discovery");
}
if (scripts["publish:mac:r2"] || scripts["dist:mac:publish"]) {
  errors.push("stable R2 publishing must only happen through the canonical GitHub Release workflow");
}
if (
  scripts["prepare:mac:release"] !== "npm run check:shared-ui && npm run build && npm run check:viewer-pack-trust"
  || scripts["package:mac:release"] !== "node scripts/build-macos-stable-release.mjs --package-only"
) {
  errors.push("stable CI must prepare without deployment secrets before entering the signing step");
}

const ciWorkflow = readFileSync(
  path.join(repoRoot, ".github", "workflows", "ci.yml"),
  "utf8",
);
errors.push(...inspectContinuousIntegrationWorkflow(ciWorkflow));
const internalWorkflow = readFileSync(
  path.join(repoRoot, ".github", "workflows", "desktop-internal-build.yml"),
  "utf8",
);
errors.push(...inspectInternalReleaseWorkflow(internalWorkflow));
const stableWorkflow = readFileSync(
  path.join(repoRoot, ".github", "workflows", "desktop-stable-release.yml"),
  "utf8",
);
errors.push(...inspectStableReleaseWorkflow(stableWorkflow));
const publisherWorkflow = readFileSync(
  path.join(repoRoot, ".github", "workflows", "desktop-release-publish.yml"),
  "utf8",
);
errors.push(...inspectReleasePublisherWorkflow(publisherWorkflow));
const archiveWorkflow = readFileSync(
  path.join(repoRoot, ".github", "workflows", "desktop-legacy-archive.yml"),
  "utf8",
);
errors.push(...inspectLegacyArchiveWorkflow(archiveWorkflow));
const updateFeedMonitorWorkflow = readFileSync(
  path.join(repoRoot, ".github", "workflows", "desktop-update-feed-monitor.yml"),
  "utf8",
);
errors.push(...inspectUpdateFeedMonitorWorkflow(updateFeedMonitorWorkflow));

try {
  const { validateConfiguration } = require("app-builder-lib/out/util/config/config.js");
  await validateConfiguration(stableMacConfig, { isEnabled: false, add() {} });
} catch (error) {
  errors.push(`electron-builder rejected the production configuration: ${error.message}`);
}

if (errors.length > 0) {
  console.error("macOS release configuration check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("macOS release configuration check passed.");
