import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

/** Copies an exported folder without changing the original or following links. */
export function createFolderImportSource({ io = fs, requireProjectName }) {
  return Object.freeze({
    async inspect(source) {
      if (typeof source.sourcePath !== "string" || !path.isAbsolute(source.sourcePath)) {
        throw new Error("Choose a source folder before importing.");
      }
      const metadata = await io.lstat(source.sourcePath);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error("The import source must be a real folder.");
      }
      const canonicalPath = await io.realpath(source.sourcePath);
      return {
        name: requireProjectName(source.name ?? path.basename(canonicalPath)),
        source: { ...source, sourcePath: canonicalPath },
      };
    },
    async materialize({ source, stagingPath, targetPath, signal }) {
      // Staging is a sibling of target. A destination inside the source would
      // otherwise cause the copy to discover its own output recursively.
      const relative = path.relative(source.sourcePath, targetPath);
      if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
        throw new Error("Choose a destination outside the source folder.");
      }
      async function copyDirectory(sourceDirectory, targetDirectory) {
        if (signal?.aborted) throw new Error("Import cancelled.");
        for (const entry of await io.readdir(sourceDirectory)) {
          const input = path.join(sourceDirectory, entry);
          const output = path.join(targetDirectory, entry);
          const metadata = await io.lstat(input);
          if (metadata.isSymbolicLink()) throw new Error(`Cannot import a symbolic link: ${entry}`);
          if (metadata.isDirectory()) {
            await io.mkdir(output);
            await copyDirectory(input, output);
          } else if (metadata.isFile()) {
            await io.copyFile(input, output, constants.COPYFILE_EXCL);
          } else {
            throw new Error(`Cannot import a special file: ${entry}`);
          }
        }
      }
      await copyDirectory(source.sourcePath, stagingPath);
    },
  });
}
