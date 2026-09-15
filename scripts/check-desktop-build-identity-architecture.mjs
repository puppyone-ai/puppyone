#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DESKTOP_BUILD_CHANNELS,
  getDesktopBuildChannelPolicy,
  resolveDesktopBuildIdentity,
} from "../shared/desktop-build-identity.mjs";
import {
  DESKTOP_INTERNAL_UPDATE_FEED_URL,
  DESKTOP_PUBLIC_DOWNLOAD_ORIGIN,
  DESKTOP_SHIPPED_STABLE_UPDATE_CONTRACTS,
  DESKTOP_STABLE_LATEST_POINTER_URL,
  DESKTOP_STABLE_UPDATE_ORIGIN,
  DESKTOP_STABLE_UPDATE_FEED_URL,
  DESKTOP_SUPPORTED_STABLE_UPDATE_FEED_URLS,
} from "../shared/desktop-distribution-contract.mjs";
import { createDesktopElectronBuilderConfig } from "./release-support/desktop-build-preparation.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const packageMetadata = await readJson("package.json");
const commitSha = "a".repeat(40);

if (DESKTOP_BUILD_CHANNELS.join(",") !== "dev,internal,stable") {
  errors.push("the active Desktop build-channel union must be exactly dev, internal, stable");
}

const policies = DESKTOP_BUILD_CHANNELS.map(getDesktopBuildChannelPolicy);
for (const field of ["applicationId", "applicationName", "userDataName"]) {
  if (new Set(policies.map((policy) => policy[field])).size !== policies.length) {
    errors.push(`every Desktop channel must have a unique ${field}`);
  }
}
if (getDesktopBuildChannelPolicy("dev").updateFeedUrl !== null) {
  errors.push("Development builds must not have a product update feed");
}
if (getDesktopBuildChannelPolicy("internal").updateFeedUrl !== DESKTOP_INTERNAL_UPDATE_FEED_URL) {
  errors.push("Internal builds must use the canonical Internal distribution feed");
}
if (getDesktopBuildChannelPolicy("stable").updateFeedUrl !== DESKTOP_STABLE_UPDATE_FEED_URL) {
  errors.push("Stable builds must use the permanent Stable machine update feed");
}
if (!DESKTOP_SUPPORTED_STABLE_UPDATE_FEED_URLS.includes(DESKTOP_STABLE_UPDATE_FEED_URL)) {
  errors.push("the canonical Stable feed must remain in the shipped-feed compatibility registry");
}
if (
  DESKTOP_PUBLIC_DOWNLOAD_ORIGIN === DESKTOP_STABLE_UPDATE_ORIGIN
  || new URL(DESKTOP_STABLE_LATEST_POINTER_URL).origin !== DESKTOP_PUBLIC_DOWNLOAD_ORIGIN
  || new URL(DESKTOP_STABLE_UPDATE_FEED_URL).origin !== DESKTOP_STABLE_UPDATE_ORIGIN
) {
  errors.push("human download and Stable machine-update origins must retain separate roles");
}
if (
  new Set(DESKTOP_SUPPORTED_STABLE_UPDATE_FEED_URLS).size
  !== DESKTOP_SUPPORTED_STABLE_UPDATE_FEED_URLS.length
) {
  errors.push("the shipped Stable feed compatibility registry must not contain duplicates");
}
for (const contract of DESKTOP_SHIPPED_STABLE_UPDATE_CONTRACTS) {
  if (
    !/^\d+\.\d+\.\d+$/.test(contract.introducedInVersion)
    || new URL(contract.feedUrl).protocol !== "https:"
  ) {
    errors.push("every shipped Stable feed contract must declare an HTTPS URL and release version");
  }
}
if (
  !DESKTOP_SHIPPED_STABLE_UPDATE_CONTRACTS.some(({ introducedInVersion, feedUrl }) => (
    introducedInVersion === "0.1.4" && feedUrl === DESKTOP_STABLE_UPDATE_FEED_URL
  ))
) {
  errors.push("the shipped v0.1.4 Stable feed contract must remain registered");
}
const identities = {
  dev: resolveDesktopBuildIdentity({
    baseVersion: packageMetadata.version,
    channel: "dev",
    commitSha,
  }),
  internal: resolveDesktopBuildIdentity({
    baseVersion: packageMetadata.version,
    buildNumber: 101,
    channel: "internal",
    commitSha,
  }),
  stable: resolveDesktopBuildIdentity({
    baseVersion: packageMetadata.version,
    buildNumber: 102,
    channel: "stable",
    commitSha,
  }),
};

const configuredStableProvider = createDesktopElectronBuilderConfig({
  packageMetadata,
  buildInfo: identities.stable,
}).publish?.find?.((provider) => provider?.provider === "generic");
if (
  configuredStableProvider?.url !== DESKTOP_STABLE_UPDATE_FEED_URL
  || configuredStableProvider?.channel !== "stable"
) {
  errors.push("the generated Stable target config must embed the canonical machine update feed");
}

for (const channel of DESKTOP_BUILD_CHANNELS) {
  const config = createDesktopElectronBuilderConfig({
    packageMetadata,
    buildInfo: identities[channel],
  });
  if (config.extraMetadata?.version !== identities[channel].version) {
    errors.push(`${channel} packaging must inject the complete Build Identity version`);
  }
  if (!config.extraResources?.some((entry) => entry?.to === "build-info.json")) {
    errors.push(`${channel} packaging must embed build-info.json`);
  }
  if (config.mac?.bundleShortVersion !== identities[channel].baseVersion) {
    errors.push(`${channel} packaging must use the stable base as the macOS marketing version`);
  }
}

const packageScripts = packageMetadata.scripts ?? {};
if (!packageScripts.dev?.includes("prepare:desktop-build:dev")) {
  errors.push("the Electron development launcher must prepare Development Build Identity");
}
if (!packageScripts["dist:mac:prepared"]?.includes("generated/electron-builder.json")) {
  errors.push("prepared macOS packaging must consume the generated electron-builder configuration");
}

const mainSource = await readText("electron/main.mjs");
requireSource(mainSource, "loadDesktopBuildInfo", "Electron main must load Build Identity before constructing services");
requireSource(mainSource, "configureDesktopApplicationIdentity", "Electron main must configure channel isolation");
requireSource(mainSource, "registerBuildInfoIpcHandlers", "Electron main must expose typed Build Info IPC");
if (mainSource.includes("app.getVersion()")) {
  errors.push("Electron main services must receive Build Identity instead of calling app.getVersion()");
}

const updaterSource = await readText("electron/update-service.mjs");
requireSource(updaterSource, "getDesktopBuildChannelPolicy", "the updater must derive its feed from channel policy");
requireSource(
  updaterSource,
  'ipcMain.handle("updates:check"',
  "the Stable updater must retain the Settings-owned manual check command",
);
requireSource(
  updaterSource,
  "BACKGROUND_UPDATE_INITIAL_DELAY_MS",
  "the Stable updater must delay background discovery until after cold start",
);
requireSource(
  updaterSource,
  "BACKGROUND_UPDATE_INTERVAL_MS",
  "the Stable updater must rate-limit repeated background discovery",
);
requireSource(
  updaterSource,
  "scheduleBackgroundCheck(BACKGROUND_UPDATE_INITIAL_DELAY_MS)",
  "the Stable updater must schedule background discovery for supported builds",
);
requireSource(
  updaterSource,
  "autoUpdater.autoDownload = false",
  "background discovery must never become an automatic download",
);
for (const forbidden of [
  "PUPPYONE_DESKTOP_UPDATE_CHANNEL",
  "PUPPYONE_DESKTOP_UPDATE_URL",
  "normalizeUpdateChannel",
]) {
  if (updaterSource.includes(forbidden)) {
    errors.push(`packaged updater authority must not depend on ${forbidden}`);
  }
}

const rendererTypeSource = await readText("src/types/electron.d.ts");
requireSource(
  rendererTypeSource,
  'export type DesktopBuildChannel = "dev" | "internal" | "stable"',
  "renderer BuildChannel must contain exactly the three product channels",
);
if (/DesktopUpdateState[\s\S]{0,500}"beta"/.test(rendererTypeSource)) {
  errors.push("Beta must not remain in the active Desktop update contract");
}

const preloadSource = await readText("electron/preload.cjs");
requireSource(preloadSource, 'ipcRenderer.invoke("build-info:get")', "preload must expose read-only Build Info IPC");

const generalSettingsSource = await readText("src/features/settings/main/GeneralSettingsView.tsx");
requireSource(
  generalSettingsSource,
  "<DesktopBuildVersionSettingsRow />",
  "Settings General must own the user-facing Build Identity",
);
requireSource(
  generalSettingsSource,
  "<DesktopUpdateSettingsRow",
  "Settings General must retain the detailed update workflow",
);
const titlebarActionsSource = await readText("src/features/app-shell/DesktopTitlebarActions.tsx");
const titlebarUpdateSource = await readText("src/features/updates/DesktopUpdateTitlebarButton.tsx");
const updateModelSource = await readText("src/features/updates/updateModel.ts");
const updatePreviewSource = await readText("src/features/updates/updatePreview.ts");
const updateControllerSource = await readText("src/features/updates/useDesktopUpdates.ts");
requireSource(
  titlebarActionsSource,
  'group: "app-status"',
  "the conditional update affordance must lead the right-side Header tools",
);
requireSource(
  titlebarActionsSource,
  "<DesktopUpdateTitlebarButton",
  "the right-side Header tools must render the conditional update affordance",
);
requireSource(
  titlebarUpdateSource,
  "if (!presentation) return null",
  "the Header update affordance must occupy no space when it is hidden",
);
for (const visibleStatus of ["downloaded", "blocked", "installing"]) {
  requireSource(
    updateModelSource,
    `state.status === "${visibleStatus}"`,
    `the Header update selector must handle ${visibleStatus}`,
  );
}
requireSource(
  updateModelSource,
  'state.status === "available" && !state.automaticallyDownloadUpdates',
  "the Header update selector must expose manual download only after opt-out",
);
if (updateModelSource.includes('kind: "downloading"')) {
  errors.push("the Header update selector must keep downloading quiet");
}
if (/state\.status === "(?:disabled|idle|checking|not-available|error)"/.test(updateModelSource)) {
  errors.push("the Header update selector must not expose unavailable, current, checking, or error states");
}
requireSource(
  updatePreviewSource,
  "if (!isDevelopment",
  "the visual update fixture must be impossible to activate outside development",
);
requireSource(
  updateControllerSource,
  "isDevelopment: import.meta.env.DEV",
  "the update controller must bind the visual fixture to Vite development builds",
);
if (!packageScripts["dev:update-preview"]?.includes("VITE_DESKTOP_UPDATE_PREVIEW=downloaded")) {
  errors.push("the downloaded update affordance must have an explicit preview launcher");
}
const sidebarSources = [
  await readText("src/features/app-shell/DesktopDataWorkspaceSurface.tsx"),
  await readText("src/features/app-shell/navigation/DesktopSidebarFooterNavigation.tsx"),
].join("\n");
if (sidebarSources.includes("DesktopBuildIdentity")) {
  errors.push("Build Identity must not be rendered in a Side Panel");
}

if (errors.length > 0) {
  console.error("Desktop Build Identity architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Desktop Build Identity architecture check passed.");

function requireSource(source, snippet, message) {
  if (!source.includes(snippet)) errors.push(message);
}

async function readText(relativePath) {
  return fs.readFile(path.join(repositoryRoot, relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}
