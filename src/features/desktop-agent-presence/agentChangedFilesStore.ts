import { normalizeWorkspaceRelativePath } from "./agentActivity";

type StoragePort = Pick<Storage, "getItem" | "setItem">;
const PREFIX = "puppyone.desktop.agent-changed-files.v1:";
const MAX_PATHS = 5_000;
const rootKey = (root: string) => root.replaceAll("\\", "/").replace(/\/$/, "");

/** Unread file indicators, not a transcript or a second Git status store. */
export class AgentChangedFilesStore {
  private readonly roots = new Map<string, Map<string, number>>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly reviews = new Map<string, number>();
  private revision = Date.now();
  constructor(private readonly storage?: StoragePort) {}

  subscribe(root: string, listener: () => void) {
    const key = rootKey(root);
    const listeners = this.listeners.get(key) ?? new Set();
    this.listeners.set(key, listeners);
    listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key); };
  }

  has(root: string, path: string, folder = false): boolean {
    const entries = this.read(root);
    if (folder && !path) return entries.size > 0;
    const normalized = normalizeWorkspaceRelativePath(path);
    if (!normalized) return false;
    return folder ? [...entries.keys()].some(entry => entry.startsWith(`${normalized}/`)) : entries.has(normalized);
  }

  version(root: string, path: string): number | null {
    return this.read(root).get(normalizeWorkspaceRelativePath(path) ?? "") ?? null;
  }

  requestReview(root: string, path: string) {
    const version = this.version(root, path);
    if (version == null) return;
    this.reviews.set(JSON.stringify([rootKey(root), path]), version);
    this.listeners.get(rootKey(root))?.forEach(listener => listener());
  }

  reviewVersion(root: string, path: string): number | null {
    return this.reviews.get(JSON.stringify([rootKey(root), path])) ?? null;
  }

  mark(root: string, paths: readonly string[]) {
    const entries = this.read(root);
    let changed = false;
    for (const path of paths) {
      const normalized = normalizeWorkspaceRelativePath(path);
      if (!normalized) continue;
      entries.delete(normalized);
      entries.set(normalized, ++this.revision);
      changed = true;
    }
    while (entries.size > MAX_PATHS) entries.delete(entries.keys().next().value!);
    if (changed) this.publish(root, entries);
  }

  acknowledge(root: string, path: string, expected = this.version(root, path)) {
    const entries = this.read(root);
    const normalized = normalizeWorkspaceRelativePath(path);
    if (!normalized || expected == null || entries.get(normalized) !== expected) return;
    entries.delete(normalized);
    this.reviews.delete(JSON.stringify([rootKey(root), path]));
    this.publish(root, entries);
  }

  private read(root: string): Map<string, number> {
    const key = rootKey(root);
    const cached = this.roots.get(key);
    if (cached) return cached;
    const entries = new Map<string, number>();
    try {
      const raw = this.storage?.getItem(PREFIX + key);
      const stored: unknown = raw && raw.length <= 1024 * 1024 ? JSON.parse(raw) : [];
      if (Array.isArray(stored)) for (const entry of stored.slice(-MAX_PATHS)) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Number.isSafeInteger(entry[1])) continue;
        const path = normalizeWorkspaceRelativePath(entry[0]);
        if (!path) continue;
        entries.set(path, entry[1]);
        this.revision = Math.max(this.revision, entry[1]);
      }
    } catch { /* Storage is optional; the current window still retains its marks. */ }
    this.roots.set(key, entries);
    return entries;
  }

  private publish(root: string, entries: Map<string, number>) {
    const key = rootKey(root);
    try { this.storage?.setItem(PREFIX + key, JSON.stringify([...entries])); } catch { /* Keep the in-memory state. */ }
    this.listeners.get(key)?.forEach(listener => listener());
  }
}

function browserStorage(): StoragePort | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
}
export const agentChangedFilesStore = new AgentChangedFilesStore(browserStorage());
