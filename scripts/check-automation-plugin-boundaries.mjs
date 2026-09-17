#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const automationFiles = walkSourceFiles(path.join(repoRoot, "src/features/automation"));
const pluginRendererFiles = walkSourceFiles(path.join(repoRoot, "src/features/plugins"));
const viewerPackHostFiles = walkSourceFiles(path.join(repoRoot, "electron/main/viewer-packs"));

assertNoMatches(
  automationFiles,
  [
    /(?:^|[/'"])(?:features\/)?plugins(?:[/'"]|$)/,
    /viewer-packs|viewerPacks|puppyone-plugin|\.puppyplugin/,
    /window\.puppyoneDesktop/,
    /\buserData\b/,
  ],
  "Cloud Automation must not depend on local Plugin or Viewer Pack authority",
);

assertNoMatches(
  pluginRendererFiles,
  [
    /(?:^|[/'"])(?:features\/)?automation(?:[/'"]|$)/,
    /(?:^|[/'"])(?:features\/)?cloud(?:[/'"]|$)/,
    /cloudApi|\/integrations|\/workflows/,
  ],
  "local Plugins must not depend on Cloud Automation or Cloud transport",
);

assertNoMatches(
  viewerPackHostFiles,
  [
    /features\/automation|cloudApi|\/integrations|\/workflows/,
  ],
  "the main-process Viewer Pack host must not depend on Cloud Automation",
);

const viewerPackStore = read("electron/main/viewer-packs/store.mjs");
if (!/path\.join\(path\.resolve\(userDataPath\),\s*"viewer-packs"\)/.test(viewerPackStore)) {
  errors.push("Viewer Packs must remain in the main-owned <userData>/viewer-packs store.");
}
if (/automation/i.test(viewerPackStore)) {
  errors.push("Viewer Pack storage must not contain an Automation namespace or record.");
}

const workspaceSurfaceTypes = read("src/features/app-shell/workspace-surfaces/workspaceSurfaceTypes.ts");
if (!/"cloud"/.test(workspaceSurfaceTypes)) {
  errors.push("Desktop navigation must expose one Cloud Hub view id.");
}
if (/"plugins"/.test(workspaceSurfaceTypes)) {
  errors.push("Local Plugins must remain an application dialog, not a Workspace Surface view id.");
}
const desktopWorkspaceContent = read("src/features/app-shell/DesktopWorkspaceContent.tsx");
const desktopNavigationItems = read("src/features/app-shell/navigation/DesktopNavigationItems.tsx");
if (!desktopWorkspaceContent.includes("<PluginsDialog") || !desktopNavigationItems.includes("DesktopSidebarPluginsButton")) {
  errors.push("Desktop navigation must expose local Plugins through the application-dialog entry.");
}
if (/"automation"/.test(workspaceSurfaceTypes)) {
  errors.push("Automation must remain inside the Cloud Project router, not the app-shell surface registry.");
}

const workspaceSurfaceContent = read("src/features/app-shell/workspace-surfaces/useWorkspaceSurfaceContent.tsx");
if (/(?:import|from)[^(\n]*["'][^"']*automation/.test(workspaceSurfaceContent)) {
  errors.push("The local app shell must not import the Cloud Automation feature.");
}
const cloudAutomationRoute = read("src/features/cloud/sections/AutomationRouteSection.tsx");
if (!/lazy\(\(\) => import\("\.\.\/\.\.\/automation\/CloudProjectAutomationView"\)/.test(cloudAutomationRoute)) {
  errors.push("The Cloud Project router must preserve a lazy Automation route boundary.");
}

const cloudAutomationApi = read("src/lib/cloud/automationApi.ts");
if (!/CLOUD_AUTOMATION_LEGACY_WIRE_BASE\s*=\s*"\/integrations"/.test(cloudAutomationApi)) {
  errors.push("The legacy /integrations server route must stay isolated behind the Automation transport adapter.");
}

for (const filePath of walkSourceFiles(path.join(repoRoot, "src"))) {
  if (filePath.endsWith(path.join("src", "lib", "cloudApi.ts"))) continue;
  if (filePath.endsWith(path.join("src", "lib", "cloud", "automationApi.ts"))) continue;
  if (filePath.endsWith(path.join("src", "features", "cloud", "routes", "cloudRoutes.ts"))) continue;
  const source = readFileSync(filePath, "utf8");
  if (/\bIntegrations\b|["']integrations["']|\/integrations(?:\/|["'`])/.test(source)) {
    errors.push(`${relative(filePath)} leaks the retired Integrations product name outside a compatibility boundary.`);
  }
}

if (errors.length > 0) {
  console.error("Automation/Plugin domain boundary check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Automation/Plugin domain boundary check passed.");

function assertNoMatches(files, patterns, message) {
  for (const filePath of files) {
    const source = readFileSync(filePath, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(source)) {
        errors.push(`${relative(filePath)}: ${message} (${pattern}).`);
      }
      pattern.lastIndex = 0;
    }
  }
}

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function relative(filePath) {
  return path.relative(repoRoot, filePath);
}

function walkSourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const entryPath = path.join(root, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) files.push(...walkSourceFiles(entryPath));
    else if (/\.(?:css|mjs|ts|tsx)$/.test(entryPath)) files.push(entryPath);
  }
  return files;
}
