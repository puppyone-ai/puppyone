import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const GIT_METADATA_SNAPSHOT_MAX_ENTRIES = 10_000;
const FILES = ["HEAD", "index", "config", "packed-refs", "FETCH_HEAD", "ORIG_HEAD", "MERGE_HEAD",
  "MERGE_MSG", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD", "BISECT_LOG", "BISECT_START", "shallow", "commondir", "gitdir"];
const TREES = ["refs", "rebase-merge", "rebase-apply", "sequencer"];

/** Git-resolved metadata only: no file contents, object database, logs or worktree scan. */
export async function readGitMetadataSnapshot(identity, {
  isStopped = () => false, maxEntries = GIT_METADATA_SNAPSHOT_MAX_ENTRIES,
} = {}) {
  const hash = createHash("sha256");
  let entries = 0;
  const record = (location, info) => {
    if (++entries > maxEntries) throw new Error("Git metadata snapshot exceeds its entry budget.");
    // Directory timestamps include ignored lock/object/log activity. Its identity
    // plus the bounded child listing detects replacement and real metadata edits.
    const version = info.isDirectory() ? `${info.dev}:${info.ino}`
      : `${info.dev}:${info.ino}:${info.mode}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
    hash.update(location).update("\0").update(version).update("\0");
  };
  const inspect = async (location, recursive = false) => {
    if (isStopped()) return;
    const info = await fs.lstat(location, { bigint: true }).catch((error) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw error;
    });
    if (!info || (!info.isFile() && !info.isDirectory() && !info.isSymbolicLink())) return;
    record(location, info);
    if (!recursive || !info.isDirectory() || isStopped()) return;
    if (await fs.realpath(location) !== location) throw new Error("Git metadata directory changed.");
    const children = [];
    for await (const child of await fs.opendir(location)) {
      if (isStopped()) return;
      if (children.length + entries >= maxEntries) throw new Error("Git metadata snapshot exceeds its entry budget.");
      children.push(child);
    }
    const after = await fs.lstat(location, { bigint: true });
    if (after.dev !== info.dev || after.ino !== info.ino || await fs.realpath(location) !== location) {
      throw new Error("Git metadata directory changed.");
    }
    children.sort((a, b) => {
      if (a.name < b.name) return -1;
      return a.name > b.name ? 1 : 0;
    });
    for (const child of children) {
      if (isStopped()) return;
      if (child.name.endsWith(".lock") || child.name.endsWith(".cookie") || child.name === "cookies") continue;
      await inspect(path.join(location, child.name), true);
    }
  };
  if (isStopped()) return null;
  await inspect(path.join(identity.topLevel, ".git"));
  for (const directory of [...new Set([identity.gitDir, identity.commonDir].filter(Boolean))].sort()) {
    for (const file of FILES) await inspect(path.join(directory, file));
    for (const tree of TREES) await inspect(path.join(directory, tree), true);
  }
  return isStopped() ? null : hash.digest("hex");
}
