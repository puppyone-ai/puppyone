import { performance } from "node:perf_hooks";
import { assertLocalAgentInstallationSnapshot } from "../../../shared/local-agent-installation/schema.mjs";
import { createLocalAgentExecutableResolver } from "./executable-resolver.mjs";
import { createLocalAgentInstallationRegistry } from "./installation-registry.mjs";

/**
 * Application-scoped authority for local installation discovery.
 *
 * Ordinary reads reuse the last observation for this application session,
 * including empty/failed results. Only an explicit refresh starts another scan.
 * Before the first result, regular callers share an active scan. A refresh during that
 * scan is coalesced into one guaranteed follow-up scan, so refresh never
 * resolves with work that began before the user's action.
 */
export function createLocalAgentInstallationService(options = {}) {
  const {
    registry = createLocalAgentInstallationRegistry(),
    now = Date.now,
    monotonicNow = () => performance.now(),
    publishSnapshot = null,
  } = options;
  const resolver = options.resolver ?? createLocalAgentExecutableResolver({
    registry,
    ...(options.discoveryPort ? { discoveryPort: options.discoveryPort } : {}),
  });
  const createResolutionContext = options.createResolutionContext
    ?? ((options) => resolver.createContext(options));
  const resolveInstallation = options.resolveInstallation
    ?? ((definition, context) => resolver.resolve(definition.id, { context }));
  let latestSnapshot = null;
  let active = null;
  let queuedRefresh = null;
  let generation = 0;
  let disposed = false;
  const controller = new AbortController();
  const diagnostics = {
    cacheHitCount: 0,
    catalogSize: registry.length,
    lastAvailableCount: 0,
    lastScanCompletedAt: null,
    lastScanDurationMs: null,
    queuedRefreshCount: 0,
    scanCount: 0,
  };

  function discover({ refresh = false, onProgress = null } = {}) {
    if (disposed) return Promise.reject(new Error("Local Agent installation service is closed."));
    if (!refresh && latestSnapshot) {
      diagnostics.cacheHitCount += 1;
      return Promise.resolve(assertLocalAgentInstallationSnapshot({
        ...latestSnapshot,
        source: "memory-cache",
      }));
    }
    if (active) {
      if (refresh) return enqueueFreshScan(onProgress);
      const scan = active;
      addObserver(scan.observers, onProgress);
      safelyPublish(onProgress, scan.progress);
      return scan.promise;
    }
    return startScan(onProgress ? new Set([onProgress]) : new Set());
  }

  function enqueueFreshScan(onProgress) {
    if (!queuedRefresh) {
      diagnostics.queuedRefreshCount += 1;
      let resolveQueued;
      let rejectQueued;
      const promise = new Promise((resolve, reject) => {
        resolveQueued = resolve;
        rejectQueued = reject;
      });
      queuedRefresh = {
        observers: new Set(),
        promise,
        resolve: resolveQueued,
        reject: rejectQueued,
      };
    }
    addObserver(queuedRefresh.observers, onProgress);
    return queuedRefresh.promise;
  }

  function startScan(observers) {
    const scanGeneration = ++generation;
    const scanId = `local-agent-scan:${scanGeneration}`;
    const requestedAtMs = now();
    const startedAt = monotonicNow();
    const task = runScan({ observers, requestedAtMs, scanGeneration, scanId })
      .then((snapshot) => {
        const completedAtMs = now();
        diagnostics.scanCount += 1;
        diagnostics.lastScanDurationMs = roundDuration(monotonicNow() - startedAt);
        diagnostics.lastScanCompletedAt = new Date(completedAtMs).toISOString();
        diagnostics.lastAvailableCount = snapshot.availableAgentIds.length;
        if (!disposed && scanGeneration === generation) {
          latestSnapshot = snapshot;
          safelyPublish(publishSnapshot, snapshot);
        }
        return snapshot;
      });
    active = { observers, promise: task, scanGeneration, progress: null };
    void task.then(
      () => finishScan(task),
      () => finishScan(task),
    );
    return task;
  }

  async function runScan({ observers, requestedAtMs, scanGeneration, scanId }) {
    let context;
    try {
      context = await createResolutionContext({ signal: controller.signal });
    } catch {
      context = null;
    }
    const settled = new Map();
    let completedAgentCount = 0;
    await Promise.all(registry.map(async (definition) => {
      let observation;
      if (!context) observation = { status: "failed", reasonCode: "context-error" };
      else {
        try {
          observation = await resolveInstallation(definition, context);
        } catch {
          observation = { status: "failed", reasonCode: "resolver-error" };
        }
      }
      settled.set(definition.id, publicResult(definition, observation));
      completedAgentCount += 1;
      const progress = createProgress({
        scanId,
        generation: scanGeneration,
        completedAgentCount,
        totalAgentCount: registry.length,
        results: stableResults(registry, settled),
      });
      if (disposed || active?.scanGeneration !== scanGeneration) return;
      active.progress = progress;
      for (const observer of observers) safelyPublish(observer, progress);
    }));
    const results = stableResults(registry, settled);
    const previouslyAvailable = new Set([
      ...(latestSnapshot?.availableAgentIds ?? []),
      ...(latestSnapshot?.retainedAgentIds ?? []),
    ]);
    const completedAt = new Date(now()).toISOString();
    return assertLocalAgentInstallationSnapshot({
      schemaVersion: 1,
      generation: scanGeneration,
      scanId,
      requestedAt: new Date(requestedAtMs).toISOString(),
      completedAt,
      source: "scan",
      results,
      availableAgentIds: results.filter(({ status }) => status === "found").map(({ agentId }) => agentId),
      retainedAgentIds: results.filter(({ agentId, status }) => status === "failed" && previouslyAvailable.has(agentId))
        .map(({ agentId }) => agentId),
    });
  }

  function finishScan(task) {
    if (active?.promise !== task) return;
    active = null;
    if (!queuedRefresh || disposed) return;
    const queued = queuedRefresh;
    queuedRefresh = null;
    startScan(queued.observers).then(queued.resolve, queued.reject);
  }

  function getSnapshot() {
    return latestSnapshot;
  }

  function getDiagnostics() {
    return Object.freeze({ ...diagnostics });
  }

  function dispose() {
    disposed = true;
    controller.abort();
    generation += 1;
    latestSnapshot = null;
    active = null;
    if (queuedRefresh) {
      queuedRefresh.reject(new Error("Local Agent installation service is closed."));
      queuedRefresh = null;
    }
  }

  return Object.freeze({ discover, dispose, getDiagnostics, getSnapshot, isScanning: () => active !== null || queuedRefresh !== null });
}

function publicResult(definition, observation) {
  const status = observation?.status === "found"
    ? "found"
    : observation?.status === "not-found"
      ? "not-found"
      : "failed";
  const reasonCode = safeToken(observation?.reasonCode);
  const source = status === "found" ? safeToken(observation?.candidate?.source) : null;
  return Object.freeze({
    agentId: definition.id,
    displayName: definition.displayName,
    status,
    ...(reasonCode ? { reasonCode } : {}),
    ...(source ? { source } : {}),
  });
}

function stableResults(registry, settled) {
  return registry.map(({ id }) => settled.get(id)).filter(Boolean);
}

function createProgress(progress) {
  const results = Object.freeze([...progress.results]);
  return Object.freeze({
    ...progress,
    results,
    availableAgentIds: Object.freeze(
      results.filter(({ status }) => status === "found").map(({ agentId }) => agentId),
    ),
  });
}

function addObserver(observers, observer) {
  if (typeof observer === "function") observers.add(observer);
}

function safelyPublish(publishSnapshot, snapshot) {
  if (typeof publishSnapshot !== "function" || !snapshot) return;
  try {
    publishSnapshot(snapshot);
  } catch {
    // Snapshot broadcasting is advisory; the invoke response is authoritative.
  }
}

function safeToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,80}$/u.test(value) ? value : null;
}

function roundDuration(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : null;
}

export const localAgentInstallationPolicy = Object.freeze({
  automaticScanScope: "application-session",
  refreshRequiresExplicitAction: true,
  hardRefreshGuaranteesSubsequentScan: true,
});
