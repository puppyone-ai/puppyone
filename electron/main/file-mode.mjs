import fs from "node:fs";
import path from "node:path";
import { getLocalFileFormatRegistry, getMimeType } from "../local-api/files/file-format-policy.mjs";
import { createFileModeExtensions, hasFileModeExtension } from "../../shared/desktop/file-mode-contract.mjs";

export const FILE_MODE_HASH = "file-mode";

/** Every extension a File Mode window opens. Info.plist and the CLI protocol publish the same list. */
export const FILE_MODE_EXTENSIONS = createFileModeExtensions(getLocalFileFormatRegistry());
const BOUND_FILE_POLL_MS = 500;

/** Channels a File Mode window may use. Everything else is refused at the IPC gate. */
const FILE_MODE_CHANNELS = new Set([
  "appearance:set-window-background",
  "document-session:flush-result",
  "editor:markdown-format-active",
  "file-mode:set-edited",
  "localization:get-bootstrap",
  "mermaid:cancel",
  "mermaid:render",
  // Menus over the document tell this window's own native views to step aside.
  "native-surfaces:set-overlay-occluded",
  "platform:get-capabilities",
  "system:open-external-url",
  "theme:list",
  "window-layout:set-chrome-profile",
  "window:get-initial-workspace",
  "workspace:revoke-file-url",
]);

/** These act on one path, so they are limited to the bound file. */
const BOUND_FILE_CHANNELS = new Set([
  "workspace:create-preview-document",
  "workspace:read-file",
  "workspace:resolve-node",
  "workspace:write-file",
]);

export function isFileModeFile(filePath) {
  return hasFileModeExtension(path.basename(filePath), FILE_MODE_EXTENSIONS);
}

/**
 * Tells the window when its file changes on disk. Polling one file's stat
 * follows saves that replace the file through a rename, which file events
 * lose, and never watches the folder around it.
 */
export function watchBoundFile(filePath, onChange, {
  watchFile = fs.watchFile,
  unwatchFile = fs.unwatchFile,
  interval = BOUND_FILE_POLL_MS,
} = {}) {
  const listener = (current, previous) => {
    if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size || current.ino !== previous.ino) onChange();
  };
  watchFile(filePath, { interval, persistent: false }, listener);
  return () => unwatchFile(filePath, listener);
}

/** The one file a File Mode window is bound to. `realPath` is already canonical. */
export function createFileTarget(realPath) {
  return {
    path: realPath,
    rootPath: path.dirname(realPath),
    name: path.basename(realPath),
  };
}

export function isIpcAllowedInFileMode(fileTarget, channel, request) {
  if (!fileTarget) return true;
  if (BOUND_FILE_CHANNELS.has(channel)) return request?.path === fileTarget.name;
  if (channel === "workspace:get-file-url") return isAllowedResource(fileTarget, request);
  return FILE_MODE_CHANNELS.has(channel);
}

function isAllowedResource(fileTarget, request) {
  if (request?.path === fileTarget.name) return true;
  if (request?.purpose !== "markdown-asset" || typeof request.path !== "string") return false;
  return /^(image|audio|video)\//.test(getMimeType(request.path) ?? "");
}

/** What to do with unsaved edits when a File Mode window closes. */
export async function askToSaveFile({ dialog, window, name, t }) {
  const { response } = await dialog.showMessageBox(window, {
    type: "warning",
    buttons: [t("native.fileClose.save"), t("native.fileClose.discard"), t("native.fileClose.cancel")],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: t("native.fileClose.message", { name }),
    detail: t("native.fileClose.detail"),
  });
  return ["save", "discard", "cancel"][response] ?? "cancel";
}
