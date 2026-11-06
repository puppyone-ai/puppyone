import { useSyncExternalStore } from "react";

/**
 * Folders this App shared or stopped sharing since the window's project was
 * loaded. Main records the same fact in the recent-projects store; this keeps
 * the open window truthful until that record is read again.
 */
let byPath: ReadonlyMap<string, string | null> = new Map();
const listeners = new Set<() => void>();

function publish(next: ReadonlyMap<string, string | null>) {
  byPath = next;
  for (const listener of listeners) listener();
}

export function rememberSharedFolder(rootPath: string, folderId: string) {
  publish(new Map(byPath).set(rootPath, folderId.toLowerCase()));
}

export function forgetSharedFolder(folderId: string, rootPath?: string) {
  const id = folderId.toLowerCase();
  const next = new Map([...byPath].map(([path, value]) => [path, value === id ? null : value]));
  if (rootPath) next.set(rootPath, null);
  publish(next);
}

/** The folder id this computer shares `rootPath` under, as far as this App knows. */
export function useSharedFolderId(rootPath: string | null | undefined, recorded: string | null | undefined) {
  const known = useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, () => byPath);
  if (!rootPath) return recorded ?? null;
  return known.has(rootPath) ? known.get(rootPath) ?? null : recorded ?? null;
}
