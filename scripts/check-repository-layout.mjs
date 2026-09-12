#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const requiredPaths = [
  "packages/shared-ui/package.json",
  "packages/shared-ui/src/index.ts",
  "src/features",
  "electron/main",
  "electron/main/platform/create-platform-host.mjs",
  "local-api",
  "shared/desktop/platform-contract.mjs",
  "src/platform/desktopPlatformClient.ts",
  "tooling/desktop/targets/target-manifest.mjs",
  "tooling/desktop/build/create-builder-config.mjs",
  "tooling/desktop/release/release-set.mjs",
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
  "vendor/shared-ui",
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

const allowedVendorEntries = new Set(["claude-agent-sdk", "claudian", "opencode"]);
for (const entry of readdirSync(path.join(repoRoot, "vendor"), { withFileTypes: true })) {
  if (entry.name.startsWith(".")) continue;
  if (!allowedVendorEntries.has(entry.name)) {
    errors.push(`vendor/ is reserved for pinned third-party sources; move ${entry.name} to packages/ or another owned domain`);
  }
}

for (const filePath of walkSourceFiles(path.join(repoRoot, "src"))) {
  const source = readFileSync(filePath, "utf8");
  if (/packages\/shared-ui\/src/.test(source)) {
    errors.push(`${relative(filePath)} deep-imports first-party Shared UI; use @puppyone/shared-ui`);
  }
}

const eslintConfig = read("eslint.config.js");
if (!eslintConfig.includes('"packages/shared-ui/src/**/*.{ts,tsx}"')) {
  errors.push("ESLint must include first-party packages/shared-ui sources.");
}
if (/"packages\/\*\*"/.test(eslintConfig)) {
  errors.push("ESLint must not ignore the first-party packages/ tree.");
}

const packageMetadata = read("package.json");
if (!packageMetadata.includes('"packages/shared-ui/**"')) {
  errors.push("Packaged Desktop artifacts must include packages/shared-ui.");
}
if (!packageMetadata.includes('"build": "node scripts/check-desktop-build-environment.mjs')) {
  errors.push("Production renderer builds must fail fast on missing endpoint configuration.");
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
