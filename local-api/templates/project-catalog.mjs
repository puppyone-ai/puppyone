import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireRelativeTemplatePath, validateTemplatePlan } from "./materialize.mjs";

export const GETTING_STARTED_TEMPLATE_ID = "puppyone.project.getting-started";
const CONTENT_ROOT = new URL("./content/", import.meta.url);
const BUILTIN_PROJECT_MANIFESTS = new Map([
  [GETTING_STARTED_TEMPLATE_ID, new URL("getting-started.manifest.json", CONTENT_ROOT)],
]);

export async function resolveProjectTemplate(source, locale = "en") {
  if (source?.kind === "blank") return { files: [], initialOpenPath: null, template: null };
  const manifestUrl = BUILTIN_PROJECT_MANIFESTS.get(source?.ref?.id);
  if (source?.kind !== "template" || source.ref?.sourceId !== "builtin" || !manifestUrl) {
    throw new Error("Unsupported project template.");
  }
  const manifest = JSON.parse(await fs.readFile(manifestUrl, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.scope !== "project"
    || manifest.id !== source.ref.id || manifest.version !== source.ref.version) throw new Error("Unsupported project template version.");
  // Resolve the complete template locale once. Filenames remain stable.
  const resolvedLocale = manifest.locales.includes(locale) ? locale : manifest.defaultLocale;
  const files = [];
  for (const file of manifest.files) {
    const sourcePath = requireRelativeTemplatePath(file.sources[resolvedLocale]);
    files.push({ path: file.path, content: await fs.readFile(path.join(fileURLToPath(CONTENT_ROOT), sourcePath)) });
  }
  const plan = {
    files,
    initialOpenPath: manifest.initialOpenPath,
    template: { sourceId: "builtin", id: manifest.id, version: manifest.version, resolvedLocale },
  };
  const { digest } = validateTemplatePlan(plan);
  if (digest !== manifest.digests[resolvedLocale]) throw new Error("The built-in template content does not match its manifest.");
  return plan;
}
