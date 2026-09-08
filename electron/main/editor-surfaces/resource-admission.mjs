import { parseLocalFileUrl } from "../local-file-protocol.mjs";
import { pathToFileURL } from "node:url";

/** Main-process authority for source budget and local capability admission. */
export function createEditorSurfaceResourceAdmission({
  inspectLocalCapability,
  statWorkspaceFile,
  resolveWorkspaceFilePath,
  canonicalizeWorkspacePath,
  isOpenWorkspaceRoot,
}) {
  return async function admitEditorSurfaceResource({
    resourceUrl,
    ownerWebContentsId,
    resourcePolicy,
  }) {
    const url = new URL(resourceUrl);
    if (url.protocol === "https:") {
      return Object.freeze({ byteLength: null, navigationUrl: url.toString() });
    }
    if (url.protocol !== "puppyone-local:") {
      throw new Error("Editor Surface resource protocol is not admitted.");
    }

    const parsed = parseLocalFileUrl(resourceUrl);
    const capability = inspectLocalCapability({
      ...parsed,
      senderId: ownerWebContentsId,
    });
    if (!capability) throw new Error("Editor Surface local resource capability is not authorized.");
    const canonicalRoot = await canonicalizeWorkspacePath(capability.rootPath);
    if (!isOpenWorkspaceRoot(canonicalRoot)) {
      throw new Error("Editor Surface workspace is no longer open.");
    }
    const metadata = await statWorkspaceFile(canonicalRoot, capability.relativePath);
    const maxBytes = resourcePolicy?.maxSourceBytes;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new Error("Editor Surface source byte budget is invalid.");
    }
    if (!Number.isSafeInteger(metadata?.size) || metadata.size < 0) {
      throw new Error("Editor Surface resource size is unavailable.");
    }
    if (metadata.size > maxBytes) {
      throw new Error(`This file exceeds the ${formatBytes(maxBytes)} safe preview limit.`);
    }
    if (typeof resolveWorkspaceFilePath !== "function") {
      throw new Error("Editor Surface native resource resolver is unavailable.");
    }
    const filePath = await resolveWorkspaceFilePath(canonicalRoot, capability.relativePath);
    return Object.freeze({
      byteLength: metadata.size,
      navigationUrl: pathToFileURL(filePath).toString(),
    });
  };
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
