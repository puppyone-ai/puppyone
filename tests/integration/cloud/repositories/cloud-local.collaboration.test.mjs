// Cloud <-> local collaboration (云端协同) round-trip.
//
// The product syncs a local workspace with its cloud project over a Git remote
// (push/pull to the PuppyOne cloud git endpoint). This test reproduces that
// collaboration mechanic end-to-end with REAL git: a bare repository stands in
// for the cloud endpoint, and two working copies (A = this machine, B = another
// collaborator / the cloud agent's checkout) sync through it using the
// workspace module's own push/pull/fetch — not raw git — so the sync logic
// itself is under test.
//
// Setup is inline per-test (not beforeEach) with generous timeouts: real git
// over temp dirs on Windows is slow, and a timed-out hook would otherwise clobber
// shared state. Each test owns an isolated cloud+A+B and cleans up in finally.
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  getWorkspaceGitStatus,
  abortWorkspaceGitOperation,
  createWorkspaceEntry,
  writeWorkspaceTextFile,
  readWorkspaceTextFile,
  stageAllWorkspaceGitChanges,
  commitWorkspaceGit,
  continueWorkspaceGitOperation,
  pushWorkspaceGit,
  pullWorkspaceGit,
  fetchWorkspaceGit,
} from "../../../../local-api/workspace.mjs";

// The full integration suite deliberately exercises several real repositories
// in parallel. Allow enough headroom for Git/fs process contention on loaded CI
// and reference machines; assertion failures still surface immediately.
const TIMEOUT = 180_000;

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args]).toString().trim();
}

function setIdentity(cwd) {
  git(cwd, "config", "user.email", "test@puppyone.test");
  git(cwd, "config", "user.name", "PuppyOne Test");
  git(cwd, "config", "commit.gpgsign", "false");
  git(cwd, "config", "core.autocrlf", "false"); // deterministic EOL across platforms
}

// Read text content with EOL normalized — the test asserts content propagation,
// not platform line-ending fidelity.
async function readContent(ws, relativePath) {
  const file = await readWorkspaceTextFile(ws, relativePath);
  return file.content.replaceAll("\r\n", "\n");
}

// Build an isolated {cloud bare + workspace A linked to it + clone B} and return
// the paths plus a cleanup fn. A already has a seeded first commit pushed.
async function setupCollab() {
  const base = await mkdtemp(path.join(os.tmpdir(), "puppyone-collab-"));
  const cloudBare = path.join(base, "cloud.git");
  const workA = path.join(base, "A");
  const workB = path.join(base, "clones", "B");

  execFileSync("git", ["init", "--bare", cloudBare]);
  execFileSync("git", ["init", workA]);
  setIdentity(workA);
  await createWorkspaceEntry(workA, { parentPath: null, name: "shared.txt", kind: "file", content: "v1\n" });
  await stageAllWorkspaceGitChanges(workA);
  await commitWorkspaceGit(workA, "seed: shared.txt");
  const branch = (await getWorkspaceGitStatus(workA)).branch;
  git(workA, "remote", "add", "origin", cloudBare);
  git(workA, "push", "-u", "origin", branch);
  git(cloudBare, "symbolic-ref", "HEAD", `refs/heads/${branch}`);

  // Clone with autocrlf off so B's checkout keeps LF (a CRLF checkout would let B
  // re-commit shared files with rewritten EOLs and corrupt cross-clone diffs).
  execFileSync("git", ["clone", "-c", "core.autocrlf=false", cloudBare, workB]);
  setIdentity(workB);

  const cleanup = () => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return { workA, workB, cleanup };
}

describe("云端协同 (cloud <-> local collaboration)", () => {
  it("propagates edits bidirectionally through the shared cloud remote", async () => {
    const { workA, workB, cleanup } = await setupCollab();
    try {
      // B starts from the seed A pushed.
      expect(await readContent(workB, "shared.txt")).toBe("v1\n");

      // 端 -> 云 -> 端: A edits + commits + pushes; B pulls and sees it.
      await writeWorkspaceTextFile(workA, "shared.txt", "v1\nv2 from A\n");
      await stageAllWorkspaceGitChanges(workA);
      await commitWorkspaceGit(workA, "edit: append v2");
      await pushWorkspaceGit(workA);
      await pullWorkspaceGit(workB);
      expect(await readContent(workB, "shared.txt")).toBe("v1\nv2 from A\n");

      // Reverse: a new file authored on B reaches A.
      await createWorkspaceEntry(workB, { parentPath: null, name: "from-b.md", kind: "file", content: "# Authored on B\n" });
      await stageAllWorkspaceGitChanges(workB);
      await commitWorkspaceGit(workB, "docs: add from-b.md");
      await pushWorkspaceGit(workB);
      await pullWorkspaceGit(workA);
      expect(await readContent(workA, "from-b.md")).toBe("# Authored on B\n");
    } finally {
      await cleanup();
    }
  }, TIMEOUT);

  it("surfaces ahead/behind sync status", async () => {
    const { workA, workB, cleanup } = await setupCollab();
    try {
      // A commits locally but has not pushed yet -> status reports it ahead.
      await createWorkspaceEntry(workA, { parentPath: null, name: "local-only.txt", kind: "file", content: "x\n" });
      await stageAllWorkspaceGitChanges(workA);
      await commitWorkspaceGit(workA, "local only");
      const aheadStatus = await getWorkspaceGitStatus(workA);
      expect(aheadStatus.sourceControl.remote.ahead).toBeGreaterThanOrEqual(1);
      await pushWorkspaceGit(workA);

      // B syncs (to fast-forward), then publishes a commit A hasn't seen.
      await pullWorkspaceGit(workB);
      await createWorkspaceEntry(workB, { parentPath: null, name: "note.txt", kind: "file", content: "b1\n" });
      await stageAllWorkspaceGitChanges(workB);
      await commitWorkspaceGit(workB, "note");
      await pushWorkspaceGit(workB);

      // A fetches (no pull) -> behind >= 1; after pull -> behind 0 and has the file.
      const behindStatus = await fetchWorkspaceGit(workA);
      expect(behindStatus.sourceControl.remote.behind).toBeGreaterThanOrEqual(1);
      await pullWorkspaceGit(workA);
      const synced = await getWorkspaceGitStatus(workA);
      expect(synced.sourceControl.remote.behind).toBe(0);
      expect(await readContent(workA, "note.txt")).toBe("b1\n");
    } finally {
      await cleanup();
    }
  }, TIMEOUT);

  it("rebases local commits before pushing a diverged branch", async () => {
    const { workA, workB, cleanup } = await setupCollab();
    try {
      await createWorkspaceEntry(workA, {
        parentPath: null,
        name: "local-a.md",
        kind: "file",
        content: "local A\n",
      });
      await stageAllWorkspaceGitChanges(workA);
      await commitWorkspaceGit(workA, "local: add A");

      await createWorkspaceEntry(workB, {
        parentPath: null,
        name: "remote-b.md",
        kind: "file",
        content: "remote B\n",
      });
      await stageAllWorkspaceGitChanges(workB);
      await commitWorkspaceGit(workB, "remote: add B");
      await pushWorkspaceGit(workB);

      const diverged = await fetchWorkspaceGit(workA);
      expect(diverged.sourceControl.remote).toMatchObject({
        state: "diverged",
        ahead: 1,
        behind: 1,
        canPull: true,
        canPush: false,
      });

      const integrated = await pullWorkspaceGit(workA);
      expect(integrated.sourceControl.remote).toMatchObject({
        state: "outgoing",
        behind: 0,
        canPush: true,
      });
      expect(await readContent(workA, "local-a.md")).toBe("local A\n");
      expect(await readContent(workA, "remote-b.md")).toBe("remote B\n");
      expect(git(workA, "log", "--merges", "--oneline")).toBe("");

      await pushWorkspaceGit(workA);
      expect((await getWorkspaceGitStatus(workA)).sourceControl.remote).toMatchObject({
        state: "synced",
        ahead: 0,
        behind: 0,
      });
    } finally {
      await cleanup();
    }
  }, TIMEOUT);

  it("preserves uncommitted files while pulling a non-overlapping remote commit", async () => {
    const { workA, workB, cleanup } = await setupCollab();
    try {
      await createWorkspaceEntry(workA, {
        parentPath: null,
        name: "local-staged.md",
        kind: "file",
        content: "staged but not committed\n",
      });
      await stageAllWorkspaceGitChanges(workA);
      await createWorkspaceEntry(workA, {
        parentPath: null,
        name: "local-draft.md",
        kind: "file",
        content: "not staged\n",
      });
      await createWorkspaceEntry(workB, {
        parentPath: null,
        name: "remote-commit.md",
        kind: "file",
        content: "committed remotely\n",
      });
      await stageAllWorkspaceGitChanges(workB);
      await commitWorkspaceGit(workB, "remote: add committed file");
      await pushWorkspaceGit(workB);

      const pulled = await pullWorkspaceGit(workA);
      expect(pulled.sourceControl.remote).toMatchObject({ state: "synced", behind: 0 });
      expect(await readContent(workA, "local-staged.md")).toBe("staged but not committed\n");
      expect(await readContent(workA, "local-draft.md")).toBe("not staged\n");
      expect(await readContent(workA, "remote-commit.md")).toBe("committed remotely\n");
      expect(pulled.untrackedEntries).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "local-draft.md" }),
      ]));
      expect(pulled.stagedEntries).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: "local-staged.md" }),
      ]));
    } finally {
      await cleanup();
    }
  }, TIMEOUT);

  it("surfaces and completes a rebase conflict before allowing Push", async () => {
    const { workA, workB, cleanup } = await setupCollab();
    try {
      await writeWorkspaceTextFile(workA, "shared.txt", "local version\n");
      await stageAllWorkspaceGitChanges(workA);
      await commitWorkspaceGit(workA, "local: edit shared file");

      await writeWorkspaceTextFile(workB, "shared.txt", "remote version\n");
      await stageAllWorkspaceGitChanges(workB);
      await commitWorkspaceGit(workB, "remote: edit shared file");
      await pushWorkspaceGit(workB);

      await expect(pullWorkspaceGit(workA)).rejects.toThrow(/conflict|could not apply/i);
      const conflicted = await getWorkspaceGitStatus(workA);
      expect(conflicted.sourceControl.operation).toMatchObject({
        kind: "rebase",
        canContinue: false,
        canAbort: true,
      });
      expect(conflicted.sourceControl.groups.find((group) => group.id === "merge")?.resources).toHaveLength(1);
      expect(conflicted.sourceControl.remote.canPush).toBe(false);
      await expect(pushWorkspaceGit(workA)).rejects.toThrow(/rebase is in progress/i);
      await expect(pullWorkspaceGit(workA)).rejects.toThrow(/rebase is in progress/i);

      const aborted = await abortWorkspaceGitOperation(workA);
      expect(aborted.sourceControl.operation).toBeNull();
      expect(aborted.sourceControl.remote).toMatchObject({ state: "diverged", canPull: true, canPush: false });
      await expect(pullWorkspaceGit(workA)).rejects.toThrow(/conflict|could not apply/i);

      await writeWorkspaceTextFile(workA, "shared.txt", "resolved version\n");
      await stageAllWorkspaceGitChanges(workA);
      const ready = await getWorkspaceGitStatus(workA);
      expect(ready.sourceControl.operation).toMatchObject({ kind: "rebase", canContinue: true });

      const continued = await continueWorkspaceGitOperation(workA);
      expect(continued.sourceControl.operation).toBeNull();
      expect(continued.sourceControl.remote).toMatchObject({ state: "outgoing", behind: 0, canPush: true });
      expect(await readContent(workA, "shared.txt")).toBe("resolved version\n");
      expect(git(workA, "log", "--merges", "--oneline")).toBe("");
    } finally {
      await cleanup();
    }
  }, TIMEOUT);

  it("surfaces an autostash conflict without losing an uncommitted edit", async () => {
    const { workA, workB, cleanup } = await setupCollab();
    try {
      await writeWorkspaceTextFile(workA, "shared.txt", "uncommitted local version\n");
      await writeWorkspaceTextFile(workB, "shared.txt", "committed remote version\n");
      await stageAllWorkspaceGitChanges(workB);
      await commitWorkspaceGit(workB, "remote: replace shared file");
      await pushWorkspaceGit(workB);

      await pullWorkspaceGit(workA).catch(() => null);
      const conflicted = await getWorkspaceGitStatus(workA);
      const shared = await readContent(workA, "shared.txt");
      expect(conflicted.sourceControl.operation).toBeNull();
      expect(conflicted.sourceControl.groups.find((group) => group.id === "merge")?.resources).toHaveLength(1);
      expect(conflicted.sourceControl.remote).toMatchObject({ behind: 0, canPush: false });
      expect(shared).toContain("uncommitted local version");
      expect(shared).toContain("committed remote version");
      await expect(pushWorkspaceGit(workA)).rejects.toThrow(/unresolved file conflicts/i);

      await writeWorkspaceTextFile(workA, "shared.txt", "resolved autostash version\n");
      await stageAllWorkspaceGitChanges(workA);
      await commitWorkspaceGit(workA, "resolve: autostash conflict");
      await pushWorkspaceGit(workA);
      expect((await getWorkspaceGitStatus(workA)).sourceControl.remote.state).toBe("synced");
    } finally {
      await cleanup();
    }
  }, TIMEOUT);
});
