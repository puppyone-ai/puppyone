import {
  getDesktopApplicationChannelPolicy,
  getDesktopTargetSecurityPolicy,
  resolveDesktopApplicationIdentity,
} from "./desktop/application-identity.mjs";
import { createDesktopTarget } from "./desktop/platform-contract.mjs";
import {
  DESKTOP_BUILD_CHANNELS,
  DESKTOP_BUILD_PRODUCT,
  DESKTOP_PUBLISHED_CHANNELS,
  assertDesktopReleaseIdentity,
  createDesktopReleaseName,
  createDesktopReleaseTag,
  isDesktopBuildChannel,
  isDesktopPublishedChannel,
  resolveDesktopReleaseIdentity,
} from "./desktop/release-identity.mjs";

export const DESKTOP_BUILD_INFO_SCHEMA_VERSION = 1;
export const DESKTOP_BUILD_RUNTIMES = Object.freeze(["electron", "gpui"]);
export {
  DESKTOP_BUILD_CHANNELS,
  DESKTOP_BUILD_PRODUCT,
  DESKTOP_PUBLISHED_CHANNELS,
  isDesktopBuildChannel,
  isDesktopPublishedChannel,
};

const LEGACY_MAC_TARGET = createDesktopTarget({ platform: "macos", arch: "arm64" });
const BUILD_INFO_KEYS = Object.freeze([
  "schemaVersion",
  "product",
  "runtime",
  "channel",
  "baseVersion",
  "version",
  "buildId",
  "platformBuildNumber",
  "commitSha",
  "builtAt",
  "sourceDirty",
]);

// Compatibility façade for shipped schema-1 build-info.json and existing
// callers. New build tooling consumes Release Identity and Application
// Identity separately.
export function resolveDesktopBuildIdentity(options) {
  const releaseIdentity = resolveDesktopReleaseIdentity(options);
  const applicationIdentity = resolveDesktopApplicationIdentity({
    releaseIdentity,
    target: LEGACY_MAC_TARGET,
  });
  return deepFreeze({
    ...releaseIdentity,
    schemaVersion: DESKTOP_BUILD_INFO_SCHEMA_VERSION,
    platformBuildNumber: applicationIdentity.platformBuildNumber,
  });
}

export function getDesktopBuildChannelPolicy(channel) {
  const policy = getDesktopApplicationChannelPolicy(channel);
  const security = getDesktopTargetSecurityPolicy({ channel, target: LEGACY_MAC_TARGET });
  return deepFreeze({
    ...policy,
    updateFeedUrl: getLegacyUpdateFeedUrl(channel),
    requiresDeveloperIdSignature: security.requiresDeveloperIdSignature,
    requiresNotarization: security.requiresNotarization,
  });
}

export function createDesktopBuildTag(buildInfo) {
  return createDesktopReleaseTag(toReleaseIdentity(assertDesktopBuildInfo(buildInfo)));
}

export function createDesktopBuildReleaseName(buildInfo) {
  return createDesktopReleaseName(toReleaseIdentity(assertDesktopBuildInfo(buildInfo)));
}

export function createDesktopBuildR2Prefix(buildInfo, platform = "mac") {
  const identity = assertDesktopBuildInfo(buildInfo);
  if (!isDesktopPublishedChannel(identity.channel)) {
    throw new Error("Development builds do not have release distribution coordinates.");
  }
  return `desktop/${identity.channel}/${platform}/${createDesktopBuildTag(identity)}`;
}

export function inspectDesktopBuildInfo(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["build info must be an object"];
  }
  const unknownKeys = Object.keys(value).filter((key) => !BUILD_INFO_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    errors.push(`build info contains unsupported fields: ${unknownKeys.sort().join(", ")}`);
  }
  if (value.schemaVersion !== DESKTOP_BUILD_INFO_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${DESKTOP_BUILD_INFO_SCHEMA_VERSION}`);
  }
  if (value.runtime !== undefined && !DESKTOP_BUILD_RUNTIMES.includes(value.runtime)) {
    errors.push("runtime must be electron or gpui");
  }
  try {
    const release = assertDesktopReleaseIdentity(toReleaseIdentity(value));
    const expectedPlatformBuildNumber = release.channel === "dev" ? null : release.buildId;
    if (value.platformBuildNumber !== expectedPlatformBuildNumber) {
      errors.push(`platformBuildNumber does not match the canonical ${release.channel} build identity`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const lines = detail.split("\n").slice(1).map((line) => line.replace(/^- /, ""));
    errors.push(...(lines.length > 0 ? lines : [detail]));
  }
  return [...new Set(errors)];
}

export function assertDesktopBuildInfo(value) {
  const errors = inspectDesktopBuildInfo(value);
  if (errors.length > 0) {
    throw new Error(`Invalid PuppyOne Desktop build identity:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }
  return deepFreeze(structuredClone(value));
}

export function toDesktopReleaseIdentity(buildInfo) {
  return assertDesktopReleaseIdentity(toReleaseIdentity(assertDesktopBuildInfo(buildInfo)));
}

function getLegacyUpdateFeedUrl(channel) {
  if (channel === "dev") return null;
  const releaseIdentity = resolveDesktopReleaseIdentity({
    baseVersion: "0.0.0",
    channel,
    commitSha: "0".repeat(40),
    buildNumber: 1,
    builtAt: "1970-01-01T00:00:00.000Z",
  });
  return resolveDesktopApplicationIdentity({
    releaseIdentity,
    target: LEGACY_MAC_TARGET,
  }).updateFeedUrl;
}

function toReleaseIdentity(value) {
  return {
    schemaVersion: 1,
    product: value?.product,
    channel: value?.channel,
    baseVersion: value?.baseVersion,
    version: value?.version,
    buildId: value?.buildId,
    commitSha: value?.commitSha,
    builtAt: value?.builtAt,
    sourceDirty: value?.sourceDirty,
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
