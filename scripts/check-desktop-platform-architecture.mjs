#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDesktopBuildIdentity } from "../shared/desktop-build-identity.mjs";
import { createDesktopElectronBuilderConfig } from "../tooling/desktop/build/create-builder-config.mjs";
import {
  assertDesktopTargetManifest,
  listDesktopTargets,
} from "../tooling/desktop/targets/target-manifest.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const packageMetadata = await readJson("package.json");
const buildInfo = resolveDesktopBuildIdentity({
  baseVersion: packageMetadata.version,
  buildNumber: 1,
  builtAt: "2026-01-01T00:00:00.000Z",
  channel: "stable",
  commitSha: "a".repeat(40),
});

try {
  assertDesktopTargetManifest();
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}

const baseBuild = packageMetadata.build ?? {};
for (const key of ["beforePack", "afterPack", "publish", "mac", "dmg", "win", "nsis", "linux", "appImage"]) {
  if (Object.hasOwn(baseBuild, key)) {
    errors.push(`package.json build config must remain platform-neutral; move ${key} to a target adapter`);
  }
}

for (const target of listDesktopTargets()) {
  const config = createDesktopElectronBuilderConfig({ packageMetadata, buildInfo, target });
  if (config.extraMetadata?.version !== buildInfo.version) {
    errors.push(`${target.id} builder config must consume the canonical release version`);
  }
  if (!config.extraResources?.some((entry) => entry?.to === "build-info.json")) {
    errors.push(`${target.id} builder config must embed build-info.json`);
  }
  if (target.platform === "macos" && (!config.mac || config.win || config.linux)) {
    errors.push("macOS target config must contain only macOS platform packaging");
  }
  if (target.platform === "windows" && (!config.win || config.mac || config.linux || config.beforePack || config.afterPack)) {
    errors.push("Windows target config must contain only Windows platform packaging");
  }
  if (target.platform === "linux" && (!config.linux || config.mac || config.win || config.beforePack || config.afterPack)) {
    errors.push("Linux target config must contain only Linux platform packaging");
  }
}

const mainSource = await readText("electron/main.mjs");
requireSource(mainSource, "createDesktopPlatformHost", "Electron main must use the platform composition root");
requireSource(mainSource, "registerPlatformIpcHandlers", "Electron main must expose platform capabilities through trusted IPC");
if (mainSource.includes("process.platform")) {
  errors.push("Electron main entry must not branch directly on process.platform");
}

const preloadSource = await readText("electron/preload.cjs");
requireSource(
  preloadSource,
  'ipcRenderer.invoke("platform:get-capabilities")',
  "Preload must expose the read-only platform capability contract",
);
const rendererTypes = await readText("src/types/electron.d.ts");
requireSource(
  rendererTypes,
  'export type DesktopPlatform = "macos" | "windows" | "linux"',
  "Renderer types must use product platform identifiers",
);

const workspaceFacade = await readText("local-api/workspace.mjs");
if (workspaceFacade.includes("textutil") || workspaceFacade.includes("convertWorkspaceOfficeDocumentToDocx")) {
  errors.push("The process-neutral workspace engine must not own macOS Office conversion.");
}
const macosOfficeConverter = await readText(
  "electron/main/platform/macos/office-document-converter.mjs",
);
requireSource(
  macosOfficeConverter,
  'execFileAsync("textutil"',
  "The macOS adapter must own the native textutil conversion port",
);

for (const filePath of await walkSourceFiles(path.join(repositoryRoot, "src"))) {
  const source = await fs.readFile(filePath, "utf8");
  if (source.includes("navigator.platform")) {
    errors.push(`${relative(filePath)} must consume platform capabilities instead of navigator.platform`);
  }
}

if (errors.length > 0) {
  console.error("Desktop platform architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Desktop platform architecture check passed for macOS, Windows, and Linux targets.");

function requireSource(source, snippet, message) {
  if (!source.includes(snippet)) errors.push(message);
}

async function readText(relativePath) {
  return fs.readFile(path.join(repositoryRoot, relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function walkSourceFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkSourceFiles(filePath));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(filePath);
  }
  return files;
}

function relative(filePath) {
  return path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/");
}
