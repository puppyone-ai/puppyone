#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const fixture = JSON.parse(read("tests/fixtures/cloud/contracts/repository-target-v2.json"));
if (fixture.contract !== "puppyone.repository-target" || fixture.version !== 2) {
  errors.push("the repository-target fixture must declare contract v2");
}
if (
  fixture.request_header?.name !== "X-PuppyOne-Repository-Contract"
  || fixture.request_header?.value !== "2"
) {
  errors.push("the repository-target fixture must pin the v2 request header");
}
if (fixture.targets?.project_root?.kind !== "project_root") {
  errors.push("the fixture must include a Project-root target without a Scope id");
}
if (
  Object.hasOwn(fixture.targets?.project_root ?? {}, "scope_id")
  || fixture.targets?.scope?.kind !== "scope"
  || !fixture.targets?.scope?.scope_id
) {
  errors.push("the fixture must distinguish Project root from an exact Scope target");
}
if (
  fixture.association_rows?.project_root?.scope_id !== null
  || fixture.association_rows?.scope?.scope_id !== fixture.targets?.scope?.scope_id
) {
  errors.push("storage associations must use NULL for Project root and an exact id for Scope");
}
const expectedErrors = {
  client_upgrade_required: 1007,
  target_kind_mismatch: 1008,
  scope_not_found: 1009,
  repository_storage_unavailable: 1010,
};
if (JSON.stringify(fixture.errors) !== JSON.stringify(expectedErrors)) {
  errors.push("the fixture must pin the stable repository-target error codes");
}

const targetModel = read("src/features/cloud/repositoryTarget.ts");
for (const required of [
  'kind: "project_root"',
  'kind: "scope"',
  "projectRootTarget",
  "repositoryTargetMatchesRemote",
]) {
  if (!targetModel.includes(required)) {
    errors.push(`repositoryTarget.ts must own ${required}`);
  }
}

const cloudApi = read("src/lib/cloudApi.ts");
const repositoryContract = read("shared/repositoryContract.js");
if (
  !repositoryContract.includes('REPOSITORY_TARGET_CONTRACT_HEADER = "X-PuppyOne-Repository-Contract"')
  || !repositoryContract.includes('REPOSITORY_TARGET_CONTRACT_VERSION = "2"')
  || !cloudApi.includes('from "../../shared/repositoryContract.js"')
  || !cloudApi.includes("[REPOSITORY_TARGET_CONTRACT_HEADER]: REPOSITORY_TARGET_CONTRACT_VERSION")
) {
  errors.push("Desktop Cloud requests must advertise repository-target contract v2");
}
if (!cloudApi.includes("getCloudRepositoryContext") || cloudApi.includes("remote_url")) {
  errors.push("Cloud context must send an ordinary Project target, never a local remote URL");
}

const forbidden = /\b(?:binding_kind|bindingKind|root_scope_id|rootScope|rootScopeId|is_root|candidateScopeId)\b/;
for (const filePath of [
  ...walk(path.join(repoRoot, "src", "features", "cloud")),
  path.join(repoRoot, "src", "lib", "cloudApi.ts"),
  ...walk(path.join(repoRoot, "tests")),
]) {
  const source = readFileSync(filePath, "utf8");
  if (forbidden.test(source)) {
    errors.push(`${relative(filePath)} reintroduced a synthetic root-Scope identity field`);
  }
}

const configTypes = read("src/types/electron.d.ts");
const workspaceConfig = configTypes.match(/export type PuppyoneWorkspaceConfig\s*=\s*\{[\s\S]*?\n\};/)?.[0] ?? "";
if (/\b(?:cloud|project)\s*:|scope|credential|accessKey|access_key|binding/i.test(workspaceConfig)) {
  errors.push("local workspace config must store no Cloud/Project identity, target, credential, or Binding");
}
if (/\bproject\s*:/.test(read("electron/local-api/workspace-config.mjs"))) {
  errors.push("workspace config normalization must physically discard the obsolete local Project identity");
}

if (errors.length > 0) {
  console.error("Repository target architecture check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Repository target architecture check passed.");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function relative(filePath) {
  return path.relative(repoRoot, filePath);
}

function walk(root) {
  const result = [];
  for (const entry of readdirSync(root)) {
    const filePath = path.join(root, entry);
    const stats = statSync(filePath);
    if (stats.isDirectory()) result.push(...walk(filePath));
    else if (/\.(?:ts|tsx)$/.test(filePath)) result.push(filePath);
  }
  return result;
}
