import fs from "node:fs";

/** A path the open route refuses, with the protocol code the CLI reports. */
export class OpenPathRejection extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OpenPathRejection";
    this.code = code;
  }
}

/**
 * The one route for paths that arrive from outside a window: the command
 * line, the system's open-file event and a second instance. A folder opens
 * its project window and a file its own window; either is focused instead
 * when it is already open.
 */
export function createSystemOpenRoute({
  isFileModeFile,
  maxFileBytes,
  findFileWindow,
  findProjectWindow,
  showExistingWindow,
  openFileWindow,
  openProjectWindow,
  fileSystem = fs.promises,
}) {
  return async function openPath(targetPath, { activate = true, enforceSizeLimit = false } = {}) {
    let realPath;
    let stats;
    try {
      realPath = await fileSystem.realpath(targetPath);
      stats = await fileSystem.stat(realPath);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        throw new OpenPathRejection("PATH_NOT_FOUND", `${targetPath} does not exist.`);
      }
      throw new OpenPathRejection("OPEN_FAILED", `${targetPath} cannot be read: ${error?.message ?? error}`);
    }

    if (stats.isDirectory()) {
      const existing = findProjectWindow(realPath);
      if (existing) {
        showExistingWindow(existing, { activate });
        return { path: realPath, status: "focused", kind: "folder", window: "project" };
      }
      await openProjectWindow(realPath, { activate });
      return { path: realPath, status: "opened", kind: "folder", window: "project" };
    }
    if (!stats.isFile()) {
      throw new OpenPathRejection("NOT_A_FILE_OR_FOLDER", `${targetPath} is not a file or folder.`);
    }
    if (!isFileModeFile(realPath)) {
      throw new OpenPathRejection("UNSUPPORTED_TYPE", `${targetPath} is not a Markdown, CSV or HTML file.`);
    }

    const existing = findFileWindow(realPath);
    if (existing) {
      showExistingWindow(existing, { activate });
      return { path: realPath, status: "focused", kind: "file", window: "file" };
    }
    // A window that can only say the file is too large is no use to a caller that can be told.
    if (enforceSizeLimit && stats.size > maxFileBytes) {
      throw new OpenPathRejection("FILE_TOO_LARGE", `${targetPath} is larger than ${maxFileBytes} bytes.`);
    }
    await openFileWindow(realPath, { activate });
    return { path: realPath, status: "opened", kind: "file", window: "file" };
  };
}

/**
 * The project window to focus for a folder: one showing only that folder,
 * otherwise the most recently focused window that contains it.
 */
export function findProjectWindowForFolder(entries, folderPath) {
  let best = null;
  for (const { window, state } of entries) {
    if (!window || window.isDestroyed?.() || !state || state.fileTarget) continue;
    const folders = state.folderPaths.length > 0 ? state.folderPaths : state.initialRestorePaths;
    if (!folders.includes(folderPath)) continue;
    const candidate = { window, only: folders.length === 1, focusedAt: state.lastFocusedAt ?? 0 };
    if (!best || (candidate.only && !best.only) || (candidate.only === best.only && candidate.focusedAt > best.focusedAt)) {
      best = candidate;
    }
  }
  return best?.window ?? null;
}
