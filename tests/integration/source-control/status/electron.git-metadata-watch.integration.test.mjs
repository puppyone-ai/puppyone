// Integration coverage for the Git metadata watch service against real
// temporary repositories. These tests drive external git commands (add,
// commit, ref updates) and assert with eventual predicates that:
//   - the metadata watcher delivers repository invalidations, and
//   - the fast status reader eventually converges on repository truth.
// See https://github.com/puppyone-ai/puppy-issues/blob/main/document/puppyone-desktop/source-control/refresh-lifecycle.md (Work Package 6).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  GIT_REPOSITORY_INVALIDATED_CHANNEL,
  createGitMetadataWatchService,
} from "../../../../electron/main/git-metadata-watch-service.mjs";
import {
  getWorkspaceGitStatus,
  resolveGitRepositoryIdentity,
} from "../../../../local-api/workspace.mjs";

let root;
const services = [];

function git(args) {
  return execFileSync("git", ["-C", root, ...args]).toString().trim();
}

function initRepoWithIdentity() {
  execFileSync("git", ["-C", root, "init"]);
  git(["config", "user.email", "test@puppyone.test"]);
  git(["config", "user.name", "PuppyOne Test"]);
  git(["config", "commit.gpgsign", "false"]);
}

function createRecordingSender(id = 1) {
  const events = [];
  return {
    events,
    sender: {
      id,
      isDestroyed: () => false,
      send: (channel, payload) => events.push({ channel, payload }),
    },
  };
}

function trackService(service) {
  services.push(service);
  return service;
}

async function waitFor(predicate, { timeout = 5000, interval = 40 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  for (;;) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      throw lastError ?? new Error("waitFor timed out before predicate was satisfied");
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "puppyone-git-meta-"));
});

afterEach(async () => {
  for (const service of services.splice(0)) {
    service.closeAll();
  }
  await rm(root, { recursive: true, force: true });
});

describe("resolveGitRepositoryIdentity", { timeout: 30_000 }, () => {
  it("returns absolute worktree, git-dir, and common-dir for a repository", async () => {
    initRepoWithIdentity();
    const identity = await resolveGitRepositoryIdentity(root);
    expect(identity.repository).toBe(true);
    expect(path.isAbsolute(identity.gitDir)).toBe(true);
    expect(path.isAbsolute(identity.commonDir)).toBe(true);
    expect(identity.topLevel).toBe(await import("node:fs/promises").then((m) => m.realpath(root)));
  });

  it("reports repository=false for a non-repository folder", async () => {
    const identity = await resolveGitRepositoryIdentity(root);
    expect(identity.repository).toBe(false);
  });
});

describe("git metadata watch service", { timeout: 30_000 }, () => {
  it("invalidates Git immediately after a renderer-owned working-tree write", async () => {
    initRepoWithIdentity();
    await writeFile(path.join(root, "tracked.txt"), "one\n");
    git(["add", "tracked.txt"]);
    git(["commit", "-m", "initial commit"]);

    const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
    const { events, sender } = createRecordingSender(40);
    const subscription = await service.start(sender, root);
    const baseline = events.length;

    expect(service.invalidateWorkingTree(root)).toBe(1);
    expect(events).toHaveLength(baseline + 1);
    expect(events.at(-1)).toMatchObject({
      channel: GIT_REPOSITORY_INVALIDATED_CHANNEL,
      payload: {
        subscriptionId: subscription.subscriptionId,
        reason: "working-tree",
      },
    });

    service.stop(subscription.subscriptionId);
  });

  it("delivers a metadata invalidation and converges to a clean snapshot with a new HEAD after an external add + commit", async () => {
    initRepoWithIdentity();
    await writeFile(path.join(root, "tracked.txt"), "one\n");
    git(["add", "tracked.txt"]);
    git(["commit", "-m", "initial commit"]);
    const originalHead = git(["rev-parse", "HEAD"]);

    const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
    const { events, sender } = createRecordingSender(1);
    const subscription = await service.start(sender, root);
    expect(subscription.repository).toBe(true);
    expect(typeof subscription.subscriptionId).toBe("string");

    // 1. External edit to a tracked file → repository is dirty.
    await writeFile(path.join(root, "tracked.txt"), "one\ntwo\n");
    await waitFor(async () => {
      const status = await getWorkspaceGitStatus(root);
      return status.unstagedEntries.some((entry) => entry.path === "tracked.txt");
    });

    // 2. External stage → index metadata event.
    git(["add", "tracked.txt"]);
    // 3. External commit → HEAD/refs metadata event and a fresh HEAD.
    git(["commit", "-m", "external commit"]);

    // The metadata watcher must have delivered at least one invalidation.
    await waitFor(() => events.some((event) => event.channel === GIT_REPOSITORY_INVALIDATED_CHANNEL));
    const invalidation = events.find((event) => event.channel === GIT_REPOSITORY_INVALIDATED_CHANNEL);
    expect(invalidation.payload.subscriptionId).toBe(subscription.subscriptionId);
    expect(invalidation.payload.rootPath).toBeTruthy();
    expect(typeof invalidation.payload.reason).toBe("string");

    // The fast status reader eventually reflects repository truth: clean tree,
    // new HEAD commit.
    const finalHead = git(["rev-parse", "HEAD"]);
    expect(finalHead).not.toBe(originalHead);
    await waitFor(async () => {
      const status = await getWorkspaceGitStatus(root);
      return status.entries.length === 0 && status.headCommitId === finalHead;
    });

    service.stop(subscription.subscriptionId);
    expect(service.getWatcherCount()).toBe(0);
  });

  it("reference-counts one watcher per repository identity and cleans up by subscription id", async () => {
    initRepoWithIdentity();
    await writeFile(path.join(root, "a.txt"), "a\n");
    git(["add", "a.txt"]);
    git(["commit", "-m", "init"]);

    const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
    const first = createRecordingSender(1);
    const second = createRecordingSender(2);
    const subA = await service.start(first.sender, root);
    const subB = await service.start(second.sender, root);

    expect(subA.subscriptionId).not.toBe(subB.subscriptionId);
    expect(service.getWatcherCount()).toBe(1);

    service.stop(subA.subscriptionId);
    expect(service.getWatcherCount()).toBe(1);
    service.stop(subB.subscriptionId);
    expect(service.getWatcherCount()).toBe(0);
  });

  it("re-arms and keeps reporting after a ref-only update (branch switch on identical trees)", async () => {
    initRepoWithIdentity();
    await writeFile(path.join(root, "a.txt"), "a\n");
    git(["add", "a.txt"]);
    git(["commit", "-m", "init"]);

    const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
    const { events, sender } = createRecordingSender(3);
    const subscription = await service.start(sender, root);
    const baseline = events.length;

    git(["checkout", "-b", "feature"]);

    await waitFor(() => events.length > baseline
      && events.some((event) => event.channel === GIT_REPOSITORY_INVALIDATED_CHANNEL));

    const status = await getWorkspaceGitStatus(root);
    expect(status.branch).toBe("feature");
    service.stop(subscription.subscriptionId);
  });

  it("invalidates on external stage/unstage without another working-tree edit", async () => {
    initRepoWithIdentity();
    await writeFile(path.join(root, "tracked.txt"), "one\n");
    git(["add", "tracked.txt"]);
    git(["commit", "-m", "init"]);
    await writeFile(path.join(root, "tracked.txt"), "one\ntwo\n");

    const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
    const { events, sender } = createRecordingSender(4);
    const subscription = await service.start(sender, root);
    const baseline = events.length;

    git(["add", "tracked.txt"]);
    await waitFor(
      () => events.length > baseline
        && events.some((event) => event.channel === GIT_REPOSITORY_INVALIDATED_CHANNEL),
      { timeout: 8000 },
    );
    await waitFor(async () => {
      const status = await getWorkspaceGitStatus(root);
      return status.stagedEntries.some((entry) => entry.path === "tracked.txt");
    }, { timeout: 8000 });

    const afterStage = events.length;
    git(["reset", "HEAD", "--", "tracked.txt"]);
    await waitFor(
      () => events.length > afterStage
        && events.some((event, index) => index >= afterStage && event.channel === GIT_REPOSITORY_INVALIDATED_CHANNEL),
      { timeout: 8000 },
    );
    await waitFor(async () => {
      const status = await getWorkspaceGitStatus(root);
      return status.unstagedEntries.some((entry) => entry.path === "tracked.txt")
        && status.stagedEntries.length === 0;
    }, { timeout: 8000 });

    service.stop(subscription.subscriptionId);
  }, 20000);

  it("invalidates on external reset --soft", async () => {
    initRepoWithIdentity();
    await writeFile(path.join(root, "tracked.txt"), "one\n");
    git(["add", "tracked.txt"]);
    git(["commit", "-m", "first"]);
    await writeFile(path.join(root, "tracked.txt"), "two\n");
    git(["add", "tracked.txt"]);
    git(["commit", "-m", "second"]);
    const headBefore = git(["rev-parse", "HEAD"]);

    const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
    const { events, sender } = createRecordingSender(5);
    const subscription = await service.start(sender, root);
    const baseline = events.length;

    git(["reset", "--soft", "HEAD~1"]);
    await waitFor(() => events.length > baseline);
    await waitFor(async () => {
      const status = await getWorkspaceGitStatus(root);
      return status.headCommitId !== headBefore
        && status.stagedEntries.some((entry) => entry.path === "tracked.txt");
    });

    service.stop(subscription.subscriptionId);
  });

  it("promotes a pending non-repo subscription after git init", async () => {
    const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
    const { events, sender } = createRecordingSender(6);
    const subscription = await service.start(sender, root);
    expect(subscription.repository).toBe(false);
    expect(service.getPendingRootCount()).toBe(1);
    expect(service.getWatcherCount()).toBe(0);

    initRepoWithIdentity();
    await writeFile(path.join(root, "seed.txt"), "seed\n");
    git(["add", "seed.txt"]);
    git(["commit", "-m", "init"]);

    // Force promotion in case the OS watcher coalesces the .git creation burst.
    await service.promotePendingRootForTests(root, "repository-initialized");

    await waitFor(() => service.getWatcherCount() === 1 && service.getPendingRootCount() === 0);
    await waitFor(() => events.some((event) => (
      event.channel === GIT_REPOSITORY_INVALIDATED_CHANNEL
      && event.payload.reason === "repository-initialized"
    )));

    const status = await getWorkspaceGitStatus(root);
    expect(status.isRepo).toBe(true);
    service.stop(subscription.subscriptionId);
    expect(service.getWatcherCount()).toBe(0);
  });

  it("rechecks repository identity after arming a pending root watcher", async () => {
    initRepoWithIdentity();
    let identityReads = 0;
    const service = trackService(createGitMetadataWatchService({
      logger: silentLogger(),
      resolveIdentity: async (rootPath) => {
        identityReads += 1;
        if (identityReads === 1) {
          return {
            repository: false,
            workspaceRoot: path.resolve(rootPath),
            topLevel: null,
            gitDir: null,
            commonDir: null,
          };
        }
        return resolveGitRepositoryIdentity(rootPath);
      },
    }));
    const { events, sender } = createRecordingSender(16);

    const subscription = await service.start(sender, root);
    expect(subscription.repository).toBe(false);

    await waitFor(() => service.getWatcherCount() === 1 && service.getPendingRootCount() === 0);
    expect(identityReads).toBeGreaterThanOrEqual(2);
    expect(events.some((event) => (
      event.channel === GIT_REPOSITORY_INVALIDATED_CHANNEL
      && event.payload.reason === "repository-initialized"
    ))).toBe(true);

    service.stop(subscription.subscriptionId);
  });

  it("invalidates linked worktrees when shared common-dir refs change", async () => {
    initRepoWithIdentity();
    await writeFile(path.join(root, "a.txt"), "a\n");
    git(["add", "a.txt"]);
    git(["commit", "-m", "init"]);
    git(["branch", "shared-base"]);

    const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), "puppyone-git-wt-"));
    try {
      execFileSync("git", ["-C", root, "worktree", "add", worktreeRoot, "-b", "linked-feature"]);
      const mainIdentity = await resolveGitRepositoryIdentity(root);
      const linkedIdentity = await resolveGitRepositoryIdentity(worktreeRoot);
      expect(mainIdentity.commonDir).toBe(linkedIdentity.commonDir);
      expect(mainIdentity.gitDir).not.toBe(linkedIdentity.gitDir);

      const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
      const main = createRecordingSender(7);
      const linked = createRecordingSender(8);
      const mainSub = await service.start(main.sender, root);
      const linkedSub = await service.start(linked.sender, worktreeRoot);
      expect(service.getWatcherCount()).toBe(2);

      const mainBaseline = main.events.length;
      const linkedBaseline = linked.events.length;
      execFileSync("git", ["-C", root, "update-ref", "refs/remotes/origin/shared-base", "HEAD"]);

      await waitFor(() => main.events.length > mainBaseline);
      await waitFor(() => linked.events.length > linkedBaseline);
      expect(main.events.some((event) => event.payload.subscriptionId === mainSub.subscriptionId)).toBe(true);
      expect(linked.events.some((event) => event.payload.subscriptionId === linkedSub.subscriptionId)).toBe(true);

      service.stop(mainSub.subscriptionId);
      service.stop(linkedSub.subscriptionId);
    } finally {
      execFileSync("git", ["-C", root, "worktree", "remove", "--force", worktreeRoot], { stdio: "ignore" });
      await rm(worktreeRoot, { recursive: true, force: true });
    }
  });

  it("invalidates on packed-refs and nested branch names", async () => {
    initRepoWithIdentity();
    await writeFile(path.join(root, "a.txt"), "a\n");
    git(["add", "a.txt"]);
    git(["commit", "-m", "init"]);
    git(["branch", "feature/nested/name"]);

    const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
    const { events, sender } = createRecordingSender(9);
    const subscription = await service.start(sender, root);
    const baseline = events.length;

    git(["pack-refs", "--all"]);
    await waitFor(() => events.length > baseline, { timeout: 8000 });

    const afterPack = events.length;
    git(["update-ref", "refs/heads/feature/nested/name", "HEAD"]);
    await waitFor(() => events.length > afterPack, { timeout: 8000 });

    const status = await getWorkspaceGitStatus(root);
    expect(status.branches.some((branch) => branch.name === "feature/nested/name")).toBe(true);
    service.stop(subscription.subscriptionId);
  });

  it("invalidates on merge/rebase/cherry-pick state files and config changes", async () => {
    initRepoWithIdentity();
    const baseBranch = git(["branch", "--show-current"]) || "master";
    await writeFile(path.join(root, "a.txt"), "one\n");
    git(["add", "a.txt"]);
    git(["commit", "-m", "first"]);
    git(["checkout", "-b", "topic"]);
    await writeFile(path.join(root, "a.txt"), "topic\n");
    git(["add", "a.txt"]);
    git(["commit", "-m", "topic"]);
    git(["checkout", baseBranch]);
    await writeFile(path.join(root, "a.txt"), "mainline\n");
    git(["add", "a.txt"]);
    git(["commit", "-m", "mainline"]);

    const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
    const { events, sender } = createRecordingSender(10);
    const subscription = await service.start(sender, root);
    let baseline = events.length;

    try {
      git(["merge", "--no-ff", "--no-commit", "topic"]);
    } catch {
      // Conflict is acceptable; MERGE_HEAD should still exist.
    }
    await waitFor(() => events.length > baseline, { timeout: 8000 });
    try {
      git(["merge", "--abort"]);
    } catch {
      git(["reset", "--hard", "HEAD"]);
    }

    baseline = events.length;
    git(["config", "remote.origin.url", "https://example.com/repo.git"]);
    await waitFor(() => events.length > baseline, { timeout: 8000 });

    service.stop(subscription.subscriptionId);
  });

  it("invalidates after updating a remote-tracking ref (fetch-like)", async () => {
    initRepoWithIdentity();
    await writeFile(path.join(root, "a.txt"), "a\n");
    git(["add", "a.txt"]);
    git(["commit", "-m", "init"]);

    const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
    const { events, sender } = createRecordingSender(11);
    const subscription = await service.start(sender, root);
    const baseline = events.length;

    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await waitFor(() => events.length > baseline);
    const status = await getWorkspaceGitStatus(root);
    expect(status.branches.some((branch) => branch.name === "origin/main" || branch.name.endsWith("/main"))).toBe(true);
    service.stop(subscription.subscriptionId);
  });

  it("keeps the newer subscription when an older stop races (Strict Mode semantics)", async () => {
    initRepoWithIdentity();
    await writeFile(path.join(root, "a.txt"), "a\n");
    git(["add", "a.txt"]);
    git(["commit", "-m", "init"]);

    const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
    const first = createRecordingSender(12);
    const second = createRecordingSender(12); // same webContents id, new subscription
    const oldSub = await service.start(first.sender, root);
    const newSub = await service.start(second.sender, root);
    expect(service.getWatcherCount()).toBe(1);

    // Stale Strict Mode cleanup stops only the old token.
    service.stop(oldSub.subscriptionId);
    expect(service.getWatcherCount()).toBe(1);

    const baseline = second.events.length;
    git(["checkout", "-b", "strict-mode-branch"]);
    await waitFor(() => second.events.length > baseline);
    expect(second.events.some((event) => event.payload.subscriptionId === newSub.subscriptionId)).toBe(true);

    service.stop(newSub.subscriptionId);
    expect(service.getWatcherCount()).toBe(0);
  });

  it("re-arms after a recoverable watcher failure and keeps delivering events", async () => {
    initRepoWithIdentity();
    await writeFile(path.join(root, "a.txt"), "a\n");
    git(["add", "a.txt"]);
    git(["commit", "-m", "init"]);

    const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
    const { events, sender } = createRecordingSender(13);
    const subscription = await service.start(sender, root);
    expect(service.getWatcherCount()).toBe(1);

    const forced = service.forceRearmForTests(root, "watcher-error");
    expect(forced).toBe(true);
    await waitFor(() => events.some((event) => event.payload?.reason === "watcher-error"), {
      timeout: 8000,
    });

    const baseline = events.length;
    git(["checkout", "-b", "after-rearm"]);
    await waitFor(() => events.length > baseline, { timeout: 8000 });
    const status = await getWorkspaceGitStatus(root);
    expect(status.branch).toBe("after-rearm");
    service.stop(subscription.subscriptionId);
  });

  it("invalidates on cherry-pick and rebase state files", async () => {
    initRepoWithIdentity();
    const baseBranch = git(["branch", "--show-current"]) || "master";
    await writeFile(path.join(root, "a.txt"), "one\n");
    git(["add", "a.txt"]);
    git(["commit", "-m", "first"]);
    git(["checkout", "-b", "topic"]);
    await writeFile(path.join(root, "a.txt"), "topic\n");
    git(["add", "a.txt"]);
    git(["commit", "-m", "topic"]);
    const topicHead = git(["rev-parse", "HEAD"]);
    git(["checkout", baseBranch]);

    const service = trackService(createGitMetadataWatchService({ logger: silentLogger() }));
    const { events, sender } = createRecordingSender(14);
    const subscription = await service.start(sender, root);

    let baseline = events.length;
    try {
      git(["cherry-pick", "--no-commit", topicHead]);
    } catch {
      // Conflict still creates CHERRY_PICK_HEAD.
    }
    await waitFor(() => events.length > baseline, { timeout: 8000 });
    try {
      git(["cherry-pick", "--abort"]);
    } catch {
      git(["reset", "--hard", "HEAD"]);
    }

    baseline = events.length;
    try {
      git(["rebase", "topic"]);
    } catch {
      // Conflict still creates rebase-merge / rebase-apply state.
    }
    await waitFor(() => events.length > baseline, { timeout: 8000 });
    try {
      git(["rebase", "--abort"]);
    } catch {
      git(["reset", "--hard", "HEAD"]);
    }

    service.stop(subscription.subscriptionId);
  });
});

describe("background optional locks", { timeout: 30_000 }, () => {
  it("applies GIT_OPTIONAL_LOCKS=0 only for read-only status queries", async () => {
    const { getGitEnvironmentForTests } = await import("../../../../local-api/workspace.mjs");
    expect(getGitEnvironmentForTests({ optionalLocks: false }).GIT_OPTIONAL_LOCKS).toBe("0");
    expect(getGitEnvironmentForTests({}).GIT_OPTIONAL_LOCKS).toBeUndefined();
    expect(getGitEnvironmentForTests({ optionalLocks: true }).GIT_OPTIONAL_LOCKS).toBeUndefined();
  });
});

function silentLogger() {
  return { warn: () => {}, info: () => {}, error: () => {} };
}
