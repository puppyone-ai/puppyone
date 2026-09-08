import crypto from "node:crypto";
import path from "node:path";

/**
 * Main-process state for one native window's ordered Workspace Folder
 * composition. Workbench identity belongs to the composition, never to its
 * first Folder; Folder order is presentation state only.
 */
export class WindowWorkspaceState {
  #initialWorkspacePaths;
  #workspaceId;
  #workspaceFolders = Object.freeze([]);
  #compositions = new Map();

  constructor({
    initialWorkspaceId = null,
    initialWorkspacePath = null,
    initialWorkspacePaths = null,
    focusedAt = Date.now(),
  } = {}) {
    const requestedPaths = Array.isArray(initialWorkspacePaths)
      ? initialWorkspacePaths
      : [initialWorkspacePath];
    this.#initialWorkspacePaths = Object.freeze(
      requestedPaths
        .filter((folderPath) => typeof folderPath === "string" && folderPath.trim())
        .map((folderPath) => folderPath.trim()),
    );
    this.#workspaceId = normalizeWorkspaceId(initialWorkspaceId) ?? createWorkbenchWorkspaceId();
    this.lastFocusedAt = focusedAt;
  }

  get workspaceId() {
    return this.#workspaceId;
  }

  get initialRestorePath() {
    return this.#workspaceFolders[0]?.path ?? this.#initialWorkspacePaths[0] ?? null;
  }

  get initialRestorePaths() {
    return this.#workspaceFolders.length > 0
      ? this.folderPaths
      : this.#initialWorkspacePaths;
  }

  get folders() {
    return this.#workspaceFolders;
  }

  get folderPaths() {
    return Object.freeze(this.#workspaceFolders.map((folder) => folder.path));
  }

  get primaryWorkspace() {
    return this.#workspaceFolders[0]?.workspace ?? null;
  }

  markFocused(focusedAt = Date.now()) {
    this.lastFocusedAt = focusedAt;
  }

  beginNewWorkspace(workspaceId = null) {
    this.#workspaceId = normalizeWorkspaceId(workspaceId) ?? createWorkbenchWorkspaceId();
    return this.#workspaceId;
  }

  activateFolders(folders) {
    this.#workspaceId = this.activationIdentity(folders);
  }

  activationIdentity(folders) {
    const key = compositionKey(normalizeFolders(folders));
    return this.#compositions.get(key)?.id ?? createWorkbenchWorkspaceId();
  }

  compositionForPath(folderPath) {
    return [...this.#compositions.values()].reverse().find((entry) => entry.folders.some((folder) => folder.path === folderPath))?.folders ?? null;
  }

  forgetFolder(folderPath) {
    for (const [key, entry] of this.#compositions) {
      if (entry.folders.some((folder) => folder.path === folderPath)) this.#compositions.delete(key);
    }
  }

  replaceFolders(folders) {
    const nextFolders = normalizeFolders(folders);
    const previousPaths = new Set(this.#workspaceFolders.map((folder) => folder.path));
    const nextPaths = new Set(nextFolders.map((folder) => folder.path));
    const change = Object.freeze({
      addedPaths: Object.freeze([...nextPaths].filter((folderPath) => !previousPaths.has(folderPath))),
      removedPaths: Object.freeze([...previousPaths].filter((folderPath) => !nextPaths.has(folderPath))),
      retainedPaths: Object.freeze([...nextPaths].filter((folderPath) => previousPaths.has(folderPath))),
    });
    this.#workspaceFolders = nextFolders;
    this.#initialWorkspacePaths = Object.freeze(nextFolders.map((folder) => folder.path));
    if (nextFolders.length) {
      const key = compositionKey(nextFolders);
      this.#compositions.delete(key);
      this.#compositions.set(key, { id: this.#workspaceId, folders: nextFolders });
    }
    return change;
  }

  releaseFolders() {
    const released = this.#workspaceFolders;
    this.#workspaceFolders = Object.freeze([]);
    this.#initialWorkspacePaths = Object.freeze([]);
    return released;
  }
}

export function createWorkbenchWorkspaceId() {
  return `workbench:${crypto.randomUUID()}`;
}

function compositionKey(folders) { return JSON.stringify(folders.map((folder) => folder.path).sort()); }

function normalizeWorkspaceId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeFolders(value) {
  if (!Array.isArray(value)) throw new TypeError("Window Workspace Folders must be an array.");
  const paths = new Set();
  const identities = new Set();
  return Object.freeze(value.map((folder) => {
    const folderPath = typeof folder?.path === "string" ? folder.path.trim() : "";
    if (!folderPath) throw new TypeError("Window Workspace Folder path is required.");
    if (paths.has(folderPath)) throw new Error(`Duplicate Workspace Folder path: ${folderPath}.`);
    for (const existingPath of paths) {
      if (workspacePathsOverlap(existingPath, folderPath)) {
        throw new Error(
          `Overlapping Workspace Folder paths are not supported: ${existingPath} and ${folderPath}.`,
        );
      }
    }
    paths.add(folderPath);

    const workspace = folder?.workspace;
    const identity = typeof workspace?.workspaceInstanceId === "string" && workspace.workspaceInstanceId.trim()
      ? workspace.workspaceInstanceId.trim()
      : typeof workspace?.id === "string" ? workspace.id.trim() : "";
    if (!identity) throw new TypeError("Window Workspace Folder identity is required.");
    if (identities.has(identity)) throw new Error(`Duplicate Workspace Folder identity: ${identity}.`);
    identities.add(identity);
    return Object.freeze({ path: folderPath, workspace: Object.freeze({ ...workspace }) });
  }));
}

function workspacePathsOverlap(first, second) {
  const relative = path.relative(first, second);
  if (!relative) return true;
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return true;
  const reverse = path.relative(second, first);
  return !reverse.startsWith("..") && !path.isAbsolute(reverse);
}
