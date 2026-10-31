import type { DataPort, DataFileUrlOptions, WorkspaceContentChange } from "../../core/types";
import { workspaceContentChangeMatchesResource } from "../../core/workspaceContentChange";
import { canonicalizeDocumentResourcePath } from "../document-session/documentIdentity";
import { getEditorStorageIdentity } from "./editorStorageIdentity";
import { assertEditorRuntimeAdmission } from "../runtime/editorRuntimeAdmission";

export type FileResourceHandle = {
  readonly url: string;
  subscribe: (listener: (url: string | null) => void) => () => void;
  revoke: () => void;
};
type Entry = {
  key: string; identity: string; path: string; port: DataPort; options: DataFileUrlOptions;
  refs: number; url: string | null; generation: number; pending: Promise<void>;
  listeners: Set<(url: string | null) => void>; sequences: Map<string, number>;
};
const entries = new Map<string, Entry>();
const acquisitions = new Set<{ entry: Entry; promise: Promise<void> }>();
const releases = new Map<string, { entry: Entry; url: string; promise: Promise<void>; failed: boolean }>();

export async function settleFileResourceReleases(identity?: string, resource?: string): Promise<void> {
  const matches = (entry: Entry) => (!identity || entry.identity === identity)
    && (!resource || entry.path === resource || entry.path.startsWith(`${resource}/`));
  // An acquisition cancelled during close may still deliver a capability.
  // Wait for that result to be revoked as well as capabilities already known.
  const pending = [...acquisitions].filter(({ entry }) => matches(entry));
  await boundedSettlement(Promise.allSettled(pending.map(({ promise }) => promise)));
  const relevant = [...releases.values()].filter(({ entry }) => matches(entry));
  for (const release of relevant) if (release.failed) startRelease(release);
  await boundedSettlement(Promise.all(relevant.map(({ promise }) => promise)));
}

function boundedSettlement<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("File resources have not confirmed release. Try closing again.")), 5_000);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/** Subscribe before starting acquisition; independent consumers own independent releases. */
export async function acquireFileResource(port: DataPort, resource: string, options: DataFileUrlOptions & { inputGeneration?: number } = {}, signal?: AbortSignal): Promise<FileResourceHandle> {
  assertEditorRuntimeAdmission();
  signal?.throwIfAborted();
  if (!port.getFileUrl) throw new Error("This storage provider cannot supply file resources.");
  const identity = getEditorStorageIdentity(port);
  const path = canonicalizeDocumentResourcePath(resource);
  const key = JSON.stringify([identity, path, options.purpose ?? "file-preview", options.expectedVersion ?? null, options.inputGeneration ?? 0]);
  let entry = entries.get(key);
  if (!entry) {
    entry = { key, identity, path, port, options, refs: 0, url: null, generation: 0,
      pending: Promise.resolve(), listeners: new Set(), sequences: new Map() };
    entries.set(key, entry);
    entry.refs++;
    reload(entry);
  } else entry.refs++;
  const acquired = entry;
  let released = false;
  const subscriptions = new Set<(url: string | null) => void>();
  const release = () => {
    if (released) return;
    released = true;
    subscriptions.forEach((listener) => acquired.listeners.delete(listener));
    subscriptions.clear();
    if (--acquired.refs > 0) return;
    if (entries.get(key) === acquired) entries.delete(key);
    acquired.generation++;
    if (acquired.url) revoke(acquired, acquired.url);
    acquired.listeners.clear(); acquired.url = null;
  };
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => { release(); reject(signal?.reason ?? new DOMException("Resource acquisition cancelled.", "AbortError")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    while (true) {
      const pending = acquired.pending;
      await Promise.race([pending, aborted]);
      signal?.throwIfAborted();
      if (pending === acquired.pending) break;
    }
    if (!acquired.url) throw new Error("The file resource is unavailable.");
    return {
      get url() { return released ? "" : acquired.url ?? ""; },
      revoke: release,
      subscribe(listener) {
        if (released) return () => undefined;
        subscriptions.add(listener); acquired.listeners.add(listener);
        return () => { subscriptions.delete(listener); acquired.listeners.delete(listener); };
      },
    };
  } catch (error) { release(); throw error; }
  finally { if (onAbort) signal?.removeEventListener("abort", onAbort); }
}

export function invalidateFileResources(identity: string, change: WorkspaceContentChange, origin = "view"): void {
  for (const entry of entries.values()) {
    if (entry.identity !== identity || entry.options.expectedVersion) continue;
    const previous = entry.sequences.get(origin) ?? Number.NEGATIVE_INFINITY;
    if (change.sequence <= previous) continue;
    entry.sequences.set(origin, change.sequence);
    if (workspaceContentChangeMatchesResource(change, entry.path, previous)) reload(entry);
  }
}

export function revokeFileResources(identity: string, resource?: string): void {
  for (const entry of entries.values()) {
    if (entry.identity !== identity || (resource && entry.path !== resource && !entry.path.startsWith(`${resource}/`))) continue;
    entries.delete(entry.key); entry.generation++;
    const old = entry.url; entry.url = null;
    entry.listeners.forEach((listener) => listener(null));
    if (old) revoke(entry, old);
  }
}

function reload(entry: Entry): void {
  const generation = ++entry.generation;
  entry.pending = Promise.resolve().then(() => entry.port.getFileUrl!(entry.path, entry.options)).then((url) => {
    if (entries.get(entry.key) !== entry || entry.generation !== generation || entry.refs === 0) { revoke(entry, url); return; }
    const previous = entry.url;
    entry.url = url;
    notifyListeners(entry, url);
    if (previous && previous !== url) revoke(entry, previous);
  }).catch(async (error) => {
    if (entry.generation !== generation) return;
    if (entry.port.resolveNode) {
      try {
        if (!await entry.port.resolveNode(entry.path)) {
          const previous = entry.url; entry.url = null;
          notifyListeners(entry, null);
          if (previous) revoke(entry, previous);
        }
      } catch { /* Preserve authorized stable content on a transient read error. */ }
    }
    throw error;
  });
  const acquisition = { entry, promise: entry.pending };
  acquisitions.add(acquisition);
  void entry.pending.finally(() => acquisitions.delete(acquisition)).catch(() => undefined);
}

function revoke(entry: Entry, url: string): void {
  const key = JSON.stringify([entry.identity, url]);
  if (releases.has(key)) return;
  const release = { entry, url, promise: Promise.resolve(), failed: false };
  releases.set(key, release);
  startRelease(release);
}

function notifyListeners(entry: Entry, url: string | null): void {
  for (const listener of entry.listeners) {
    try { listener(url); } catch (error) { console.error("Unable to update an editor resource consumer:", error); }
  }
}

function startRelease(release: { entry: Entry; url: string; promise: Promise<void>; failed: boolean }): void {
  release.failed = false;
  release.promise = Promise.resolve().then(() => release.entry.port.revokeFileUrl?.(release.url)).then(() => {
    releases.delete(JSON.stringify([release.entry.identity, release.url]));
  }, (error) => { release.failed = true; throw error; });
  // Consumers can unmount synchronously; failures remain observable/retryable
  // by the lifecycle barrier instead of becoming an unhandled rejection.
  void release.promise.catch(() => undefined);
}
