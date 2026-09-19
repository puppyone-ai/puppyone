import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

let publisher;

/** Same-volume, no-replace publication. Never fall back to POSIX rename(). */
export async function publishDirectory(stagingPath, targetPath) {
  if (path.dirname(stagingPath) !== path.dirname(targetPath)) {
    throw new Error("Template publication requires sibling directories.");
  }
  const metadata = await fs.lstat(stagingPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("Invalid template staging directory.");
  if (process.platform === "win32") {
    // libuv uses MoveFileExW: unlike POSIX rename, it cannot replace a directory.
    await fs.rename(stagingPath, targetPath);
    return;
  }
  try {
    publisher ??= createRequire(import.meta.url)("./native/publish-directory.node");
  } catch (cause) {
    throw new Error("The safe template publisher is unavailable. Rebuild the Desktop native modules.", { cause });
  }
  publisher.publish(stagingPath, targetPath);
}
