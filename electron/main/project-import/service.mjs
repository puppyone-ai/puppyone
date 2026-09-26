import fs from "node:fs/promises";
import path from "node:path";
import { publishDirectory } from "../../../local-api/templates/publish-directory.mjs";
import { getLocalImportSource } from "../../../shared/project-import/sources.mjs";

/** One local project publication boundary for every import source. */
export function createLocalProjectImportService({
  io = fs,
  publish = publishDirectory,
  sources,
} = {}) {
  if (!sources?.repository || !sources?.folder) throw new Error("Local import source adapters are required.");
  return Object.freeze({
    async importProject({ parentPath, source, signal }) {
      if (source?.kind !== "git" && source?.kind !== "folder") {
        throw new Error("Unsupported local project import source.");
      }
      const adapter = source.kind === "git" ? sources.repository : sources.folder;
      const prepared = await adapter.inspect(source);
      const descriptor = getLocalImportSource(prepared.source.provider);
      if (!descriptor || descriptor.mode !== (source.kind === "git" ? "repository" : "folder")) {
        throw new Error("Unsupported local project import source.");
      }
      const targetPath = path.join(parentPath, prepared.name);
      const existing = await io.lstat(targetPath).then(() => true).catch((error) => {
        if (error?.code === "ENOENT") return false;
        throw error;
      });
      if (existing) throw projectExists(prepared.name);
      const stagingPath = await io.mkdtemp(path.join(parentPath, `.puppyone-import-${prepared.name}-`));
      let published = false;
      try {
        await adapter.materialize({ source: prepared.source, stagingPath, targetPath, signal });
        if (signal?.aborted) throw new Error("Import cancelled.");
        try {
          await publish(stagingPath, targetPath);
        } catch (error) {
          if (error?.code === "EEXIST") throw projectExists(prepared.name);
          throw error;
        }
        published = true;
        return { path: targetPath, name: prepared.name, provider: descriptor.id };
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
