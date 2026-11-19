import path from "node:path";
import {
  recoverWorkspaceGitAutoCommit,
  resolveGitRepositoryIdentity,
  runWorkspaceGitAutoCommit,
} from "../../local-api/workspace.mjs";
import { repositoryLockKey, worktreeLockKey } from "../git-operation-coordinator.mjs";
import { gitAutoCommitWorkspaceKey } from "./identity.mjs";
import { createGitAutoCommitDeadlineScheduler, createSystemClock } from "./deadline-scheduler.mjs";

export function createGitAutoCommitService({
  releaseAvailable = false,
  preferenceStore,
  transactionJournal,
  operationLease,
  gitOperationCoordinator,
  documentDurabilityCoordinator,
  workspaceMutationTracker,
  workspaceWatchService,
  gitMetadataWatchService = null,
  resolveRepositoryIdentity = resolveGitRepositoryIdentity,
  runTransaction = runWorkspaceGitAutoCommit,
  recoverTransaction = recoverWorkspaceGitAutoCommit,
  clock = createSystemClock(),
  logger = console,
} = {}) {
  requireDependency(preferenceStore, "preferenceStore");
  requireDependency(transactionJournal, "transactionJournal");
  requireDependency(operationLease, "operationLease");
  requireDependency(gitOperationCoordinator, "gitOperationCoordinator");
  requireDependency(documentDurabilityCoordinator, "documentDurabilityCoordinator");
  requireDependency(workspaceMutationTracker, "workspaceMutationTracker");
  requireDependency(workspaceWatchService, "workspaceWatchService");

  const runtimesByWindow = new Map();
  let generationSequence = 0;

  async function assignWorkspace(webContents, rootPath) {
    const windowId = requireWebContentsId(webContents);
    releaseWindow(windowId);
    const root = path.resolve(rootPath);
    const runtime = createRuntime({
      webContents,
      windowId,
      root,
      generation: ++generationSequence,
    });
    runtimesByWindow.set(windowId, runtime);

    await recoverRuntime(runtime);
    if (!isCurrent(runtime)) return;
    await refreshRuntimePolicy(runtime, { markDirty: true });
  }

  function releaseWindow(windowId) {
    const runtime = runtimesByWindow.get(windowId);
    if (!runtime) return;
    runtimesByWindow.delete(windowId);
    runtime.disposed = true;
    runtime.abortController.abort();
    runtime.scheduler.dispose();
    runtime.stopActivity?.();
    runtime.stopActivity = null;
    if (!runtime.activeTransaction) workspaceMutationTracker.release(runtime.root);
  }

  async function getSnapshot(rootPath = null) {
    const identity = rootPath ? await resolveRepositoryIdentity(rootPath) : null;
    const preferences = await preferenceStore.getSnapshot(identity?.repository ? identity : null);
    const runtime = rootPath ? findRuntimeByRoot(rootPath) : null;
    return buildSnapshot({ runtime, preferences, identity });
  }

  async function setExperimentalOptIn(enabled) {
    assertReleaseAvailable();
    await preferenceStore.setExperimentalOptIn(enabled === true);
    await Promise.all([...runtimesByWindow.values()].map((runtime) => (
      refreshRuntimePolicy(runtime, { markDirty: enabled === true })
    )));
    return getSnapshot();
  }

  async function setWorkspacePolicy(rootPath, patch) {
    assertReleaseAvailable();
    const identity = await resolveRepositoryIdentity(rootPath);
    if (!identity?.repository) throw new Error("Current workspace is not a Git repository.");
    await preferenceStore.setWorkspacePolicy(identity, patch);
    const matching = [...runtimesByWindow.values()].filter((runtime) => (
      path.resolve(runtime.root) === path.resolve(rootPath)
    ));
    await Promise.all(matching.map((runtime) => refreshRuntimePolicy(runtime, {
      markDirty: patch?.enabled === true,
    })));
    return getSnapshot(rootPath);
  }

  function reconcileAfterResume() {
    for (const runtime of runtimesByWindow.values()) runtime.scheduler.reconcileAfterResume();
  }

  function reconcileWindow(windowId) {
    const runtime = runtimesByWindow.get(windowId);
    if (runtime && !runtime.disposed) runtime.scheduler.markDirty();
  }

  function closeAll() {
    for (const windowId of [...runtimesByWindow.keys()]) releaseWindow(windowId);
  }

  function createRuntime({ webContents, windowId, root, generation }) {
    const runtime = {
      webContents,
      windowId,
      root,
      generation,
      disposed: false,
      stopActivity: null,
      identity: null,
      workspaceKey: null,
      preferences: null,
      lastResult: null,
      schedulerState: { state: "disabled", nextEligibleAt: null },
      activeTransaction: false,
      abortController: new AbortController(),
      scheduler: null,
    };
    runtime.scheduler = createGitAutoCommitDeadlineScheduler({
      clock,
      run: () => executeRuntime(runtime),
      onStateChange: (state) => {
        runtime.schedulerState = state;
        publish(runtime);
      },
    });
    return runtime;
  }

  async function refreshRuntimePolicy(runtime, { markDirty = false } = {}) {
    if (!isCurrent(runtime)) return;
    const identity = await resolveRepositoryIdentity(runtime.root);
    if (!isCurrent(runtime)) return;
    runtime.identity = identity?.repository ? identity : null;
    runtime.workspaceKey = identity?.repository ? gitAutoCommitWorkspaceKey(identity) : null;
    runtime.preferences = await preferenceStore.getSnapshot(runtime.identity);
    if (!isCurrent(runtime)) return;
    const effectiveEnabled = isGitAutoCommitEffectivelyEnabled({
      releaseAvailable,
      experimentalOptIn: runtime.preferences.experimentalOptIn,
      workspaceEnabled: runtime.preferences.workspacePolicy.enabled,
      repository: Boolean(runtime.identity),
    });
    runtime.scheduler.setPolicy(runtime.preferences.workspacePolicy, effectiveEnabled);
    reconcileActivitySubscription(runtime, effectiveEnabled);
    if (markDirty && effectiveEnabled) runtime.scheduler.markDirty();
    publish(runtime);
  }

  function reconcileActivitySubscription(runtime, effectiveEnabled) {
    if (!effectiveEnabled) {
      runtime.stopActivity?.();
      runtime.stopActivity = null;
      return;
    }
    if (runtime.stopActivity || !isCurrent(runtime)) return;
    runtime.stopActivity = workspaceWatchService.subscribeActivity(runtime.root, () => {
      if (!isCurrent(runtime) || !isEffectivelyEnabled(runtime)) return;
      workspaceMutationTracker.noteActivity(runtime.root);
      runtime.scheduler.markDirty();
    });
  }

  async function recoverRuntime(runtime) {
    const identity = await resolveRepositoryIdentity(runtime.root).catch(() => null);
    if (!identity?.repository || !isCurrent(runtime)) return;
    runtime.identity = identity;
    runtime.workspaceKey = gitAutoCommitWorkspaceKey(identity);
    const pending = await transactionJournal.read(runtime.root).catch(() => null);
    if (!isCurrent(runtime)) return;
    if (!pending) {
      settleResult(runtime, serviceResult("needs-review", "journal-invalid", false));
      return;
    }
    if (!pending.record) return;
    const result = await runWithMutationOwnership(runtime, identity, async () => (
      recoverTransaction(runtime.root, {
        identity,
        journal: transactionJournal,
        workspaceKey: runtime.workspaceKey,
      })
    ), { lowPriority: false });
    if (!isCurrent(runtime)) return;
    if (result && result.reason !== "no-pending-transaction") settleResult(runtime, result);
  }

  async function executeRuntime(runtime) {
    if (!isCurrent(runtime)) return serviceResult("skipped", "workspace-released", false);
    await refreshRuntimePolicy(runtime);
    if (!isEffectivelyEnabled(runtime)) return serviceResult("skipped", "feature-disabled", false);

    const drain = await documentDurabilityCoordinator.requestFlush(
      runtime.webContents,
      "git-auto-commit",
      { signal: runtime.abortController.signal },
    );
    if (!drain.ok) {
      const blocked = serviceResult("skipped", `document-${drain.kind ?? "persistence-failed"}`, true);
      settleResult(runtime, blocked);
      return blocked;
    }
    await workspaceMutationTracker.whenIdle(runtime.root, {
      signal: runtime.abortController.signal,
    }).catch(() => undefined);
    if (!isCurrent(runtime)) return serviceResult("skipped", "workspace-released", false);
    const content = workspaceMutationTracker.capture(runtime.root);
    if (!content.idle) return serviceResult("skipped", "workspace-write-active", true);

    const identity = await resolveRepositoryIdentity(runtime.root).catch(() => null);
    if (!identity?.repository) {
      const skipped = serviceResult("skipped", "repository-unavailable", true);
      settleResult(runtime, skipped);
      return skipped;
    }
    const workspaceKey = gitAutoCommitWorkspaceKey(identity);
    if (workspaceKey !== runtime.workspaceKey) {
      const skipped = serviceResult("skipped", "workspace-identity-changed", true);
      settleResult(runtime, skipped);
      return skipped;
    }

    const operation = runWithMutationOwnership(runtime, identity, async () => {
      const latest = await preferenceStore.getSnapshot(identity);
      if (!isGitAutoCommitEffectivelyEnabled({
        releaseAvailable,
        experimentalOptIn: latest.experimentalOptIn,
        workspaceEnabled: latest.workspacePolicy.enabled,
        repository: true,
      })) {
        return serviceResult("skipped", "feature-disabled", false);
      }
      const recovery = await recoverTransaction(runtime.root, {
        identity,
        journal: transactionJournal,
        workspaceKey,
      });
      if (recovery.outcome === "needs-review" || recovery.outcome === "committed") return recovery;
      return runTransaction(runtime.root, {
        identity,
        journal: transactionJournal,
        workspaceKey,
        contentEpoch: content.epoch,
        isContentEpochCurrent: (epoch) => (
          isCurrent(runtime) && workspaceMutationTracker.isCurrentAndIdle(runtime.root, epoch)
        ),
        isExecutionAllowed: async () => {
          if (!isCurrent(runtime) || !releaseAvailable) return false;
          const current = await preferenceStore.getSnapshot(identity);
          return isGitAutoCommitEffectivelyEnabled({
            releaseAvailable,
            experimentalOptIn: current.experimentalOptIn,
            workspaceEnabled: current.workspacePolicy.enabled,
            repository: true,
          });
        },
      });
    }, { lowPriority: true });
    if (!operation) {
      const busy = serviceResult("skipped", "git-busy", true);
      settleResult(runtime, busy);
      return busy;
    }
    const settled = await operation;
    settleResult(runtime, settled);
    return settled;
  }

  function runWithMutationOwnership(runtime, identity, operation, { lowPriority }) {
    const keys = [
      worktreeLockKey(path.resolve(runtime.root)),
      repositoryLockKey(identity.commonDir || identity.topLevel || runtime.root),
    ];
    const ownedOperation = async () => {
      runtime.activeTransaction = true;
      let lease = null;
      try {
        lease = await operationLease.acquire(identity);
        if (!lease) return serviceResult("skipped", "cross-process-busy", true);
        return await operation();
      } catch (error) {
        logger.warn?.("Git Auto Commit operation failed:", sanitizeError(error));
        return serviceResult("failed", "internal-error", true);
      } finally {
        await lease?.release().catch(() => undefined);
        runtime.activeTransaction = false;
        if (runtime.disposed) workspaceMutationTracker.release(runtime.root);
      }
    };
    return lowPriority
      ? gitOperationCoordinator.tryRunAll(keys, ownedOperation)
      : gitOperationCoordinator.runAll(keys, ownedOperation);
  }

  function settleResult(runtime, settled) {
    runtime.lastResult = Object.freeze({
      ...settled,
      workspaceGeneration: runtime.generation,
      occurredAt: new Date(clock.wallNow()).toISOString(),
    });
    if (settled?.outcome === "committed") {
      gitMetadataWatchService?.invalidateWorkingTree?.(runtime.root);
    }
    publish(runtime);
  }

  function publish(runtime) {
    if (!isCurrent(runtime) || runtime.webContents.isDestroyed?.()) return;
    try {
      runtime.webContents.send("git-auto-commit:state", buildSnapshot({ runtime }));
    } catch {
      // Window teardown owns cleanup; presentation delivery is best effort.
    }
  }

  function buildSnapshot({ runtime = null, preferences = null, identity = null } = {}) {
    const prefs = preferences ?? runtime?.preferences ?? {
      experimentalOptIn: false,
      workspacePolicy: null,
    };
    const repository = identity?.repository ?? Boolean(runtime?.identity);
    return Object.freeze({
      available: releaseAvailable,
      experimentalOptIn: prefs.experimentalOptIn === true,
      repository,
      workspacePolicy: prefs.workspacePolicy ?? null,
      effectiveEnabled: isGitAutoCommitEffectivelyEnabled({
        releaseAvailable,
        experimentalOptIn: prefs.experimentalOptIn,
        workspaceEnabled: prefs.workspacePolicy?.enabled,
        repository,
      }),
      runtime: runtime ? {
        state: runtime.schedulerState.state,
        nextEligibleAt: runtime.schedulerState.nextEligibleAt ?? null,
        lastResult: runtime.lastResult,
      } : null,
    });
  }

  function findRuntimeByRoot(rootPath) {
    const root = path.resolve(rootPath);
    return [...runtimesByWindow.values()].find((runtime) => runtime.root === root) ?? null;
  }

  function isEffectivelyEnabled(runtime) {
    return isGitAutoCommitEffectivelyEnabled({
      releaseAvailable,
      experimentalOptIn: runtime.preferences?.experimentalOptIn,
      workspaceEnabled: runtime.preferences?.workspacePolicy?.enabled,
      repository: Boolean(runtime.identity),
    });
  }

  function isCurrent(runtime) {
    return !runtime.disposed && runtimesByWindow.get(runtime.windowId) === runtime;
  }

  function assertReleaseAvailable() {
    if (!releaseAvailable) throw new Error("Git Auto Commit is unavailable in this build.");
  }

  return Object.freeze({
    assignWorkspace,
    releaseWindow,
    getSnapshot,
    setExperimentalOptIn,
    setWorkspacePolicy,
    reconcileWindow,
    reconcileAfterResume,
    closeAll,
  });
}

export function isGitAutoCommitEffectivelyEnabled({
  releaseAvailable,
  experimentalOptIn,
  workspaceEnabled,
  repository,
} = {}) {
  return releaseAvailable === true
    && experimentalOptIn === true
    && workspaceEnabled === true
    && repository === true;
}

function requireDependency(value, name) {
  if (!value || typeof value !== "object") throw new TypeError(`Git Auto Commit ${name} is required.`);
}

function requireWebContentsId(webContents) {
  if (!Number.isSafeInteger(webContents?.id) || webContents.id <= 0) {
    throw new TypeError("Git Auto Commit requires an owning webContents.");
  }
  return webContents.id;
}

function serviceResult(outcome, reason, retryable) {
  return Object.freeze({ outcome, reason, commitId: null, pathCount: null, retryable });
}

function sanitizeError(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
