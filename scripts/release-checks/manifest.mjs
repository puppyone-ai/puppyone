import { readFile } from "node:fs/promises";
import Ajv from "ajv";

const schema = JSON.parse(await readFile(new URL("./checks.schema.json", import.meta.url), "utf8"));
const validateSchema = new Ajv({ allErrors: true, strict: true }).compile(schema);

export function validateManifest(manifest) {
  if (!validateSchema(manifest)) {
    throw new Error(`Invalid release-checks manifest: ${JSON.stringify(validateSchema.errors)}`);
  }
  const byId = new Map();
  for (const check of manifest.checks) {
    if (byId.has(check.id)) throw new Error(`Duplicate release check: ${check.id}`);
    if (!["npm", "node"].includes(check.command[0])) throw new Error(`Unsupported command in ${check.id}`);
    byId.set(check.id, check);
  }
  for (const check of manifest.checks) {
    for (const id of check.dependsOn) {
      const dependency = byId.get(id);
      if (!dependency) throw new Error(`${check.id} has unknown dependency: ${id}`);
      // Each CI group is independently executable on a fresh checkout.
      if (dependency.group !== check.group) throw new Error(`${check.id} has a cross-group dependency: ${id}`);
      if (!check.platforms.every((platform) => dependency.platforms.includes(platform))) {
        throw new Error(`${check.id} has an incompatible dependency platform: ${id}`);
      }
    }
  }
  createPlan(manifest);
  return manifest;
}

export async function loadManifest() {
  return validateManifest(JSON.parse(await readFile(new URL("./checks.json", import.meta.url), "utf8")));
}

export function createPlan(manifest, { checkId, group } = {}) {
  if (checkId && group) throw new Error("Choose either --check or --group.");
  const byId = new Map(manifest.checks.map((check) => [check.id, check]));
  const selected = manifest.checks.filter((check) => (!checkId || check.id === checkId) && (!group || check.group === group));
  if (!selected.length) throw new Error(`Unknown release check or group: ${checkId ?? group}`);
  const visiting = new Set();
  const visited = new Set();
  const result = [];
  function visit(check) {
    if (visiting.has(check.id)) throw new Error(`Cyclic release-check dependency: ${check.id}`);
    if (visited.has(check.id)) return;
    visiting.add(check.id);
    for (const dependency of check.dependsOn) {
      if (!byId.has(dependency)) throw new Error(`Unknown dependency: ${dependency}`);
      visit(byId.get(dependency));
    }
    visiting.delete(check.id);
    visited.add(check.id);
    result.push(check);
  }
  selected.forEach(visit);
  return result;
}
