import { assertDesktopTarget } from "./platform-contract.mjs";

export const DESKTOP_RELEASE_BUCKET = "puppyone-desktop";
export const DESKTOP_PUBLIC_DOWNLOAD_ORIGIN = "https://downloads.puppyone.ai";
export const DESKTOP_STABLE_UPDATE_ORIGIN = "https://updates.puppyone.ai";

export const DESKTOP_UPDATE_TRACK_BY_PLATFORM = Object.freeze({
  macos: "squirrel",
  windows: "nsis",
  linux: "appimage",
});

export const DESKTOP_INTERNAL_UPDATE_FEED_URL = joinOriginPath(
  DESKTOP_PUBLIC_DOWNLOAD_ORIGIN,
  "/desktop/internal/mac/latest",
);
export const DESKTOP_STABLE_UPDATE_FEED_URL = joinOriginPath(
  DESKTOP_STABLE_UPDATE_ORIGIN,
  "/desktop/stable/mac/latest",
);
export const DESKTOP_STABLE_LATEST_POINTER_URL = joinOriginPath(
  DESKTOP_PUBLIC_DOWNLOAD_ORIGIN,
  "/desktop/stable/mac/latest/latest.json",
);
export const DESKTOP_STABLE_UPDATE_METADATA_NAME = "stable-mac.yml";

// Every feed embedded in a shipped Stable application remains a compatibility
// endpoint. Future migrations append a contract; they never replace an entry.
export const DESKTOP_SHIPPED_STABLE_UPDATE_CONTRACTS = Object.freeze([
  Object.freeze({
    feedUrl: DESKTOP_STABLE_UPDATE_FEED_URL,
    introducedInVersion: "0.1.4",
    platform: "macos",
    updateTrack: "squirrel",
  }),
]);

export const DESKTOP_SUPPORTED_STABLE_UPDATE_FEED_URLS = Object.freeze(
  DESKTOP_SHIPPED_STABLE_UPDATE_CONTRACTS.map(({ feedUrl }) => feedUrl),
);

export function createDesktopDistributionCoordinate({ channel, target, updateTrack = null }) {
  if (channel !== "internal" && channel !== "stable") {
    throw new Error("Desktop distribution coordinates require internal or stable channel.");
  }
  const normalizedTarget = assertDesktopTarget(target);
  const normalizedTrack = updateTrack ?? DESKTOP_UPDATE_TRACK_BY_PLATFORM[normalizedTarget.platform];
  if (!/^[a-z][a-z0-9-]*$/.test(String(normalizedTrack ?? ""))) {
    throw new Error(`Invalid Desktop update track: ${String(normalizedTrack)}`);
  }
  return Object.freeze({
    channel,
    platform: normalizedTarget.platform,
    arch: normalizedTarget.arch,
    updateTrack: normalizedTrack,
  });
}

export function getDesktopTargetUpdateFeedUrl({ channel, target, updateTrack = null }) {
  if (channel === "dev") return null;
  const coordinate = createDesktopDistributionCoordinate({ channel, target, updateTrack });

  // Preserve the exact path embedded in every shipped macOS application. New
  // targets use the platform-neutral coordinate shape below.
  if (coordinate.platform === "macos") {
    return channel === "stable"
      ? DESKTOP_STABLE_UPDATE_FEED_URL
      : DESKTOP_INTERNAL_UPDATE_FEED_URL;
  }

  const origin = channel === "stable"
    ? DESKTOP_STABLE_UPDATE_ORIGIN
    : DESKTOP_PUBLIC_DOWNLOAD_ORIGIN;
  return joinOriginPath(
    origin,
    `/desktop/${channel}/${coordinate.platform}/${coordinate.arch}/${coordinate.updateTrack}/latest`,
  );
}

export function createDesktopImmutableReleasePrefix({ releaseTag, channel, target }) {
  if (channel !== "internal" && channel !== "stable") {
    throw new Error("Desktop immutable release prefix requires internal or stable channel.");
  }
  if (!/^v[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(releaseTag ?? ""))) {
    throw new Error("Desktop immutable release prefix requires a canonical release tag.");
  }
  const normalizedTarget = assertDesktopTarget(target);
  const platformKey = normalizedTarget.platform === "macos" ? "mac" : normalizedTarget.platform;
  return `desktop/${channel}/${platformKey}/${releaseTag}/${normalizedTarget.arch}`;
}

export function createDesktopLatestReleasePrefix({ channel, target, updateTrack = null }) {
  const coordinate = createDesktopDistributionCoordinate({ channel, target, updateTrack });
  if (coordinate.platform === "macos") {
    return `desktop/${channel}/mac/latest`;
  }
  return `desktop/${channel}/${coordinate.platform}/${coordinate.arch}/${coordinate.updateTrack}/latest`;
}

export function createDesktopReleaseCatalogKey({ channel, target, updateTrack = null }) {
  const coordinate = createDesktopDistributionCoordinate({ channel, target, updateTrack });
  if (coordinate.platform === "macos") {
    return channel === "internal"
      ? "desktop/internal/catalog/releases.json"
      : "desktop/catalog/releases.json";
  }
  return `desktop/${channel}/${coordinate.platform}/${coordinate.arch}/${coordinate.updateTrack}/releases.json`;
}

function joinOriginPath(origin, pathname) {
  const url = new URL(pathname, `${origin}/`);
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(`Invalid Desktop distribution URL: ${url.href}`);
  }
  return url.href.replace(/\/+$/, "");
}
