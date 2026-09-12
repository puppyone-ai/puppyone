import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createGitAutoCommitService,
  isGitAutoCommitEffectivelyEnabled,
} from "../../../../electron/main/git-auto-commit/service.mjs";

const root = path.resolve("/workspace/project");
const identity = Object.freeze({
  repository: true,
  workspaceRoot: root,
  topLevel: root,
  gitDir: path.join(root, ".git"),
  commonDir: path.join(root, ".git"),
});
const policy = Object.freeze({
  enabled: true,
  scope: "untracked-only",
  minimumIntervalMs: 300_000,
  quietPeriodMs: 60_000,
  updatedAt: null,
});

describe("Git Auto Commit main-process service", () => {
  it("requires every release, user, workspace, and repository gate", () => {
    for (const releaseAvailable of [false, true]) {
      for (const experimentalOptIn of [false, true]) {
        for (const workspaceEnabled of [false, true]) {
          for (const repository of [false, true]) {
            expect(isGitAutoCommitEffectivelyEnabled({
              releaseAvailable,
              experimentalOptIn,
              workspaceEnabled,
              repository,
            })).toBe(releaseAvailable && experimentalOptIn && workspaceEnabled && repository);
          }
        }
      }
    }
  });

  it("drains documents and workspace writes before entering the Git transaction", async () => {
    const harness = createHarness();
    await harness.service.assignWorkspace(harness.webContents, root);
    harness.order.length = 0;

    await harness.clock.advance(300_000);
    await flushMicrotasks();

    expect(harness.runTransaction).toHaveBeenCalledOnce();
    expect(harness.order).toEqual(["document-drain", "workspace-idle", "lease", "recover", "transaction"]);
    const transactionOptions = harness.runTransaction.mock.calls[0][1];
    expect(transactionOptions.contentEpoch).toBe(4);
    expect(transactionOptions.isContentEpochCurrent(4)).toBe(true);
    expect(harness.gitMetadataWatchService.invalidateWorkingTree).toHaveBeenCalledWith(root);
  });

  it("recovers journals but never schedules a transaction when the release gate is off", async () => {
    const harness = createHarness({ releaseAvailable: false, pendingJournal: true });
    await harness.service.assignWorkspace(harness.webContents, root);
    expect(harness.recoverTransaction).toHaveBeenCalledOnce();
    expect(harness.workspaceWatchService.subscribeActivity).not.toHaveBeenCalled();

    harness.activity();
    await harness.clock.advance(600_000);
    await flushMicrotasks();
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  it("does not acquire Git ownership or activity ports while opted out with no recovery work", async () => {
    const harness = createHarness({ experimentalOptIn: false });
    await harness.service.assignWorkspace(harness.webContents, root);

    expect(harness.recoverTransaction).not.toHaveBeenCalled();
    expect(harness.operationLease.acquire).not.toHaveBeenCalled();
    expect(harness.gitOperationCoordinator.runAll).not.toHaveBeenCalled();
    expect(harness.gitOperationCoordinator.tryRunAll).not.toHaveBeenCalled();
    expect(harness.workspaceWatchService.subscribeActivity).not.toHaveBeenCalled();
  });

  it("skips instead of queueing behind an interactive Git owner", async () => {
    const harness = createHarness({ gitBusy: true });
    await harness.service.assignWorkspace(harness.webContents, root);
    await harness.clock.advance(300_000);
    await flushMicrotasks();

    expect(harness.runTransaction).not.toHaveBeenCalled();
    const lastSnapshot = harness.webContents.send.mock.calls.at(-1)?.[1];
    expect(lastSnapshot.runtime.lastResult).toMatchObject({
      outcome: "skipped",
      reason: "git-busy",
      retryable: true,
    });
  });

  it("skips safely when another Desktop process owns the repository lease", async () => {
    const harness = createHarness({ crossProcessBusy: true });
    await harness.service.assignWorkspace(harness.webContents, root);
    harness.runTransaction.mockClear();

    await harness.clock.advance(300_000);
    await flushMicrotasks();

    expect(harness.runTransaction).not.toHaveBeenCalled();
    expect(harness.webContents.send.mock.calls.at(-1)?.[1].runtime.lastResult).toMatchObject({
      outcome: "skipped",
      reason: "cross-process-busy",
      retryable: true,
    });
  });

  it("cancels a waiting workspace when its window releases ownership", async () => {
    const harness = createHarness();
    await harness.service.assignWorkspace(harness.webContents, root);
    harness.service.releaseWindow(harness.webContents.id);

    await harness.clock.advance(600_000);
    await flushMicrotasks();
    expect(harness.runTransaction).not.toHaveBeenCalled();
    expect(harness.stopActivity).toHaveBeenCalledOnce();
  });

  it("subscribes to workspace activity only while every consent gate is enabled", async () => {
    const harness = createHarness({ experimentalOptIn: false, pendingJournal: true });
    await harness.service.assignWorkspace(harness.webContents, root);

    expect(harness.recoverTransaction).toHaveBeenCalledOnce();
    expect(harness.workspaceWatchService.subscribeActivity).not.toHaveBeenCalled();

    await harness.service.setExperimentalOptIn(true);
    expect(harness.workspaceWatchService.subscribeActivity).toHaveBeenCalledOnce();

    await harness.service.setExperimentalOptIn(false);
    expect(harness.stopActivity).toHaveBeenCalledOnce();
    harness.activity();
    await harness.clock.advance(600_000);
    expect(harness.runTransaction).not.toHaveBeenCalled();
  });

  it("activates and disposes the optional activity port with workspace policy changes", async () => {
    const harness = createHarness({ workspaceEnabled: false });
    await harness.service.assignWorkspace(harness.webContents, root);
    expect(harness.workspaceWatchService.subscribeActivity).not.toHaveBeenCalled();

    const enabled = await harness.service.setWorkspacePolicy(root, {
      enabled: true,
      minimumIntervalMs: 900_000,
    });
    expect(enabled).toMatchObject({ effectiveEnabled: true });
    expect(harness.preferenceStore.setWorkspacePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceRoot: root }),
      { enabled: true, minimumIntervalMs: 900_000 },
    );
    expect(harness.workspaceWatchService.subscribeActivity).toHaveBeenCalledOnce();

    await harness.service.setWorkspacePolicy(root, { enabled: false });
    expect(harness.stopActivity).toHaveBeenCalledOnce();
  });

  it("reports a non-repository snapshot without attaching optional runtime ports", async () => {
    const harness = createHarness({ repositoryAvailable: false });
    await harness.service.assignWorkspace(harness.webContents, root);

    await expect(harness.service.getSnapshot(root)).resolves.toMatchObject({
      available: true,
      repository: false,
      effectiveEnabled: false,
    });
    expect(harness.recoverTransaction).not.toHaveBeenCalled();
    expect(harness.workspaceWatchService.subscribeActivity).not.toHaveBeenCalled();
  });

  it.each(["conflict", "timeout", "renderer-unavailable"])(
    "keeps Git untouched when the document durability barrier reports %s",
    async (kind) => {
      const harness = createHarness({ drainResult: { ok: false, kind } });
      await harness.service.assignWorkspace(harness.webContents, root);
      harness.runTransaction.mockClear();

      await harness.clock.advance(300_000);
      await flushMicrotasks();

      expect(harness.runTransaction).not.toHaveBeenCalled();
      expect(harness.webContents.send.mock.calls.at(-1)?.[1].runtime.lastResult).toMatchObject({
        outcome: "skipped",
        reason: `document-${kind}`,
        retryable: true,
      });
    },
  );

  it("retries without entering Git while a Main-owned workspace write is active", async () => {
    const harness = createHarness({ workspaceIdle: false });
    await harness.service.assignWorkspace(harness.webContents, root);
    harness.runTransaction.mockClear();

    await harness.clock.advance(300_000);
    await flushMicrotasks();

    expect(harness.runTransaction).not.toHaveBeenCalled();
    expect(harness.workspaceMutationTracker.capture).toHaveBeenCalledWith(root);
  });

  it("reconciles eligible work on window focus without depending on a Renderer view", async () => {
    const harness = createHarness();
    await harness.service.assignWorkspace(harness.webContents, root);
    await harness.clock.advance(300_000);
    harness.runTransaction.mockClear();

    harness.service.reconcileWindow(harness.webContents.id);
    await harness.clock.advance(299_999);
    expect(harness.runTransaction).not.toHaveBeenCalled();
    await harness.clock.advance(1);
    expect(harness.runTransaction).toHaveBeenCalledOnce();
  });

  it("keeps two workspace runtimes isolated when one owning window closes", async () => {
    const harness = createHarness();
    const secondRoot = path.resolve("/workspace/second");
    const secondWindow = { id: 42, isDestroyed: () => false, send: vi.fn() };
    await harness.service.assignWorkspace(harness.webContents, root);
    await harness.service.assignWorkspace(secondWindow, secondRoot);
    harness.runTransaction.mockClear();

    harness.service.releaseWindow(harness.webContents.id);
    await harness.clock.advance(300_000);
    await flushMicrotasks();

    expect(harness.runTransaction).toHaveBeenCalledOnce();
    expect(harness.runTransaction.mock.calls[0][0]).toBe(secondRoot);
  });

  it("discards stale recovery results across an A to B workspace generation change", async () => {
    let finishFirstRecovery;
    const firstRecovery = new Promise((resolve) => { finishFirstRecovery = resolve; });
    const secondRoot = path.resolve("/workspace/second");
    const harness = createHarness({
      pendingJournal: true,
      recoverTransactionImplementation: async (runtimeRoot) => (
        runtimeRoot === root
          ? firstRecovery
          : { outcome: "no-op", reason: "no-pending-transaction", retryable: false }
      ),
    });

    const assigningFirst = harness.service.assignWorkspace(harness.webContents, root);
    await flushMicrotasks();
    await harness.service.assignWorkspace(harness.webContents, secondRoot);
    finishFirstRecovery({
      outcome: "committed",
      reason: "recovered-committed-transaction",
      commitId: "b".repeat(40),
      pathCount: 1,
      retryable: false,
    });
    await assigningFirst;

    expect(harness.gitMetadataWatchService.invalidateWorkingTree).not.toHaveBeenCalledWith(root);
    expect(harness.webContents.send.mock.calls.every(([, snapshot]) => (
      snapshot.runtime?.lastResult?.commitId !== "b".repeat(40)
    ))).toBe(true);
  });
});

function createHarness({
  releaseAvailable = true,
  gitBusy = false,
  experimentalOptIn = true,
  workspaceEnabled = true,
  drainResult = { ok: true, kind: null },
  crossProcessBusy = false,
  recoverTransactionImplementation = null,
  repositoryAvailable = true,
  workspaceIdle = true,
  pendingJournal = false,
} = {}) {
  const order = [];
  const clock = createFakeClock();
  let currentExperimentalOptIn = experimentalOptIn;
  let currentPolicy = { ...policy, enabled: workspaceEnabled };
  const preferenceStore = {
    getSnapshot: vi.fn(async () => ({
      experimentalOptIn: currentExperimentalOptIn,
      workspacePolicy: currentPolicy,
    })),
    setExperimentalOptIn: vi.fn(async (enabled) => {
      currentExperimentalOptIn = enabled === true;
    }),
    setWorkspacePolicy: vi.fn(async (_identity, patch) => {
      currentPolicy = { ...currentPolicy, ...patch };
    }),
  };
  const recoverTransaction = vi.fn(async (...args) => {
    order.push("recover");
    if (recoverTransactionImplementation) return recoverTransactionImplementation(...args);
    return { outcome: "no-op", reason: "no-pending-transaction", retryable: false };
  });
  const runTransaction = vi.fn(async () => {
    order.push("transaction");
    return {
      outcome: "committed",
      reason: "untracked-files-committed",
      commitId: "a".repeat(40),
      pathCount: 1,
      retryable: false,
    };
  });
  const activities = new Map();
  const stopActivity = vi.fn();
  const workspaceWatchService = {
    subscribeActivity: vi.fn((rootPath, listener) => {
      const key = path.resolve(rootPath);
      activities.set(key, listener);
      return () => {
        activities.delete(key);
        stopActivity(key);
      };
    }),
  };
  const workspaceMutationTracker = {
    noteActivity: vi.fn(),
    whenIdle: vi.fn(async () => { order.push("workspace-idle"); }),
    capture: vi.fn(() => ({ epoch: 4, idle: workspaceIdle })),
    isCurrentAndIdle: vi.fn((_rootPath, epoch) => epoch === 4),
    release: vi.fn(),
  };
  const gitOperationCoordinator = {
    runAll: vi.fn((_keys, operation) => operation()),
    tryRunAll: vi.fn((_keys, operation) => (gitBusy ? null : operation())),
  };
  const operationLease = {
    acquire: vi.fn(async () => {
      order.push("lease");
      return crossProcessBusy ? null : { release: vi.fn(async () => undefined) };
    }),
  };
  const documentDurabilityCoordinator = {
    requestFlush: vi.fn(async () => {
      order.push("document-drain");
      return drainResult;
    }),
  };
  const gitMetadataWatchService = { invalidateWorkingTree: vi.fn() };
  const webContents = {
    id: 41,
    isDestroyed: () => false,
    send: vi.fn(),
  };
  const service = createGitAutoCommitService({
    releaseAvailable,
    preferenceStore,
    transactionJournal: {
      read: vi.fn(async () => ({ record: pendingJournal ? { phase: "prepared" } : null })),
    },
    operationLease,
    gitOperationCoordinator,
    documentDurabilityCoordinator,
    workspaceMutationTracker,
    workspaceWatchService,
    gitMetadataWatchService,
    resolveRepositoryIdentity: vi.fn(async (rootPath) => {
      const workspaceRoot = path.resolve(rootPath);
      if (!repositoryAvailable) return { repository: false, workspaceRoot };
      return {
        ...identity,
        workspaceRoot,
        topLevel: workspaceRoot,
        gitDir: path.join(workspaceRoot, ".git"),
        commonDir: path.join(workspaceRoot, ".git"),
      };
    }),
    runTransaction,
    recoverTransaction,
    clock,
    logger: { warn: vi.fn() },
  });
  return {
    service,
    clock,
    order,
    activity: (rootPath = root) => activities.get(path.resolve(rootPath))?.(),
    stopActivity,
    workspaceWatchService,
    workspaceMutationTracker,
    preferenceStore,
    operationLease,
    gitOperationCoordinator,
    runTransaction,
    recoverTransaction,
    gitMetadataWatchService,
    webContents,
  };
}

function createFakeClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    monotonicNow: () => now,
    wallNow: () => 1_800_000_000_000 + now,
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].callback();
        await flushMicrotasks();
      }
      now = target;
      await flushMicrotasks();
    },
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
