#!/usr/bin/env node

// The Project Reach experience ships beside the established surfaces. That is
// only affordable while the fork stays at the entry points, so the switch has
// exactly one reader and the new presentation lives in its own files.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const settingKey = "enableProjectReach";
const decisionPoint = "src/features/project-reach/useProjectReachExperience.ts";
const conventionDocument = "src/features/project-reach/README.md";

// Only these may declare or render the switch. Everything else reads the
// decision point, or nothing at all.
const settingKeyOwners = [
  "src/preferences.ts",
  "src/features/settings/main/ExperimentalSettingsView.tsx",
  decisionPoint,
];

// One line per entry point, added by the delivery that owns that surface.
const entryPoints = [];

const errors = [];

for (const relativePath of [decisionPoint, conventionDocument]) {
  if (!existsSync(path.join(repoRoot, relativePath))) {
    errors.push(`the Project Reach experience requires ${relativePath}`);
  }
}

const decisionSource = read(decisionPoint);
if (!decisionSource.includes("useProjectReachExperience")) {
  errors.push(`${decisionPoint} must export useProjectReachExperience`);
}
if (!decisionSource.includes(settingKey)) {
  errors.push(`${decisionPoint} must resolve the ${settingKey} switch`);
}

const allowedSettingKeyOwners = new Set(settingKeyOwners);
const allowedEntryPoints = new Set(entryPoints);

for (const relativePath of rendererSources()) {
  const source = read(relativePath);
  if (source.includes(settingKey) && !allowedSettingKeyOwners.has(relativePath)) {
    errors.push(
      `${relativePath} reads ${settingKey} directly; `
      + "consume useProjectReachExperience() instead",
    );
  }
  if (relativePath === decisionPoint) continue;
  if (!/\buseProjectReachExperience\b/.test(source)) continue;
  if (!allowedEntryPoints.has(relativePath)) {
    errors.push(
      `${relativePath} forks on the Project Reach experience outside an entry point; `
      + `see ${conventionDocument} and add the entry point to this gate if it is one`,
    );
  }
}

for (const relativePath of entryPoints) {
  if (!existsSync(path.join(repoRoot, relativePath))) {
    errors.push(`declared Project Reach entry point is missing: ${relativePath}`);
    continue;
  }
  const source = read(relativePath);
  if (!/\buseProjectReachExperience\b/.test(source)) {
    errors.push(
      `${relativePath} is declared as a Project Reach entry point but no longer forks; `
      + "remove it from this gate",
    );
  }
}

const convention = read(conventionDocument);
for (const requirement of ["Fork convention", "Retirement"]) {
  if (!convention.includes(requirement)) {
    errors.push(`${conventionDocument} must keep its ${requirement} section`);
  }
}

if (errors.length > 0) {
  console.error("Project Reach experience gate failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Project Reach experience gate passed: one decision point, ${entryPoints.length} entry point(s).`,
);

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function rendererSources() {
  const roots = [path.join(repoRoot, "src"), path.join(repoRoot, "packages", "shared-ui", "src")];
  const files = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    collect(root, files);
  }
  return files.map((filePath) => path.relative(repoRoot, filePath).split(path.sep).join("/")).sort();
}

function collect(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(filePath, files);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(filePath);
  }
}
