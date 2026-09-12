import { execFile } from "node:child_process";
import * as fsPromises from "node:fs/promises";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createCloudGitOperationLease } from "../../../../electron/main/cloud-git-operation-lease.mjs";

const execFileAsync = promisify(execFile);
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Cloud Git cross-process lease", () => {
  it("serializes linked worktrees through the shared Git commonDir", async () => {
    const fixture = await createLinkedWorktree();
    const first = createCloudGitOperationLease();
    const second = createCloudGitOperationLease();
    const held = await first.acquire(fixture.root);

    await expect(second.acquire(fixture.linked)).rejects.toMatchObject({
      publishCode: "JOURNAL_IO_FAILED",
      publishRetryable: true,
    });
    const commonDir = path.resolve(fixture.root, await git(fixture.root, "rev-parse", "--git-common-dir"));
    const leasePath = path.join(commonDir, "puppyone", "cloud-git-operation.lease.json");
    expect(JSON.parse(await readFile(leasePath, "utf8"))).toMatchObject({ pid: process.pid });

    await held.release();
    const acquiredFromLinked = await second.acquire(fixture.linked);
    await acquiredFromLinked.release();
  });

  it("never steals an expired lease while its owner PID is alive", async () => {
    const fixture = await createLinkedWorktree();
    let clock = Date.now();
    const options = { now: () => clock, isProcessAlive: () => true };
    const held = await createCloudGitOperationLease(options).acquire(fixture.root);
    clock += 24 * 60 * 60 * 1000;

    await expect(createCloudGitOperationLease(options).acquire(fixture.linked))
      .rejects.toMatchObject({ publishCode: "JOURNAL_IO_FAILED" });
    await held.release();
  });

  it("reclaims a lease owned by a dead PID even before its timestamp expires", async () => {
    const fixture = await createLinkedWorktree();
    const commonDir = path.resolve(fixture.root, await git(fixture.root, "rev-parse", "--git-common-dir"));
    const directory = path.join(commonDir, "puppyone");
    const leasePath = path.join(directory, "cloud-git-operation.lease.json");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(leasePath, `${JSON.stringify({
      version: 1,
      owner_token: "dead-owner",
      pid: 999_999,
      heartbeat_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    })}\n`, { mode: 0o600 });
    await chmod(leasePath, 0o600);

    const acquired = await createCloudGitOperationLease({ isProcessAlive: () => false })
      .acquire(fixture.linked);
    expect(JSON.parse(await readFile(leasePath, "utf8"))).toMatchObject({ pid: process.pid });
    await acquired.release();
  });

  it("serializes two contenders that both observed the same dead lease", async () => {
    const fixture = await createLinkedWorktree();
    const commonDir = path.resolve(fixture.root, await git(fixture.root, "rev-parse", "--git-common-dir"));
    const directory = path.join(commonDir, "puppyone");
    const leasePath = path.join(directory, "cloud-git-operation.lease.json");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(leasePath, `${JSON.stringify({
      version: 1,
      owner_token: "dead-owner",
      pid: 999_999,
      heartbeat_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    })}\n`, { mode: 0o600 });

    let deadReads = 0;
    let releaseDeadReads;
    const bothReadDeadLease = new Promise((resolve) => { releaseDeadReads = resolve; });
    const fsApi = {
      ...fsPromises,
      async readFile(filePath, ...args) {
        const value = await fsPromises.readFile(filePath, ...args);
        if (filePath === leasePath && String(value).includes('"owner_token":"dead-owner"') && deadReads < 2) {
          deadReads += 1;
          if (deadReads === 2) releaseDeadReads();
          await bothReadDeadLease;
        }
        return value;
      },
    };
    const options = { fsApi, isProcessAlive: (pid) => pid === process.pid };
    const results = await Promise.allSettled([
      createCloudGitOperationLease(options).acquire(fixture.root),
      createCloudGitOperationLease(options).acquire(fixture.linked),
    ]);

    const acquired = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(acquired).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ publishCode: "JOURNAL_IO_FAILED" });
    expect(JSON.parse(await readFile(leasePath, "utf8")).owner_token)
      .toBe(acquired[0].value.ownerToken);
    await acquired[0].value.release();
  });
});

async function createLinkedWorktree() {
  const root = await mkdtemp(path.join(os.tmpdir(), "puppyone-lease-root-"));
  const linked = await mkdtemp(path.join(os.tmpdir(), "puppyone-lease-linked-"));
  roots.push(root, linked);
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "test@puppyone.invalid");
  await git(root, "config", "user.name", "PuppyOne Test");
  await writeFile(path.join(root, "README.md"), "lease\n");
  await git(root, "add", "README.md");
  await git(root, "commit", "-qm", "initial");
  await rm(linked, { recursive: true, force: true });
  await git(root, "worktree", "add", "-q", "-b", "lease-linked", linked);
  return { root, linked };
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
  return stdout.trim();
}
