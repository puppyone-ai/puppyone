import fs from "node:fs";
import path from "node:path";
import {
  createWorkspaceResourceReference,
  isWorkspaceResourceReference,
  parseWorkspaceResourceReference,
} from "../../shared/workspace-resource-reference.mjs";

/** Main-owned adapter from local resource identities to admitted filesystem entries. */
export function createWorkspaceResourceResolver({ getFoldersForSender, authorizeWorkspaceRoot, fsModule = fs }) {
  return async function resolveWorkspaceResource(event, resource, { legacyRoot, legacyWorkspaceId } = {}) {
    const folders = getFoldersForSender(event.sender);
    let folder;
    let relativePath;
    if (isWorkspaceResourceReference(resource)) {
      const parsed = parseWorkspaceResourceReference(resource);
      folder = folders.find((entry) => folderIdentity(entry) === parsed.folderId);
      relativePath = parsed.relativePath;
    } else {
      if (typeof resource !== "string" || !resource || resource.includes("://") || path.isAbsolute(resource)
        || /^[A-Za-z]:/.test(resource) || /[\\\u0000-\u001f\u007f]/u.test(resource)
        || resource.split("/").some((part) => part === "..")) {
        throw new Error("A root-qualified resource reference is required.");
      }
      // Legacy relative references are usable only with an explicitly captured owner.
      folder = legacyRoot ? folders.find((entry) => entry.path === legacyRoot) : undefined;
      if (folder && legacyWorkspaceId !== undefined
        && legacyWorkspaceId !== folderIdentity(folder) && legacyWorkspaceId !== folder.workspace.id) folder = undefined;
      relativePath = resource;
    }
    if (!folder) throw new Error("The referenced project is no longer attached to this window.");
    const folderId = folderIdentity(folder);
    const rootPath = await authorizeWorkspaceRoot(event, folder.path);
    const absolutePath = await fsModule.promises.realpath(path.resolve(rootPath, relativePath));
    const providerPath = path.relative(rootPath, absolutePath);
    if (providerPath === ".." || providerPath.startsWith(`..${path.sep}`) || path.isAbsolute(providerPath)) {
      throw new Error("The referenced entry is outside its owning project.");
    }
    const metadata = await fsModule.promises.stat(absolutePath);
    const entryType = metadata.isDirectory() ? "directory" : metadata.isFile() ? "file" : null;
    if (!entryType) throw new Error("Only regular files and directories can be referenced.");
    if (!getFoldersForSender(event.sender).some((entry) => folderIdentity(entry) === folderId && entry.path === folder.path)) {
      throw new Error("The referenced project was detached while resolving the entry.");
    }
    const normalizedPath = providerPath.split(path.sep).join("/") || ".";
    return {
      resourceUri: createWorkspaceResourceReference(folderId, normalizedPath),
      folderId,
      workspaceRoot: rootPath,
      workspaceName: folder.workspace.name || path.basename(rootPath),
      relativePath: normalizedPath,
      absolutePath,
      entryType,
    };
  };
}

function folderIdentity(folder) {
  return folder.workspace.workspaceInstanceId?.trim() || folder.workspace.id;
}
