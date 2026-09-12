#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

const packageMetadata = JSON.parse(read("package.json"));
if (packageMetadata.puppyoneCapabilities?.gitAutoCommit !== false) {
  errors.push("the release capability must remain explicitly off by default");
}

const mainSource = read("electron/main.mjs");
const hostSource = read("electron/main/git-auto-commit/host.mjs");
const serviceSource = read("electron/main/git-auto-commit/service.mjs");
const kernelSource = read("local-api/git/auto-commit.mjs");
const preferenceSource = read("electron/main/git-auto-commit/preference-store.mjs");
const preloadSource = read("electron/preload.cjs");
const settingsSource = read("src/features/settings/main/RepositorySettingsViews.tsx");
const coverageConfigSource = read("tests/config/vitest.git-auto-commit.config.mjs");

for (const [snippet, message] of [
  ["gitAutoCommitFeatureProfile.rendererArguments", "Main must issue the renderer capability argument"],
  ["createGitAutoCommitHost", "Main must compose Auto Commit through its optional-feature host"],
  ["if (gitAutoCommitHost.available)", "unavailable builds must not install Auto Commit lifecycle hooks"],
  ["powerMonitor.on(\"resume\", gitAutoCommitHost.reconcileAfterResume)", "the enabled scheduler must reconcile after system resume"],
  ["gitAutoCommitHost.reconcileWindow(webContentsId)", "window focus must reconcile potentially missed workspace activity"],
]) {
  if (!mainSource.includes(snippet)) errors.push(message);
}
if (/\.\/main\/git-auto-commit\/(?:service|preference-store|transaction-journal|operation-lease)\.mjs/.test(mainSource)
  || mainSource.includes("registerGitAutoCommitIpcHandlers")) {
  errors.push("Main must depend only on the Auto Commit host and feature profile, not feature internals");
}

for (const [snippet, message] of [
  ["if (!available) return createUnavailableGitAutoCommitHost()", "the host must short-circuit unavailable releases before constructing feature internals"],
  ["createGitAutoCommitService", "the host must own service construction"],
  ["registerGitAutoCommitIpcHandlers", "the host must own optional IPC registration"],
  ["registerIpcHandlers: () => false", "the unavailable host must expose no IPC handlers"],
]) {
  if (!hostSource.includes(snippet)) errors.push(message);
}

for (const [snippet, message] of [
  ["documentDurabilityCoordinator.requestFlush", "the service must drain renderer document sessions before Git"],
  ["workspaceMutationTracker.whenIdle", "the service must drain Main-owned workspace writes before Git"],
  ["gitOperationCoordinator.tryRunAll", "autonomous work must use low-priority multi-domain Git ownership"],
  ["operationLease.acquire", "autonomous work must acquire cross-process repository ownership"],
  ["transactionJournal.read(runtime.root)", "startup recovery must inspect its own journal before acquiring Git ownership"],
  ["recoverTransaction", "the service must recover durable transactions"],
  ["isExecutionAllowed", "the service must recheck consent before ref mutation"],
  ["reconcileActivitySubscription(runtime, effectiveEnabled)", "workspace activity subscription must follow the effective feature gate"],
]) {
  if (!serviceSource.includes(snippet)) errors.push(message);
}

for (const [snippet, message] of [
  ["temporaryIndexPath", "the Git kernel must construct commits in an isolated index"],
  ["Puppyone-Auto-Commit:", "automatic commits must carry a durable operation identity trailer"],
  ["reconcileRealIndex", "the Git kernel must reconcile only its exact candidate paths"],
  ["sensitive-candidate", "the Git kernel must fail closed on sensitive paths"],
  ["user-staged-changes", "the Git kernel must preserve pre-existing user staging"],
]) {
  if (!kernelSource.includes(snippet)) errors.push(message);
}
if (/\[\s*["'](?:push|pull|fetch|checkout|switch|reset)["']/.test(kernelSource)) {
  errors.push("the Auto Commit Git kernel must not perform network, branch, or reset operations");
}
if (/git\s+add\s+(?:-A|--all)|\[\s*["']add["']\s*,\s*["'](?:-A|--all)["']/.test(kernelSource)) {
  errors.push("the Auto Commit Git kernel must never stage the whole worktree");
}

for (const snippet of [
  "experimentalOptIn: false",
  "enabled: value?.enabled === true",
  "GIT_AUTO_COMMIT_MIN_INTERVAL_MS",
]) {
  if (!preferenceSource.includes(snippet)) {
    errors.push(`the authoritative preference store is missing ${snippet}`);
  }
}

if (!preloadSource.includes("...(gitAutoCommitAvailable ?")) {
  errors.push("the preload bridge must be absent when the release capability is unavailable");
}
if (!settingsSource.includes("window.confirm") || !settingsSource.includes("localOnly")) {
  errors.push("workspace activation must require explicit confirmation and disclose local-only behavior");
}
for (const forbidden of ["setInterval(", "child_process", "execGit(", "workspace:git-commit"]) {
  if (settingsSource.includes(forbidden)) {
    errors.push(`renderer Git Auto Commit settings must not own scheduling or Git execution (${forbidden})`);
  }
}

if (!packageMetadata.scripts?.["test:git-auto-commit:coverage"]
  || !packageMetadata.devDependencies?.["@vitest/coverage-v8"]) {
  errors.push("Auto Commit must keep a dedicated V8 coverage command and provider");
}
for (const snippet of [
  "electron/main/git-auto-commit/**/*.mjs",
  "local-api/git/auto-commit.mjs",
  "thresholds:",
  "branches: 80",
  "functions: 80",
]) {
  if (!coverageConfigSource.includes(snippet)) {
    errors.push(`the Auto Commit coverage gate is missing ${snippet}`);
  }
}

if (errors.length > 0) {
  console.error("Git Auto Commit architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Git Auto Commit architecture check passed.");
