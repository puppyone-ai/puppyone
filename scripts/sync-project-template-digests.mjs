import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  requireRelativeTemplatePath,
  validateTemplatePlan,
} from "../local-api/templates/materialize.mjs";

const checkOnly = process.argv.includes("--check");
const contentRoot = fileURLToPath(new URL("../local-api/templates/content/", import.meta.url));
const manifestNames = (await fs.readdir(contentRoot))
  .filter((name) => name.endsWith(".manifest.json"))
  .sort();

if (manifestNames.length === 0) throw new Error("No project template manifests were found.");

for (const manifestName of manifestNames) {
  const manifestPath = path.join(contentRoot, manifestName);
  const source = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(source);
  if (!Array.isArray(manifest.locales) || manifest.locales.length === 0) {
    throw new Error(`${manifestName} must declare at least one locale.`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${manifestName} must declare at least one file.`);
  }

  const locales = [...new Set(manifest.locales)];
  if (locales.length !== manifest.locales.length) throw new Error(`${manifestName} contains duplicate locales.`);
  const digests = {};
  for (const locale of locales) {
    const files = [];
    for (const entry of manifest.files) {
      const outputPath = requireRelativeTemplatePath(entry.path);
      const sourcePath = requireRelativeTemplatePath(entry.sources?.[locale]);
      files.push({
        path: outputPath,
        content: await fs.readFile(path.join(contentRoot, sourcePath)),
      });
    }
    digests[locale] = validateTemplatePlan({
      files,
      initialOpenPath: manifest.initialOpenPath ?? null,
    }).digest;
  }

  const nextSource = `${JSON.stringify({ ...manifest, digests }, null, 2)}\n`;
  if (checkOnly && nextSource !== source) {
    throw new Error(`${manifestName} digests are stale. Run npm run sync:project-templates.`);
  }
  if (!checkOnly && nextSource !== source) await fs.writeFile(manifestPath, nextSource);
  console.log(`${checkOnly ? "Verified" : "Synchronized"} ${manifestName} (${locales.length} locales).`);
}
