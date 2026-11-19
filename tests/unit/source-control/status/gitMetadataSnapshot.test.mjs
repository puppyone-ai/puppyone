import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readGitMetadataSnapshot } from "../../../../electron/main/git-metadata-snapshot.mjs";

const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const topLevel = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-git-snapshot-")));
  roots.push(topLevel);
  const gitDir = path.join(topLevel, ".git");
  await fs.mkdir(path.join(gitDir, "refs/heads"), { recursive: true });
  await fs.writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  await fs.writeFile(path.join(gitDir, "refs/heads/main"), "a".repeat(40));
  return { topLevel, gitDir, commonDir: gitDir };
}

it("detects metadata changes while ignoring worktree, object, log and lock activity", async () => {
  const identity = await fixture();
  const original = await readGitMetadataSnapshot(identity);
  await fs.writeFile(path.join(identity.topLevel, "note.md"), "working tree");
  await fs.mkdir(path.join(identity.gitDir, "objects"));
  await fs.mkdir(path.join(identity.gitDir, "logs"));
  await fs.writeFile(path.join(identity.gitDir, "objects/data"), "object");
  await fs.writeFile(path.join(identity.gitDir, "logs/HEAD"), "log");
  await fs.writeFile(path.join(identity.gitDir, "refs/heads/main.lock"), "lock");
  expect(await readGitMetadataSnapshot(identity)).toBe(original);
  await fs.writeFile(path.join(identity.gitDir, "refs/heads/main"), "b".repeat(40));
  expect(await readGitMetadataSnapshot(identity)).not.toBe(original);
});

it("does not follow metadata symlinks", async () => {
  const identity = await fixture();
  const outside = path.join(identity.topLevel, "outside");
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(identity.gitDir, "refs/escape"), process.platform === "win32" ? "junction" : "dir");
  const original = await readGitMetadataSnapshot(identity);
  await fs.writeFile(path.join(outside, "private"), "outside change");
  expect(await readGitMetadataSnapshot(identity)).toBe(original);
});

it("fails conservatively at the metadata entry budget", async () => {
  const identity = await fixture();
  await expect(readGitMetadataSnapshot(identity, { maxEntries: 2 })).rejects.toThrow("entry budget");
});

it("does no further work after cancellation", async () => {
  expect(await readGitMetadataSnapshot({ topLevel: "/unused", gitDir: "/unused/.git" }, { isStopped: () => true })).toBeNull();
});
