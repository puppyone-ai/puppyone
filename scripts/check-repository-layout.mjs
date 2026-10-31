#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const requiredPaths = [
  ".gitattributes",
  "src/shared-ui/index.ts",
  "src/features",
  "electron/main",
  "electron/main/platform/create-platform-host.mjs",
  "electron/local-api",
  "shared/desktop/platform-contract.mjs",
  "src/platform/desktopPlatformClient.ts",
  "scripts/desktop/targets/target-manifest.mjs",
  "scripts/desktop/build/create-builder-config.mjs",
  "scripts/desktop/release/release-set.mjs",
  "scripts/check-desktop-build-environment.mjs",
  "tests/fixtures/editor/formats/samples/README.md",
];
const retiredPaths = [
  ".tmp-viewer-gpu-audit.mjs",
  "editor test",
  "src/screens",
  "src/components/ChangesWorkspace.tsx",
  "src/components/CloudSidebar.tsx",
  "src/components/DesktopUtilityViews.tsx",
  "local-api",
  "packages",
  "sub-themes",
  "tooling",
  "vendor",
];

for (const relativePath of requiredPaths) {
  if (!existsSync(path.join(repoRoot, relativePath))) {
    errors.push(`required repository path is missing: ${relativePath}`);
  }
}
for (const relativePath of retiredPaths) {
  if (existsSync(path.join(repoRoot, relativePath))) {
    errors.push(`retired repository path must not return: ${relativePath}`);
  }
}

const allowedLicenseEntries = new Set(["THIRD_PARTY_NOTICES.md", "claude-agent-sdk", "claudian", "pi-kernel"]);
for (const entry of readdirSync(path.join(repoRoot, "licenses"), { withFileTypes: true })) {
  if (entry.name.startsWith(".")) continue;
  if (!allowedLicenseEntries.has(entry.name)) {
    errors.push(`licenses/ is reserved for third-party license and provenance records; move ${entry.name} to an owned domain`);
  }
}

const sharedUiRoot = path.join(repoRoot, "src", "shared-ui");
const isInsideSharedUi = (target) => target === sharedUiRoot || target.startsWith(`${sharedUiRoot}${path.sep}`);
const relativeImportPattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']*)["']/g;
for (const filePath of walkSourceFiles(path.join(repoRoot, "src"))) {
  if (isInsideSharedUi(filePath)) continue;
  for (const [, specifier] of readFileSync(filePath, "utf8").matchAll(relativeImportPattern)) {
    if (isInsideSharedUi(path.resolve(path.dirname(filePath), specifier))) {
      errors.push(`${relative(filePath)} deep-imports first-party Shared UI; use @puppyone/shared-ui`);
    }
  }
}

const packageMetadata = read("package.json");
if (!packageMetadata.includes('"build": "node scripts/check-desktop-build-environment.mjs')) {
  errors.push("Production renderer builds must fail fast on missing endpoint configuration.");
}

const gitAttributes = read(".gitattributes");
if (!/^\*\s+text=auto\s+eol=lf\s*$/mu.test(gitAttributes)) {
  errors.push("Repository text files must use LF on every platform so generated-artifact checks are byte-stable.");
}

const currentRepositoryCloudContext = read(
  "src/features/cloud/project/context/useCurrentRepositoryCloudContext.ts",
);
if (/from\s+["'][^"']*lib\/localFiles["']/.test(currentRepositoryCloudContext)) {
  errors.push("Current-repository Cloud context must not probe folders through renderer filesystem IPC.");
}
if (!currentRepositoryCloudContext.includes("resolveCanonicalPuppyoneRemotes")) {
  errors.push("Current-repository Cloud context must derive identity from the active canonical Git remote.");
}
if (!currentRepositoryCloudContext.includes("getCloudRepositoryContext")) {
  errors.push("Current-repository Cloud context must authorize the exact remote target through the Cloud session.");
}
if (/recentWorkspace|puppyoneGitRemote|listCloudProjects/.test(currentRepositoryCloudContext)) {
  errors.push("Current-repository Cloud context must not depend on recent-workspace hints or an account catalog.");
}

if (errors.length > 0) {
  console.error("Repository layout check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Repository layout check passed.");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function* walkSourceFiles(directory) {
  for (const entry of readdirSync(directory)) {
    const filePath = path.join(directory, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) yield* walkSourceFiles(filePath);
    else if (/\.(?:ts|tsx)$/.test(filePath)) yield filePath;
  }
}
