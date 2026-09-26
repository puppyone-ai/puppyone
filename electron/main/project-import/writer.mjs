import fs from "node:fs/promises";
import path from "node:path";

/** Confines provider-generated files to a fresh staging directory. */
export function createImportWriter({ stagingPath, io = fs, signal, allowBulk = false, onProgress = () => {} }) {
  let mode = null;
  let filesWritten = 0;
  const usedPaths = new Set();

  function requireRelativePath(value) {
    if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0")
      || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
      throw invalidPath();
    }
    const segments = value.split("/");
    if (segments.some((part) => !part || part === "." || part === ".." || /[<>:"|?*\u0000-\u001f\u007f]/.test(part)
      || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))) {
      throw invalidPath();
    }
    return segments;
  }

  return Object.freeze({
    async writeFile(relativePath, content) {
      if (signal?.aborted) throw new Error("Import cancelled.");
      if (mode === "bulk") throw new Error("Cannot mix bulk and managed import writes.");
      mode = "managed";
      const segments = requireRelativePath(relativePath);
      const normalized = segments.join("/").toLowerCase();
      if (usedPaths.has(normalized)) throw new Error(`Import file already exists: ${relativePath}`);
      usedPaths.add(normalized);
      const destination = path.join(stagingPath, ...segments);
      await io.mkdir(path.dirname(destination), { recursive: true });
      const handle = await io.open(destination, "wx");
      try {
        if (typeof content === "string" || content instanceof Uint8Array) {
          await handle.writeFile(content);
        } else if (content && typeof content[Symbol.asyncIterator] === "function") {
          for await (const chunk of content) {
            if (signal?.aborted) throw new Error("Import cancelled.");
            await handle.writeFile(chunk);
          }
        } else {
          throw new TypeError("Import file content must be text, bytes, or an async byte stream.");
        }
      } finally {
        await handle.close();
      }
      filesWritten += 1;
      onProgress({ phase: "writing", filesWritten, path: relativePath });
    },
    /** Existing Git and folder sources need a directory-level operation. */
    async materializeDirectory(run) {
      if (!allowBulk) throw new Error("Remote import sources must write files through the managed writer.");
      if (mode) throw new Error("Cannot mix bulk and managed import writes.");
      mode = "bulk";
      await run(stagingPath);
    },
    get filesWritten() { return filesWritten; },
  });
}

function invalidPath() {
  const error = new Error("Import file path must stay inside the new project and use portable names.");
  error.code = "INVALID_IMPORT_PATH";
  return error;
}
