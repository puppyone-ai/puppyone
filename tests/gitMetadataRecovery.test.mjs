import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";
import {
  GIT_METADATA_REARM_MIN_DELAY_MS,
  createGitMetadataWatchService,
} from "../electron/main/git-metadata-watch-service.mjs";

function createFakeFs() {
  const watchCalls = [];
  const fsModule = {
    existsSync: () => true,
    realpathSync: (value) => value,
    watch(dir, options, listener) {
      const watcher = new EventEmitter();
      watcher.close = vi.fn(() => {
        watcher.closed = true;
      });
      watcher._listener = listener;
      watchCalls.push({ dir, options, watcher, listener });
      return watcher;
    },
  };
  return { fsModule, watchCalls };
}

function createSender(id = 1) {
  return {
    id,
    isDestroyed: () => false,
    once: () => {},
    send: () => {},
  };
}

async function flush() {
  for (let index = 0; index < 16; index += 1) {
    await Promise.resolve();
  }
}

function nonRepo(root) {
  return {
    repository: false,
    workspaceRoot: root,
    topLevel: null,
    gitDir: null,
    commonDir: null,
  };
}

function repo(root) {
  return {
    repository: true,
    workspaceRoot: root,
    topLevel: root,
    gitDir: path.join(root, ".git"),
    commonDir: path.join(root, ".git"),
  };
}

describe("git metadata watch recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("detaches renderer lifecycle listeners when subscriptions stop", async () => {
    const { fsModule } = createFakeFs();
    const root = "/pending-root";
    const service = createGitMetadataWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
      resolveIdentity: async () => nonRepo(root),
    });
    const sender = new EventEmitter();
    Object.assign(sender, {
      id: 9,
      isDestroyed: () => false,
      send: () => {},
    });

    for (let index = 0; index < 12; index += 1) {
      const subscription = await service.start(sender, root);
      expect(sender.listenerCount("destroyed")).toBe(1);
      service.stop(subscription.subscriptionId);
      expect(sender.listenerCount("destroyed")).toBe(0);
    }

    service.closeAll();
  });

  it("recreates a shared common-dir watcher after error instead of reusing the dead handle", async () => {
    vi.useFakeTimers();
    const { fsModule, watchCalls } = createFakeFs();
    const commonDir = "/repo/.git";
    const identityA = {
      repository: true,
      workspaceRoot: "/wt-a",
      topLevel: "/wt-a",
      gitDir: "/wt-a/.git",
      commonDir,
    };
    const identityB = {
      repository: true,
      workspaceRoot: "/wt-b",
      topLevel: "/wt-b",
      gitDir: "/wt-b/.git",
      commonDir,
    };

    const service = createGitMetadataWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
      resolveIdentity: async (rootPath) => (
        String(rootPath).includes("wt-b") ? identityB : identityA
      ),
    });

    await service.start(createSender(1), "/wt-a");
    await service.start(createSender(2), "/wt-b");

    const commonWatchersBefore = watchCalls.filter((entry) => entry.dir === commonDir);
    expect(commonWatchersBefore.length).toBe(1);
    const beforeCount = watchCalls.length;

    commonWatchersBefore[0].watcher.emit("error", new Error("common watch failed"));
    await vi.advanceTimersByTimeAsync(GIT_METADATA_REARM_MIN_DELAY_MS + 10);

    const commonWatchersAfter = watchCalls.filter((entry) => entry.dir === commonDir);
    expect(commonWatchersAfter.length).toBeGreaterThan(1);
    expect(commonWatchersBefore[0].watcher.close).toHaveBeenCalled();
    expect(watchCalls.length).toBeGreaterThan(beforeCount);

    service.closeAll();
  });

  it("rechecks pending promotion when a later .git event arrives during identity resolve", async () => {
    const deferred = [];
    const resolveIdentity = vi.fn((rootPath) => new Promise((resolve) => {
      deferred.push({ rootPath, resolve });
    }));
    const { fsModule, watchCalls } = createFakeFs();
    const service = createGitMetadataWatchService({
      logger: { warn: () => {}, info: () => {} },
      fsModule,
      resolveIdentity,
    });

    const root = "/pending-root";
    const startPromise = service.start(createSender(4), root);
    await flush();
    expect(deferred).toHaveLength(1);

    // Finish start() as a non-repository. start() then arms a pending watcher
    // and kicks an immediate promotePendingRoot identity check.
    deferred[0].resolve(nonRepo(root));
    const subscription = await startPromise;
    expect(subscription.repository).toBe(false);
    await flush();
    expect(deferred.length).toBeGreaterThanOrEqual(2);
    const promoteInFlight = deferred[1];

    const pendingWatcher = watchCalls.find((entry) => entry.dir === root);
    expect(pendingWatcher).toBeTruthy();

    // Second .git event while promote identity is still outstanding.
    pendingWatcher.listener("rename", ".git");
    await flush();
    expect(deferred).toHaveLength(2);

    // In-flight promote still says non-repo; dirty trailing must re-check.
    promoteInFlight.resolve(nonRepo(root));
    await flush();
    expect(deferred.length).toBeGreaterThanOrEqual(3);

    deferred[2].resolve(repo(root));
    await flush();

    expect(service.getPendingRootCount()).toBe(0);
    expect(service.getWatcherCount()).toBe(1);
    expect(resolveIdentity.mock.calls.length).toBeGreaterThanOrEqual(3);
    service.closeAll();
  });
});
