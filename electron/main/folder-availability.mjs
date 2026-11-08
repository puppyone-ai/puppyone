import fs from "node:fs";
import path from "node:path";

/**
 * Whether a project's folder can be opened right now, and if not, why, in the terms a
 * person can act on: it is gone from where it was, the disk it lives on is not
 * connected, or PuppyOne may not open it. A folder is never assumed gone when its disk
 * is merely away, so nothing is offered for removal that will come back by itself.
 *
 * @returns {Promise<{ state: "available" | "missing" | "disconnected" | "denied" | "not-a-folder" }>}
 */
export async function probeFolderAvailability(folderPath, { fsModule = fs, platform = process.platform } = {}) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (typeof folderPath !== "string" || !paths.isAbsolute(folderPath)) return { state: "missing" };
  try {
    const info = await fsModule.promises.stat(folderPath);
    if (!info.isDirectory()) return { state: "not-a-folder" };
    await fsModule.promises.access(folderPath, fs.constants.R_OK);
    return { state: "available" };
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : null;
    if (code === "EACCES" || code === "EPERM") return { state: "denied" };
    const volume = volumeRoot(folderPath, platform);
    if (volume && !(await exists(volume, fsModule))) return { state: "disconnected" };
    return { state: "missing" };
  }
}

/**
 * The closest folder above `folderPath` that still exists, where looking for a moved
 * folder starts. Falls back to the home folder when nothing on the way is left.
 */
export async function nearestExistingAncestor(folderPath, { fsModule = fs, home = "" } = {}) {
  let current = typeof folderPath === "string" && path.isAbsolute(folderPath) ? path.dirname(folderPath) : "";
  while (current) {
    if (await exists(current, fsModule)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return home || null;
}

/** The mount point a removable or network disk is reached through, when the path is on one. */
function volumeRoot(folderPath, platform) {
  if (platform === "darwin") {
    const match = /^\/Volumes\/[^/]+/.exec(folderPath);
    return match ? match[0] : null;
  }
  if (platform === "win32") {
    const match = /^\\\\[^\\]+\\[^\\]+/.exec(folderPath) ?? /^[A-Za-z]:\\/.exec(folderPath);
    return match ? match[0] : null;
  }
  const match = /^\/media\/[^/]+\/[^/]+/.exec(folderPath) ?? /^\/mnt\/[^/]+/.exec(folderPath);
  return match ? match[0] : null;
}

async function exists(target, fsModule) {
  try {
    await fsModule.promises.stat(target);
    return true;
  } catch {
    return false;
  }
}
