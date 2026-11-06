import fs from "node:fs/promises";
import path from "node:path";
import { resolveExistingWorkspacePath } from "./path-policy.mjs";

const EXCLUDED_DIRECTORIES = new Set([".git", ".hg", ".svn", "node_modules"]);

/** At most one active scan and one coalesced follow-up per root. A refresh
 * arriving during a scan must receive a new snapshot, not its stale result. */
export function createWorkspaceReferenceTargetReader(read = listWorkspaceReferenceTargets) {
  const roots = new Map();
  return root => {
    let entry = roots.get(root);
    if (entry?.next) return entry.next;
    if (!entry) {
      entry = { current: null, next: null };
      roots.set(root, entry);
    }
    const previous = entry.current;
    const request = Promise.resolve(previous).catch(() => {}).then(() => {
      entry.current = request;
      if (entry.next === request) entry.next = null;
      return read(root);
    });
    if (previous) entry.next = request;
    else entry.current = request;
    const cleanup = () => {
      if (entry.current === request && !entry.next) roots.delete(root);
    };
    void request.then(cleanup, cleanup);
    return request;
  };
}

/** Metadata only: independent of Explorer pagination and preview reads. Never
 * publish a partial basename index, which could mistake duplicates for a match. */
export async function listWorkspaceReferenceTargets(rootPath, {
  maxEntries = 100_000, maxDirectories = 10_000, signal,
} = {}) {
  const root = await resolveExistingWorkspacePath(rootPath, null);
  const pending = [""];
  const targets = [];
  let entries = 0;
  for (let index = 0; index < pending.length; index++) {
    signal?.throwIfAborted();
    const relative = pending[index];
    // Revalidate each directory: links must not escape the authorized root.
    const directory = await resolveExistingWorkspacePath(root, relative);
    const handle = await fs.opendir(directory);
    for await (const entry of handle) {
      signal?.throwIfAborted();
      if (++entries > maxEntries) throw new Error("Workspace reference index entry limit exceeded.");
      const targetPath = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name)) {
        if (pending.length >= maxDirectories) throw new Error("Workspace reference index directory limit exceeded.");
        pending.push(targetPath);
      } else if (entry.isFile()) {
        targets.push({ path: targetPath.split(path.sep).join("/"), name: entry.name });
      }
    }
  }
  return targets.sort((a, b) => a.path.localeCompare(b.path));
}
