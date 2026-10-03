import fs from "node:fs/promises";
import path from "node:path";
import { execGit, execGitStreaming } from "../git/runner.mjs";
import { parseGitPorcelainV2Status } from "../git/porcelain-v2.mjs";
import { resolveExistingWorkspacePath } from "./path-policy.mjs";

const MAX_ENTRIES = 1024;
const INTERNAL = new Set([".git", ".puppyone", ".DS_Store", "node_modules"]);
const timestamp = (value) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const iso = (value) => value > 0 ? new Date(value).toISOString() : null;

/** Read-only, bounded activity metadata. Never use opening time or scan file contents. */
export async function readWorkspaceModifiedAt(rootPath) {
  try {
    const [status, head] = await Promise.all([
      execGitStreaming(rootPath, ["status", "--porcelain=v2", "-z", "--untracked-files=all"], {
        optionalLocks: false, timeout: 2000, recordLimit: MAX_ENTRIES * 2 + 32,
      }),
      execGit(rootPath, ["log", "-1", "--format=%cI"], { optionalLocks: false, timeout: 2000 })
        .then(({ stdout }) => timestamp(stdout.trim()), () => 0),
    ]);
    const { entries } = parseGitPorcelainV2Status(status.stdout);
    // An incomplete scan is unknown, not a falsely precise last-change time.
    if (status.didHitLimit || entries.length > MAX_ENTRIES) return null;
    let latest = head;
    for (const entry of entries) {
      if (entry.path.split("/").some((segment) => INTERNAL.has(segment))) continue;
      let relative = entry.path;
      // A deletion/rename changes its nearest surviving parent directory.
      while (relative) {
        try {
          const resolved = await resolveExistingWorkspacePath(rootPath, relative);
          const metadata = await fs.stat(resolved);
          latest = Math.max(latest, metadata.mtimeMs, metadata.ctimeMs);
          break;
        } catch (error) {
          if (!/ENOENT|ENOTDIR/.test(error?.message ?? "")) return null;
          const parent = path.posix.dirname(relative);
          if (parent === relative) break;
          relative = parent;
        }
      }
    }
    return iso(latest);
  } catch (error) {
    if (!/not a git repository/i.test(`${error?.stderr ?? ""} ${error?.message ?? ""}`)) return null;
    return readFolderActivity(rootPath).catch(() => null);
  }
}

async function readFolderActivity(rootPath) {
  let visited = 0;
  let latest = 0;
  const pending = [""];
  while (pending.length) {
    const relative = pending.pop();
    const directory = await resolveExistingWorkspacePath(rootPath, relative);
    const entries = await fs.opendir(directory);
    for await (const entry of entries) {
      if (++visited > MAX_ENTRIES) return null;
      if (INTERNAL.has(entry.name) || entry.isSymbolicLink()) continue;
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) {
        const resolved = await resolveExistingWorkspacePath(rootPath, child);
        const metadata = await fs.stat(resolved);
        latest = Math.max(latest, metadata.mtimeMs);
      }
    }
  }
  return iso(latest);
}
