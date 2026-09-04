#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DESKTOP_WINDOW_MIN_HEIGHT,
  DESKTOP_WINDOW_MIN_WIDTH,
} from "../electron/main/window-layout-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const mainSource = read("electron/main.mjs");
const shellCss = read("src/styles/shell.css");
const tokensCss = read("src/styles/tokens.css");
const desktopShellSource = read("src/components/DesktopCloudShell.tsx");
const preloadSource = read("electron/preload.cjs");
const windowLayoutIpcSource = read("electron/main/ipc/window-layout-ipc.mjs");
const windowChromeProfileSource = read("electron/main/window-chrome-profile.mjs");
const macosPlatformSource = read("electron/main/platform/macos/index.mjs");

const rendererWidthMatch = tokensCss.match(/--desktop-window-min-width:\s*(\d+)px;/);
const rendererMinWidth = rendererWidthMatch ? Number(rendererWidthMatch[1]) : null;

if (DESKTOP_WINDOW_MIN_WIDTH !== 640) {
  errors.push("The desktop native minimum width must remain 640px unless the product contract changes intentionally.");
}
if (DESKTOP_WINDOW_MIN_HEIGHT !== 520) {
  errors.push("The desktop native minimum height must remain 520px unless the product contract changes intentionally.");
}
if (rendererMinWidth !== DESKTOP_WINDOW_MIN_WIDTH) {
  errors.push("Renderer --desktop-window-min-width must match the Electron native minimum width.");
}
if (!mainSource.includes("DESKTOP_WINDOW_MIN_HEIGHT,")
    || !mainSource.includes("DESKTOP_WINDOW_MIN_WIDTH,")) {
  errors.push("electron/main.mjs must import the native window layout contract.");
}
if (!mainSource.includes("minWidth: DESKTOP_WINDOW_MIN_WIDTH,")) {
  errors.push("BrowserWindow must consume DESKTOP_WINDOW_MIN_WIDTH instead of a local literal.");
}
if (!mainSource.includes("minHeight: DESKTOP_WINDOW_MIN_HEIGHT,")) {
  errors.push("BrowserWindow must consume DESKTOP_WINDOW_MIN_HEIGHT instead of a local literal.");
}
if (!mainSource.includes("registerWindowLayoutIpcHandlers")) {
  errors.push("Electron main must register the dynamic workbench minimum-width IPC contract.");
}
if (!preloadSource.includes('ipcRenderer.invoke("window-layout:set-minimum-width", request)')) {
  errors.push("The isolated preload must expose the dynamic workbench minimum-width contract.");
}
if (!windowLayoutIpcSource.includes("Math.max(DESKTOP_WINDOW_MIN_WIDTH, requestedWidth)")) {
  errors.push("Dynamic pane minima must never lower the product-level 640px window floor.");
}
if (!desktopShellSource.includes("paneLayout.minimumWidth")) {
  errors.push("DesktopCloudShell must publish its resolved pane minimum to the native window.");
}
if (
  !mainSource.includes("desktopPlatformHost.windowChrome.browserWindowOptions")
  || !macosPlatformSource.includes("trafficLightPosition: DEFAULT_MACOS_WINDOW_BUTTON_POSITION,")
) {
  errors.push("BrowserWindow and runtime chrome switching must share the reviewed Default traffic-light position.");
}
if (!/applyWindowChromeProfile\(\s*ownerWindow,\s*request\?\.titlebar\s*\)/.test(windowLayoutIpcSource)) {
  errors.push("Window chrome IPC must resolve titlebar IDs through the trusted main-process profile registry.");
}
if (
  windowLayoutIpcSource.includes("request?.leadingRail")
  || windowChromeProfileSource.includes("LEADING_RAIL_MACOS_WINDOW_BUTTON_POSITION")
) {
  errors.push("Native traffic-light coordinates must not depend on renderer leading-rail layout.");
}
if (!windowChromeProfileSource.includes("setWindowButtonPosition?.({ ...profile.windowButtonPosition })")) {
  errors.push("Restoring native macOS buttons must reapply their reviewed position after visibility changes.");
}

const appShellRule = readCssBlock(shellCss, ".app-shell");
if (!appShellRule.includes("min-width: var(--desktop-window-min-width);")) {
  errors.push("The root renderer shell must consume --desktop-window-min-width.");
}
for (const selector of [".app-shell.minimal", ".app-shell.cloud-runtime"]) {
  const rule = readOptionalCssBlock(shellCss, selector);
  if (rule?.includes("min-width:")) {
    errors.push(`${selector} must not override the shared desktop minimum-width contract.`);
  }
}

if (errors.length > 0) {
  console.error("Window layout architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Window layout architecture check passed (${DESKTOP_WINDOW_MIN_WIDTH}x${DESKTOP_WINDOW_MIN_HEIGHT}px minimum).`,
);

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readCssBlock(css, selector) {
  const block = readOptionalCssBlock(css, selector);
  if (block === null) throw new Error(`Missing CSS block for ${selector}`);
  return block;
}

function readOptionalCssBlock(css, selector) {
  const marker = `${selector} {`;
  const start = css.indexOf(marker);
  if (start < 0) return null;
  const bodyStart = start + marker.length;
  const end = css.indexOf("\n}", bodyStart);
  if (end < 0) throw new Error(`Unclosed CSS block for ${selector}`);
  return css.slice(bodyStart, end);
}
