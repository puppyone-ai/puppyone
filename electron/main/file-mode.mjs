import path from "node:path";
import { classifyLocalFile, getMimeType } from "../local-api/files/file-format-policy.mjs";

export const FILE_MODE_HASH = "file-mode";

/** Formats a File Mode window can show. CSV and HTML join once their safety rules land. */
const FILE_MODE_KINDS = new Set(["markdown"]);

/** Channels a File Mode window may use. Everything else is refused at the IPC gate. */
const FILE_MODE_CHANNELS = new Set([
  "appearance:set-window-background",
  "document-session:flush-result",
  "localization:get-bootstrap",
  "mermaid:cancel",
  "mermaid:render",
  "platform:get-capabilities",
  "theme:list",
  "window-layout:set-chrome-profile",
  "window:get-initial-workspace",
  "workspace:revoke-file-url",
]);

/** These act on one path, so they are limited to the bound file. */
const BOUND_FILE_CHANNELS = new Set([
  "workspace:read-file",
  "workspace:resolve-node",
  "workspace:write-file",
]);

export function isFileModeFile(filePath) {
  return FILE_MODE_KINDS.has(classifyLocalFile(filePath));
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
