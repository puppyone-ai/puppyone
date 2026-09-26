import fs from "node:fs/promises";
import path from "node:path";
import { publishDirectory } from "../../../local-api/templates/publish-directory.mjs";
import { getLocalImportSource } from "../../../shared/project-import/sources.mjs";

/** One local project publication boundary for every import source. */
export function createLocalProjectImportService({
  io = fs,
  publish = publishDirectory,
  adapters,
  resolveSource = getLocalImportSource,
  validateName,
} = {}) {
  if (!adapters || typeof adapters !== "object") throw new Error("Local import source adapters are required.");
  if (typeof validateName !== "function") throw new Error("Local import project name validation is required.");
  return Object.freeze({
    async importProject({ parentPath, source, signal }) {
      const descriptor = resolveSource(source?.provider);
      const adapter = descriptor && adapters[descriptor.id];
      if (!descriptor?.operational || !adapter || descriptor.mode !== adapter.mode) throw unavailableSource();
      const prepared = await adapter.inspect(source);
      const name = validateName(prepared.name);
      const targetPath = path.join(parentPath, name);
      const existing = await io.lstat(targetPath).then(() => true).catch((error) => {
        if (error?.code === "ENOENT") return false;
        throw error;
      });
      if (existing) throw projectExists(name);
      const stagingPath = await io.mkdtemp(path.join(parentPath, `.puppyone-import-${name}-`));
      let published = false;
      try {
        await adapter.materialize({ source: prepared.source, stagingPath, targetPath, signal });
        if (signal?.aborted) throw new Error("Import cancelled.");
        try {
          await publish(stagingPath, targetPath);
        } catch (error) {
          if (error?.code === "EEXIST") throw projectExists(name);
          throw error;
        }
        published = true;
        return { path: targetPath, name, provider: descriptor.id };
      } finally {
        if (!published) await io.rm(stagingPath, { recursive: true, force: true });
      }
    },
  });
}

function projectExists(name) {
  const error = new Error(`A file or folder named “${name}” already exists in that location.`);
  error.code = "PROJECT_ALREADY_EXISTS";
  return error;
}

function unavailableSource() {
  const error = new Error("This import source is not available yet.");
  error.code = "IMPORT_SOURCE_UNAVAILABLE";
  return error;
}
