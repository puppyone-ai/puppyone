import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GIT_READ_TIMEOUT_MS, execGit } from "./runner.mjs";

/**
 * How many files a single scope summary will measure. Beyond this the answer
 * stops being a number the user reads and starts being a progress bar, so the
 * summary reports "at least" instead of walking the rest of the tree.
 */
export const PUBLISH_SCOPE_FILE_LIMIT = 20_000;
const SIZE_CONCURRENCY = 48;
/** A scope summary is a read; it must never outlive the form that asked for it. */
const PUBLISH_SCOPE_TIMEOUT_MS = GIT_READ_TIMEOUT_MS * 4;

/**
 * What a folder would make reachable, counted the way Git counts it.
 *
 * Reach is produced by committing the folder and sending that commit, so the
 * honest answer is exactly the set `git add` would take: tracked files plus
 * untracked files that no ignore rule excludes. Asking Git keeps one ignore
 * engine in the product instead of a second, divergent one.
 *
 * Folders that do not have version history yet still have `.gitignore` files,
 * and those rules will apply the moment history is enabled. Borrowing an
 * isolated repository directory outside the project lets Git answer for them
 * too, without creating anything inside the user's folder.
 *
 * @returns {Promise<{ files: number, bytes: number, truncated: boolean }>}
 */
export async function readGitPublishScope(root, relativePath = "", options = {}) {
  const pathspec = normalizePathspec(relativePath);
  const limit = Math.max(1, options.fileLimit ?? PUBLISH_SCOPE_FILE_LIMIT);
  const tracked = await isGitWorkTree(root, options.signal);
  const paths = tracked
    ? await listReachableFiles(root, pathspec, [], options.signal)
    : await withBorrowedRepository(root, (gitDir) => (
      listReachableFiles(root, pathspec, ["--git-dir", gitDir, "--work-tree", root], options.signal)
    ));
  const truncated = paths.length > limit;
  const measured = truncated ? paths.slice(0, limit) : paths;
  return { files: measured.length, bytes: await sumFileSizes(root, measured), truncated };
}

async function isGitWorkTree(root, signal) {
  return execGit(root, ["rev-parse", "--is-inside-work-tree"], { signal })
    .then((result) => result.stdout.trim() === "true")
    .catch(() => false);
}

/**
 * `--cached` carries files whose history already exists, `--others
 * --exclude-standard` carries the rest that Git would accept. Together they are
 * the publishable set. A file can appear in both lists, so the set is unique by
 * path rather than by line.
 */
async function listReachableFiles(root, pathspec, prefixArgs, signal) {
  const args = [...prefixArgs, "ls-files", "-z", "--cached", "--others", "--exclude-standard"];
  if (pathspec) args.push("--", pathspec);
  const { stdout } = await execGit(root, args, {
    signal,
    timeout: PUBLISH_SCOPE_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...new Set(stdout.split("\0").filter((entry) => entry.length > 0))];
}

/**
 * A repository directory outside the project. Git reads `.gitignore` from the
 * work tree and writes only inside the borrowed directory, so a folder without
 * version history keeps having none.
 */
async function withBorrowedRepository(root, run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-publish-scope-"));
  const gitDir = path.join(directory, "repository.git");
  try {
    await execGit(root, ["--git-dir", gitDir, "--work-tree", root, "init", "--quiet"], {
      timeout: PUBLISH_SCOPE_TIMEOUT_MS,
    });
    return await run(gitDir);
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function sumFileSizes(root, relativePaths) {
  let bytes = 0;
  for (let index = 0; index < relativePaths.length; index += SIZE_CONCURRENCY) {
    const batch = relativePaths.slice(index, index + SIZE_CONCURRENCY);
    const sizes = await Promise.all(batch.map((relativePath) => (
      fs.lstat(path.join(root, relativePath))
        .then((entry) => (entry.isFile() ? entry.size : 0))
        .catch(() => 0)
    )));
    for (const size of sizes) bytes += size;
  }
  return bytes;
}

/**
 * Trailing separators and `.` would make Git treat the pathspec as a literal
 * entry rather than the folder it came from.
 */
function normalizePathspec(relativePath) {
  if (typeof relativePath !== "string") return "";
  const trimmed = relativePath.replace(/^[./]+/, "").replace(/\/+$/, "");
  return trimmed === "." ? "" : trimmed;
}
