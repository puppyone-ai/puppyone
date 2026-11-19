import fs from "node:fs/promises";
import { parseSingleByteRange } from "./byte-range.mjs";
import { resolveExistingWorkspacePath } from "./path-policy.mjs";

/**
 * Opens one exact HTTP byte range as a backpressured stream. Media elements
 * commonly request `bytes=0-`; this path must represent that complete range so
 * Chromium can discover metadata near the end of the container without
 * buffering the file in main-process memory.
 */
export async function openWorkspaceFileRangeStream(rootPath, relativePath, rangeHeader) {
  const filePath = await resolveExistingWorkspacePath(rootPath, relativePath);
  const handle = await fs.open(filePath, "r").catch((error) => {
    throw new Error(`Unable to open file: ${error.message}`);
  });
  let streamCreated = false;
  try {
    const metadata = await handle.stat();
    if (metadata.isDirectory()) {
      throw new Error("Selected path is a folder.");
    }
    if (!metadata.isFile()) {
      throw new Error("Selected path is not a regular file.");
    }

    const range = parseSingleByteRange(rangeHeader, metadata.size);
    if (!range || range.unsatisfiable) {
      return {
        stream: null,
        size: metadata.size,
        start: 0,
        end: 0,
        partial: false,
        unsatisfiable: true,
      };
    }

    const stream = handle.createReadStream({
      start: range.start,
      end: range.end,
      autoClose: true,
    });
    streamCreated = true;
    return {
      stream,
      size: metadata.size,
      start: range.start,
      end: range.end,
      partial: true,
      unsatisfiable: false,
    };
  } finally {
    if (!streamCreated) await handle.close().catch(() => {});
  }
}
