import { assertArtifactSecurity } from "../../../shared/desktop/artifact-contract.mjs";
import {
  assertDesktopReleaseIdentity,
  isDesktopPublishedChannel,
} from "../../../shared/desktop/release-identity.mjs";
import {
  getDesktopTargetDefinition,
  listDesktopTargets,
} from "../targets/target-manifest.mjs";

export const DESKTOP_RELEASE_SET_SCHEMA_VERSION = 1;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function createDesktopTargetBundleDescriptor({
  target,
  artifactName,
  bundleSha256,
  releaseManifestSha256,
  assetCount,
  security,
}) {
  const targetDefinition = getDesktopTargetDefinition(target);
  if (!SAFE_NAME_PATTERN.test(String(artifactName ?? ""))) {
    throw new Error("Desktop target bundle artifactName must be a safe filename.");
  }
  if (!SHA256_PATTERN.test(String(bundleSha256 ?? ""))) {
    throw new Error("Desktop target bundle requires a lowercase SHA-256 digest.");
  }
  if (!SHA256_PATTERN.test(String(releaseManifestSha256 ?? ""))) {
    throw new Error("Desktop target release manifest requires a lowercase SHA-256 digest.");
  }
  if (!Number.isSafeInteger(assetCount) || assetCount < 1) {
    throw new Error("Desktop target bundle assetCount must be a positive safe integer.");
  }
  return deepFreeze({
    targetId: targetDefinition.id,
    platform: targetDefinition.platform,
    arch: targetDefinition.arch,
    updateTrack: targetDefinition.updateTrack,
    artifactName,
    bundleSha256,
    releaseManifestSha256,
    assetCount,
    security: assertArtifactSecurity(security, targetDefinition.platform),
  });
}

export function createDesktopReleaseSet({ releaseIdentity, targetBundles }) {
  const release = assertDesktopReleaseIdentity(releaseIdentity);
  if (!isDesktopPublishedChannel(release.channel)) {
    throw new Error("Desktop Release Sets are only created for Internal or Stable channels.");
  }
  if (!Array.isArray(targetBundles) || targetBundles.length === 0) {
    throw new Error("Desktop Release Set requires at least one target bundle.");
  }

  const bundles = targetBundles.map((bundle) => createDesktopTargetBundleDescriptor(bundle));
  const seenTargets = new Set();
  for (const bundle of bundles) {
    if (seenTargets.has(bundle.targetId)) {
      throw new Error(`Desktop Release Set contains duplicate target ${bundle.targetId}.`);
    }
    seenTargets.add(bundle.targetId);
    const target = getDesktopTargetDefinition(bundle.targetId);
    if (target.participation[release.channel] === "disabled") {
      throw new Error(`${bundle.targetId} is disabled for the ${release.channel} release channel.`);
    }
  }

  const channelTargets = listDesktopTargets()
    .filter((target) => target.participation[release.channel] !== "disabled");
  const missingRequiredTargets = channelTargets
    .filter((target) => target.participation[release.channel] === "required")
    .filter((target) => !seenTargets.has(target.id))
    .map((target) => target.id);
  if (missingRequiredTargets.length > 0) {
    throw new Error(`Desktop Release Set is missing required targets: ${missingRequiredTargets.join(", ")}.`);
  }

  return deepFreeze({
    schemaVersion: DESKTOP_RELEASE_SET_SCHEMA_VERSION,
    product: release.product,
    release,
    targetPolicy: {
      required: channelTargets
        .filter((target) => target.participation[release.channel] === "required")
        .map((target) => target.id),
      optional: channelTargets
        .filter((target) => target.participation[release.channel] === "optional")
        .map((target) => target.id),
    },
    targets: bundles.sort((left, right) => left.targetId.localeCompare(right.targetId)),
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
