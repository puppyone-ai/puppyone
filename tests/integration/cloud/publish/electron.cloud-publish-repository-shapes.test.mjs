import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPublishCoordinator,
  createPublishFixture,
  git,
} from "../../../support/cloud/publishCoordinatorHarness.mjs";

// The shapes ordinary projects have when they are put in the Cloud for the
// first time. The native Version Engine accepts any commit graph, so every
// shape except Git LFS must arrive with its history intact. Desktop must not
// refuse what Cloud accepts: a client-side copy of a server rule that the
// server no longer has is how merge commits stopped every GitHub project.
//
// The remote is a bare repository, so this proves what Desktop sends and that
// stock Git can read it back. It does not prove a running Puppyone server
// accepts it; that is the cross-repository end-to-end test's job.

const roots = [];
vi.setConfig({ testTimeout: 20_000 });

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const currentBranch = (root) => git(root, "symbolic-ref", "--short", "HEAD");

async function commitFile(root, name, content, message) {
  await writeFile(path.join(root, name), content);
  await git(root, "add", name);
  await git(root, "commit", "-qm", message);
}

const shapes = {
  async linear(root) {
    await commitFile(root, "README.md", "first\n", "first");
    await commitFile(root, "notes.md", "second\n", "second");
  },
  // What GitHub's "Merge pull request" leaves at the tip of main.
  async mergeTip(root) {
    await commitFile(root, "README.md", "base\n", "base");
    const trunk = await currentBranch(root);
    await git(root, "checkout", "-q", "-b", "feature");
    await commitFile(root, "feature.md", "feature\n", "feature");
    await git(root, "checkout", "-q", trunk);
    await commitFile(root, "main.md", "main\n", "main");
    await git(root, "merge", "-q", "--no-ff", "feature", "-m", "Merge pull request #1 from example/feature");
  },
  async mergeInHistory(root) {
    await shapes.mergeTip(root);
    await commitFile(root, "after.md", "after the merge\n", "after the merge");
  },
  async octopusMergeTip(root) {
    await commitFile(root, "README.md", "base\n", "base");
    const trunk = await currentBranch(root);
    for (const name of ["one", "two", "three"]) {
      await git(root, "checkout", "-q", "-b", name);
      await commitFile(root, `${name}.md`, `${name}\n`, name);
      await git(root, "checkout", "-q", trunk);
    }
    await git(root, "merge", "-q", "--no-ff", "one", "two", "three", "-m", "octopus");
  },
  async unrelatedHistoriesMerge(root) {
    await commitFile(root, "README.md", "base\n", "base");
    const trunk = await currentBranch(root);
    await git(root, "checkout", "-q", "--orphan", "imported");
    await git(root, "rm", "-rq", "--cached", ".");
    await rm(path.join(root, "README.md"));
    await commitFile(root, "imported.md", "imported\n", "imported");
    await git(root, "checkout", "-q", trunk);
    await git(root, "merge", "-q", "--no-ff", "--allow-unrelated-histories", "imported", "-m", "bring in imported");
  },
  // An empty folder: preparation records an empty initial snapshot.
  async emptySnapshot(root) {
    await git(root, "commit", "-q", "--allow-empty", "-m", "Initial snapshot");
  },
  // Starts like an LFS pointer but is ordinary text, so it is not one.
  async lfsLookalikeText(root) {
    await commitFile(root, "guide.md", "version https://git-lfs.github.com/spec/v1\nThis guide explains pointers.\n", "guide");
  },
  async lfsPointer(root) {
    await commitFile(root, "README.md", "base\n", "base");
    await commitFile(root, "video.mp4", [
      "version https://git-lfs.github.com/spec/v1",
      `oid sha256:${"a".repeat(64)}`,
      "size 1048576",
      "",
    ].join("\n"), "add video through LFS");
  },
};

async function parentsOf(repository, ref) {
  return (await git(repository, "rev-list", "--parents", "-n", "1", ref)).split(" ").slice(1);
}

describe("Cloud first push across repository shapes", () => {
  it.each([
    ["linear", 1],
    ["mergeTip", 2],
    ["mergeInHistory", 1],
    ["octopusMergeTip", 4],
    ["unrelatedHistoriesMerge", 2],
    ["emptySnapshot", 0],
    ["lfsLookalikeText", 0],
  ])("sends a %s repository with its history intact", async (shape, tipParents) => {
    const fixture = await createPublishFixture("main", { roots, prepareRepository: shapes[shape] });
    expect(await parentsOf(fixture.root, "HEAD")).toHaveLength(tipParents);

    const result = await createPublishCoordinator(fixture).startOrResume(fixture.request);

    expect(result).toMatchObject({ ok: true, state: { push: "accepted", attemptCommitOid: fixture.head } });
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(fixture.head);
    expect(await parentsOf(fixture.bare, "main")).toEqual(await parentsOf(fixture.root, "HEAD"));
    expect(await git(fixture.bare, "rev-list", "--count", "main"))
      .toBe(await git(fixture.root, "rev-list", "--count", "HEAD"));
    await git(fixture.bare, "fsck", "--strict", "--no-dangling");
    expect(fixture.cloud.requests.filter((entry) => entry.path === "/projects/")).toHaveLength(1);
  });

  it("refuses Git LFS pointers before creating anything in Cloud", async () => {
    const fixture = await createPublishFixture("main", { roots, prepareRepository: shapes.lfsPointer });

    const result = await createPublishCoordinator(fixture).startOrResume(fixture.request);

    expect(result).toMatchObject({ ok: false, state: null, error: { code: "LFS_UNSUPPORTED", retryable: false } });
    expect(fixture.cloud.requests).toEqual([]);
    expect(await git(fixture.root, "remote")).toBe("");
    expect(await git(fixture.bare, "for-each-ref")).toBe("");
    const gitDir = await git(fixture.root, "rev-parse", "--absolute-git-dir");
    await expect(readFile(path.join(gitDir, "puppyone", "pending-cloud-publish.v1.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retries a merge-tip send that an earlier release refused, keeping the same Cloud project", async () => {
    const fixture = await createPublishFixture("main", { roots, prepareRepository: shapes.mergeTip });
    const pause = Object.assign(new Error("stop after the Cloud project exists"), { simulateCrash: true });
    await expect(createPublishCoordinator(fixture, {
      faultInjector: async (point) => { if (point === "after-project-created") throw pause; },
    }).startOrResume(fixture.request)).rejects.toBe(pause);
    // What an earlier release journaled when its preflight refused the merge tip.
    const gitDir = await git(fixture.root, "rev-parse", "--absolute-git-dir");
    const journalPath = path.join(gitDir, "puppyone", "pending-cloud-publish.v1.json");
    const record = JSON.parse(await readFile(journalPath, "utf8"));
    record.push_state = "failed";
    record.last_error = { code: "MERGE_TIP_UNSUPPORTED", retryable: false, occurred_at: record.updated_at };
    await writeFile(journalPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });

    const pending = await createPublishCoordinator(fixture).getState(fixture.request);
    expect(pending).toMatchObject({ ok: true, state: {
      lastError: { code: "MERGE_TIP_UNSUPPORTED" },
      availableActions: expect.arrayContaining(["retry-push"]),
    } });

    const result = await createPublishCoordinator(fixture).startOrResume({
      ...fixture.request,
      operationId: pending.state.operationId,
      action: "retry-push",
    });

    expect(result).toMatchObject({ ok: true, state: { push: "accepted", attemptCommitOid: fixture.head } });
    expect(await git(fixture.bare, "rev-parse", "refs/heads/main")).toBe(fixture.head);
    expect(await parentsOf(fixture.bare, "main")).toHaveLength(2);
    expect(fixture.cloud.requests.filter((entry) => entry.path === "/projects/")).toHaveLength(1);
  });
});
