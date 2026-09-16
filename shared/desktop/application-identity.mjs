import { getDesktopTargetUpdateFeedUrl } from "./distribution-contract.mjs";
import { assertDesktopTarget } from "./platform-contract.mjs";
import { assertDesktopReleaseIdentity, isDesktopBuildChannel } from "./release-identity.mjs";

const CHANNEL_APPLICATION_POLICIES = deepFreeze({
  dev: {
    applicationId: "ai.puppyone.desktop.dev",
    applicationName: "PuppyOne Development",
    userDataName: "puppyone-development",
    releaseChannel: null,
    releaseAudience: "local",
    updateChannel: null,
    published: false,
  },
  internal: {
    applicationId: "ai.puppyone.desktop.internal",
    applicationName: "PuppyOne Internal",
    userDataName: "puppyone-internal",
    releaseChannel: "internal",
    releaseAudience: "restricted",
    updateChannel: "internal",
    published: true,
  },
  stable: {
    applicationId: "ai.puppyone.desktop",
    applicationName: "PuppyOne",
    userDataName: "puppyone",
    releaseChannel: "stable",
    releaseAudience: "public",
    updateChannel: "stable",
    published: true,
  },
});

export function getDesktopApplicationChannelPolicy(channel) {
  if (!isDesktopBuildChannel(channel)) {
    throw new Error(`Unsupported PuppyOne Desktop build channel: ${String(channel)}`);
  }
  return CHANNEL_APPLICATION_POLICIES[channel];
}

export function resolveDesktopApplicationIdentity({ releaseIdentity, target }) {
  const release = assertDesktopReleaseIdentity(releaseIdentity);
  const normalizedTarget = assertDesktopTarget(target);
  const policy = getDesktopApplicationChannelPolicy(release.channel);
  return deepFreeze({
    platform: normalizedTarget.platform,
    arch: normalizedTarget.arch,
    applicationId: policy.applicationId,
    applicationName: policy.applicationName,
    userDataName: policy.userDataName,
    platformBuildNumber: release.channel === "dev" ? null : release.buildId,
    updateChannel: policy.updateChannel,
    updateFeedUrl: getDesktopTargetUpdateFeedUrl({
      channel: release.channel,
      target: normalizedTarget,
    }),
  });
}

export function getDesktopTargetSecurityPolicy({ channel, target }) {
  if (!isDesktopBuildChannel(channel)) {
    throw new Error(`Unsupported PuppyOne Desktop build channel: ${String(channel)}`);
  }
  const normalizedTarget = assertDesktopTarget(target);
  const stable = channel === "stable";
  return deepFreeze({
    kind: normalizedTarget.platform === "macos"
      ? "apple"
      : normalizedTarget.platform === "windows"
        ? "authenticode"
        : "linux",
    requiresDeveloperIdSignature: stable && normalizedTarget.platform === "macos",
    requiresNotarization: stable && normalizedTarget.platform === "macos",
    requiresAuthenticodeSignature: false,
    requiresTrustedTimestamp: false,
    allowsUnsignedDistribution: normalizedTarget.platform === "windows",
    requiresProvenanceAttestation: channel !== "dev",
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
