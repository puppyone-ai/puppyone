import { getFileSemanticKind } from "@puppyone/shared-ui";
import type { CloudWorkspaceHandoff } from "./cloudWorkspaceHandoff";
import {
  decodeWorkspaceBytes, encodeWorkspaceBytes, formatWorkspaceVersion, parseWorkspaceVersion,
  workspaceFailure as failure, workspaceParentPath, type WorkspaceEntry, type WorkspaceFileReply,
} from "./cloudWorkspaceProtocol";
import type { CloudWorkspaceSession } from "./cloudWorkspaceSession";
import type { CloudEntry } from "./contracts";

export type CloudWorkspaceFiles = ReturnType<typeof createCloudWorkspaceFiles>;

/**
 * Live file I/O for one pinned workbench. Caches are keyed by workspace-relative
 * path and invalidated by path: a write or change event touches only the
 * entries it names, never every directory and read.
 */
export function createCloudWorkspaceFiles(workspace: CloudWorkspaceSession, assertCurrent: () => void) {
  const directories = new Map<string, { entries: CloudEntry[] }>();
  const reads = new Map<string, Promise<WorkspaceFileReply>>();
  const listings = new Map<string, Promise<{ entries: CloudEntry[] }>>();
  let cacheEpoch = 0;
  let subscriptions = 0;

  async function query(path: string) {
    const row = await workspace.ensure();
    return new URLSearchParams({ generation: row.generation, path });
  }
  const version = (revision: string) => formatWorkspaceVersion(workspace.current()!, revision);
  const map = (entry: WorkspaceEntry, parent: string): CloudEntry => {
    if (!entry || !entry.name || /[/\\\0]/.test(entry.name) || [".", "..", ".git"].includes(entry.name)) throw failure("Invalid workspace directory entry.");
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    return { path, name: entry.name, type: entry.kind === "directory" ? "folder" : getFileSemanticKind(path), size_bytes: entry.size };
  };

  /** Drop every cached byte and listing: the scope of a change is unknown. */
  function invalidate() {
    cacheEpoch++;
    workspace.forgetOpening();
    directories.clear(); reads.clear(); listings.clear();
  }
  /**
   * Drop what a change to these paths can affect: the paths themselves, any
   * cached descendants when a path is a directory, and their parent listings.
   */
  function invalidatePaths(paths: readonly string[]) {
    if (paths.length === 0) return;
    // In-flight listings started before the change must not repopulate caches.
    cacheEpoch++;
    const affected = (key: string) => paths.some((path) => key === path || key.startsWith(`${path}/`));
    const parents = new Set(paths.map(workspaceParentPath));
    for (const cache of [directories, listings]) {
      for (const key of [...cache.keys()]) if (affected(key) || parents.has(key)) cache.delete(key);
    }
    for (const key of [...reads.keys()]) if (affected(key)) reads.delete(key);
  }

  async function list(path: string) {
    assertCurrent();
    if (!path) {
      const root = workspace.takePreparedRoot();
      if (root) { directories.set(path, root); return root; }
    }
    const cached = directories.get(path);
    // While change events arrive, a cached listing stays valid until a change names it.
    if (subscriptions > 0 && cached) return cached;
    let pending = listings.get(path);
    if (!pending) {
      const epoch = cacheEpoch;
      pending = (async () => {
        if (!path) {
          await workspace.ensure();
          assertCurrent();
          const root = workspace.takeOpeningRoot();
          if (root) {
            const value = { entries: root.map(entry => map(entry, "")) };
            if (epoch === cacheEpoch) directories.set(path, value);
            return value;
          }
        }
        const parameters = await query(path);
        if (!path) workspace.openingProgress.set("files");
        const result = await workspace.request<{entries: WorkspaceEntry[]}>(`/files?${parameters}`);
        const value = { entries: result.entries.map(entry => map(entry, path)) };
        if (epoch === cacheEpoch) {
          directories.set(path, value);
          if (directories.size > 128) directories.delete(directories.keys().next().value!);
        }
        return value;
      })();
      listings.set(path, pending);
      void pending.finally(() => { if (listings.get(path) === pending) listings.delete(path); }).catch(() => {});
    }
    const value = await pending; assertCurrent(); return value;
  }
  async function stat(path: string, rootName: string): Promise<CloudEntry> {
    if (!path) { await workspace.ensure(); return { path, name: rootName, type: "folder", exists: true }; }
    const value = (await list(workspaceParentPath(path))).entries.find(entry => entry.path === path);
    if (!value) throw failure("Cloud file not found.", 404);
    return value;
  }
  async function read(path: string) {
    let pending = reads.get(path);
    if (!pending) {
      pending = (async () => workspace.request<WorkspaceFileReply>(`/file?${await query(path)}`))();
      reads.set(path, pending);
      void pending.finally(() => { if (reads.get(path) === pending) reads.delete(path); }).catch(() => {});
    }
    const result = await pending; assertCurrent();
    const bytes = decodeWorkspaceBytes(result.content_base64);
    if (result.name !== path.split("/").at(-1) || result.size !== bytes.length) throw failure("Cloud returned a different file.");
    return { bytes, version: version(result.revision), entry: { ...map(result, workspaceParentPath(path)), path } };
  }
  async function write(path: string, content: string, baseline: string | null) {
    const row = await workspace.ensure();
    const base = baseline === null ? null : parseWorkspaceVersion(baseline);
    if (base && (base.workspace !== row.id || base.generation !== row.generation)) throw failure("The file belongs to a different workspace generation. Reload before saving.");
    const result = await workspace.request<{revision: string}>(`/file?${await query(path)}`, { method: "PUT",
      body: JSON.stringify({ path, content_base64: encodeWorkspaceBytes(new TextEncoder().encode(content)), expected_revision: base?.revision ?? null }) });
    // Saving an existing file changes only its bytes; creating one changes its parent listing.
    if (base) reads.delete(path); else invalidatePaths([path]);
    return { path, version: version(result.revision) };
  }
  async function change(action: "mkdir" | "move" | "remove", path: string, destination?: string) {
    await workspace.request(`/files?${await query(path)}`, { method: "POST", body: JSON.stringify({ action, path, ...(destination ? { destination } : {}) }) });
    invalidatePaths(destination ? [path, destination] : [path]);
  }

  return {
    query, list, stat, read, write, change, invalidate, invalidatePaths,
    readText: async (path: string) => { const result = await read(path); return { ...result, content: new TextDecoder("utf-8", { fatal: true }).decode(result.bytes) }; },
    peekDirectory: (path: string) => directories.get(path),
    /** A live change subscription keeps listings authoritative until a change names them. */
    retain: () => {
      let released = false;
      subscriptions++;
      return () => { if (!released) { released = true; subscriptions--; invalidate(); } };
    },
    handoff: (): CloudWorkspaceHandoff | undefined => {
      assertCurrent();
      const root = directories.get("");
      const row = workspace.current();
      if (!row || !root) return undefined;
      const epoch = cacheEpoch;
      return { identity: workspace.identity, workspace: row, root, expiresAt: Date.now() + 5_000,
        isValid: () => epoch === cacheEpoch };
    },
  };
}
