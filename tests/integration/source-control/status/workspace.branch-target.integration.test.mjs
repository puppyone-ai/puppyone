// Real local bare Git oracles, not native Cloud enrollment or API acceptance.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import {
  getWorkspaceGitStatus,
  publishWorkspaceGitBranch,
  pullWorkspaceGit,
  pushWorkspaceGit,
  writePuppyoneWorkspaceConfig,
} from "../../../../local-api/workspace.mjs";

let directory, root, origin, cloud, initial;
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
const oid = (cwd, ref) => git(cwd, "rev-parse", "--verify", ref);
async function commit(cwd, name, content) {
  await writeFile(path.join(cwd, name), content);
  git(cwd, "add", "--", name);
  git(cwd, "commit", "-m", name);
  return oid(cwd, "HEAD");
}

beforeEach(async () => {
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_CONFIG_GLOBAL", os.devNull);
  directory = await mkdtemp(path.join(os.tmpdir(), "issue-062-branch-target-"));
  root = path.join(directory, "work");
  origin = path.join(directory, "origin.git");
  cloud = path.join(directory, "cloud.git");
  git(directory, "init", "-b", "main", root);
  for (const remote of [origin, cloud]) git(directory, "init", "--bare", "-b", "main", remote);
  git(root, "config", "user.name", "Branch fixture");
  git(root, "config", "user.email", "fixture@example.test");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "remote", "add", "origin", origin);
  git(root, "remote", "add", "puppyone", cloud);
  initial = await commit(root, "base.txt", "base\n");
  for (const remote of ["origin", "puppyone"]) git(root, "push", remote, "main");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("ordinary Desktop branch targets", { timeout: 20_000 }, () => {
  it.each(["origin", "puppyone", "team/cloud"])("push honors %s upstream without changing either main", async (remote) => {
    if (remote === "team/cloud") git(root, "remote", "add", remote, cloud);
    git(root, "switch", "-c", "feature/work");
    git(root, "push", "-u", remote, "HEAD:refs/heads/release/one");
    await writePuppyoneWorkspaceConfig(root, {
      sync: { sourceOfTruth: { service: "puppyone", remote: "puppyone", branch: "main" } },
    });
    const head = await commit(root, "work.txt", "private work\n");
    const status = await pushWorkspaceGit(root);
    expect(oid(remote === "origin" ? origin : cloud, "refs/heads/release/one")).toBe(head);
    for (const repository of [origin, cloud]) expect(oid(repository, "refs/heads/main")).toBe(initial);
    expect(git(root, "rev-parse", "--abbrev-ref", "@{u}")).toBe(`${remote}/release/one`);
    expect(status.syncTarget.ref).toBe(`${remote}/release/one`);
  });

  it("publishes a new feature to the same name, leaving main and private files alone", async () => {
    git(root, "switch", "-c", "feature/new");
    const head = await commit(root, "feature.txt", "feature\n");
    await writeFile(path.join(root, "private.txt"), "not uploaded\n");
    const before = git(root, "status", "--porcelain=v1");
    await publishWorkspaceGitBranch(root);
    expect(oid(cloud, "refs/heads/feature/new")).toBe(head);
    expect(oid(cloud, "refs/heads/main")).toBe(initial);
    expect(git(root, "status", "--porcelain=v1")).toBe(before);
    expect(git(root, "rev-parse", "--abbrev-ref", "@{u}")).toBe("puppyone/feature/new");
    expect(git(cloud, "ls-tree", "-r", "--name-only", "feature/new")).not.toContain("private.txt");
  });

  it("does not display a guessed main destination while detached", async () => {
    git(root, "switch", "--detach");
    const status = await getWorkspaceGitStatus(root);
    expect(status.syncTarget.ref).toBeNull();
    await expect(pushWorkspaceGit(root)).rejects.toThrow(/not on a branch|detached/i);
    expect(oid(cloud, "main")).toBe(initial);
  });

  it.each(["pull.rebase", "branch.main.rebase"])("honors %s=false rather than forcing a rebase for a Cloud remote", async (key) => {
    git(root, "branch", "--set-upstream-to=puppyone/main", "main");
    git(root, "config", "pull.rebase", "true");
    git(root, "config", key, "false");
    const local = await commit(root, "local.txt", "local\n");
    const peer = path.join(directory, "peer");
    git(directory, "clone", cloud, peer);
    git(peer, "config", "user.name", "Peer fixture");
    git(peer, "config", "user.email", "peer@example.test");
    const incoming = await commit(peer, "incoming.txt", "incoming\n");
    git(peer, "push");
    await pullWorkspaceGit(root);
    expect(git(root, "show", "-s", "--format=%P", "HEAD").split(" ")).toEqual([local, incoming]);
    expect(oid(cloud, "main")).toBe(incoming);
  });

  it("does not upload a later checkout or rebind it after an in-flight push", async () => {
    git(root, "switch", "-c", "feature/captured");
    const captured = await commit(root, "captured.txt", "captured\n");
    const marker = path.join(directory, "receiving");
    const release = path.join(directory, "release");
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(path.join(cloud, "hooks", "pre-receive"), [
      "#!/bin/sh", `touch ${quote(marker)}`, "i=0",
      `while [ ! -f ${quote(release)} ] && [ "$i" -lt 200 ]; do sleep 0.05; i=$((i+1)); done`,
      `test -f ${quote(release)}`, "",
    ].join("\n"), { mode: 0o700 });
    const pending = publishWorkspaceGitBranch(root).then(() => null, (error) => error);
    let later, error;
    try {
      const deadline = Date.now() + 5000;
      while (!(await access(marker).then(() => true, () => false))) {
        if (Date.now() >= deadline) throw new Error("Owned receive hook did not start");
        await delay(20);
      }
      git(root, "switch", "-c", "another-branch");
      later = await commit(root, "later.txt", "not the push request\n");
    } finally {
      await writeFile(release, "release\n");
      error = await pending;
    }
    expect(error?.message).toMatch(/Push completed.*local branch state changed/);
    expect(oid(cloud, "refs/heads/feature/captured")).toBe(captured);
    expect(oid(cloud, "refs/heads/main")).toBe(initial);
    expect(oid(root, "HEAD")).toBe(later);
    expect(git(root, "branch", "--show-current")).toBe("another-branch");
    expect(() => git(root, "config", "--get", "branch.another-branch.remote")).toThrow();
    expect(() => git(root, "config", "--get", "branch.feature/captured.remote")).toThrow();
  });

  it("ff-only rejection and stale Push preserve local commits, files and upstream", async () => {
    git(root, "switch", "-c", "feature/race");
    git(root, "push", "-u", "puppyone", "feature/race");
    git(root, "config", "pull.ff", "only");
    const local = await commit(root, "local.txt", "local\n");
    await writeFile(path.join(root, "private.txt"), "private\n");
    const dirty = git(root, "status", "--porcelain=v1");
    const stale = await getWorkspaceGitStatus(root);
    expect(stale.syncTarget.behind).toBe(0);
    const peer = path.join(directory, "peer");
    git(directory, "clone", "--branch", "feature/race", cloud, peer);
    git(peer, "config", "user.name", "Peer fixture");
    git(peer, "config", "user.email", "peer@example.test");
    const incoming = await commit(peer, "incoming.txt", "incoming\n");
    git(peer, "push");
    await expect(pushWorkspaceGit(root)).rejects.toThrow(/rejected|fetch first|non-fast-forward/i);
    await expect(pullWorkspaceGit(root)).rejects.toThrow(/fast-forward/i);
    expect(oid(root, "HEAD")).toBe(local);
    expect(oid(cloud, "refs/heads/feature/race")).toBe(incoming);
    expect(oid(cloud, "refs/heads/main")).toBe(initial);
    expect(git(root, "status", "--porcelain=v1")).toBe(dirty);
    expect(git(root, "rev-parse", "--abbrev-ref", "@{u}")).toBe("puppyone/feature/race");
  });
});
