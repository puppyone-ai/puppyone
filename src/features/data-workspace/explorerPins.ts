import { useCallback, useSyncExternalStore } from "react";
import {
  getDataResourceName,
  isDataResourceDescendant,
  isSameDataResource,
  rebaseDataResourcePath,
  type DataNode,
  type ResourceUri,
  type Workspace,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";

export const EXPLORER_PINS_STORAGE_PREFIX = "puppyone.desktop.explorer-pins.v1";

/** What a pinned file needs to be opened again without the tree loaded. */
export type ExplorerPinnedFile = Readonly<Pick<
  DataNode,
  "id" | "name" | "path" | "type" | "resourceUri" | "workspaceFolderId"
>>;

export type ExplorerPinsState = Readonly<{
  files: readonly ExplorerPinnedFile[];
  /** The file tree under the pins is folded away. */
  filesCollapsed: boolean;
}>;

const EMPTY_PINS: ExplorerPinsState = Object.freeze({
  files: Object.freeze([]),
  filesCollapsed: false,
});

const cache = new Map<string, ExplorerPinsState>();
const listeners = new Set<() => void>();
let storageListenerAttached = false;

/**
 * Pins belong to the project, not to whichever of its folders has focus, so a
 * multi-folder project keeps one set of pins.
 */
export function getExplorerPinsProjectKey(
  workspace: Workspace | null,
  workspaceFolders: readonly WorkspaceFolder[],
): string | null {
  if (workspaceFolders.length > 0) {
    return workspaceFolders.map((folder) => folder.workspace.path || folder.uri).join("\u001f");
  }
  return workspace?.path || null;
}

export const explorerPinsStore = {
  subscribe(listener: () => void): () => void {
    attachStorageListener();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get(projectKey: string | null): ExplorerPinsState {
    if (!projectKey) return EMPTY_PINS;
    const cached = cache.get(projectKey);
    if (cached) return cached;
    const stored = readStoredPins(projectKey);
    cache.set(projectKey, stored);
    return stored;
  },
  isPinned(projectKey: string | null, path: string): boolean {
    return explorerPinsStore.get(projectKey).files.some((file) => isSameDataResource(file.path, path));
  },
  toggle(projectKey: string | null, node: DataNode): void {
    if (!projectKey || node.type === "folder") return;
    const current = explorerPinsStore.get(projectKey);
    const pinned = current.files.some((file) => isSameDataResource(file.path, node.path));
    write(projectKey, {
      ...current,
      files: pinned
        ? current.files.filter((file) => !isSameDataResource(file.path, node.path))
        : [...current.files, toPinnedFile(node)],
    });
  },
  unpin(projectKey: string | null, path: string): void {
    if (!projectKey) return;
    const current = explorerPinsStore.get(projectKey);
    if (!current.files.some((file) => isSameDataResource(file.path, path))) return;
    write(projectKey, { ...current, files: current.files.filter((file) => !isSameDataResource(file.path, path)) });
  },
  /** A renamed or moved file, or anything under a moved folder, keeps its pin. */
  rebase(projectKey: string | null, previousPath: string, nextPath: string): void {
    if (!projectKey || previousPath === nextPath) return;
    const current = explorerPinsStore.get(projectKey);
    let changed = false;
    const files = current.files.map((file) => {
      if (!isSameDataResource(file.path, previousPath) && !isDataResourceDescendant(file.path, previousPath)) {
        return file;
      }
      const path = rebaseDataResourcePath(file.path, previousPath, nextPath);
      if (!path || path === file.path) return file;
      changed = true;
      const resourceUri = file.resourceUri
        ? rebaseDataResourcePath(file.resourceUri, previousPath, nextPath) as ResourceUri | null
        : null;
      return toPinnedFile({
        ...file,
        id: file.id === file.path ? path : file.id,
        path,
        name: getDataResourceName(path) || file.name,
        resourceUri: resourceUri ?? file.resourceUri,
      });
    });
    if (changed) write(projectKey, { ...current, files });
  },
  /** A deleted file, or anything under a deleted folder, loses its pin. */
  removeUnder(projectKey: string | null, path: string): void {
    if (!projectKey) return;
    const current = explorerPinsStore.get(projectKey);
    const files = current.files.filter((file) => (
      !isSameDataResource(file.path, path) && !isDataResourceDescendant(file.path, path)
    ));
    if (files.length !== current.files.length) write(projectKey, { ...current, files });
  },
  setFilesCollapsed(projectKey: string | null, filesCollapsed: boolean): void {
    if (!projectKey) return;
    const current = explorerPinsStore.get(projectKey);
    if (current.filesCollapsed === filesCollapsed) return;
    write(projectKey, { ...current, filesCollapsed });
  },
} as const;

export function useExplorerPins(projectKey: string | null): ExplorerPinsState {
  const getSnapshot = useCallback(() => explorerPinsStore.get(projectKey), [projectKey]);
  return useSyncExternalStore(explorerPinsStore.subscribe, getSnapshot, () => EMPTY_PINS);
}

function write(projectKey: string, next: ExplorerPinsState) {
  const state: ExplorerPinsState = Object.freeze({
    files: Object.freeze([...next.files]),
    filesCollapsed: next.files.length > 0 && next.filesCollapsed,
  });
  cache.set(projectKey, state);
  try {
    const key = storageKey(projectKey);
    if (state.files.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Pins stay usable for this session when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

function readStoredPins(projectKey: string): ExplorerPinsState {
  if (typeof window === "undefined") return EMPTY_PINS;
  try {
    const raw = window.localStorage.getItem(storageKey(projectKey));
    if (!raw) return EMPTY_PINS;
    const parsed = JSON.parse(raw) as Partial<{ files: unknown; filesCollapsed: unknown }>;
    const files = Array.isArray(parsed.files)
      ? parsed.files.filter(isPinnedFile).map(toPinnedFile)
      : [];
    if (files.length === 0) return EMPTY_PINS;
    return Object.freeze({
      files: Object.freeze(files),
      filesCollapsed: parsed.filesCollapsed === true,
    });
  } catch {
    return EMPTY_PINS;
  }
}

function attachStorageListener() {
  if (storageListenerAttached || typeof window === "undefined") return;
  storageListenerAttached = true;
  // Another window of the same project pinned or unpinned something.
  window.addEventListener("storage", (event) => {
    if (event.key !== null && !event.key.startsWith(`${EXPLORER_PINS_STORAGE_PREFIX}:`)) return;
    cache.clear();
    for (const listener of listeners) listener();
  });
}

function storageKey(projectKey: string): string {
  return `${EXPLORER_PINS_STORAGE_PREFIX}:${projectKey}`;
}

function toPinnedFile(node: ExplorerPinnedFile): ExplorerPinnedFile {
  return Object.freeze({
    id: node.id,
    name: node.name,
    path: node.path,
    type: node.type,
    ...(node.resourceUri ? { resourceUri: node.resourceUri } : {}),
    ...(node.workspaceFolderId ? { workspaceFolderId: node.workspaceFolderId } : {}),
  });
}

function isPinnedFile(value: unknown): value is ExplorerPinnedFile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && typeof candidate.path === "string"
    && typeof candidate.type === "string"
    && candidate.type !== "folder";
}
