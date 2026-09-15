import { performance } from "node:perf_hooks";
import { assertLocalAgentInstallationSnapshot } from "../../../shared/local-agent-installation/schema.mjs";
import { createLocalAgentExecutableResolver } from "./executable-resolver.mjs";
import { createLocalAgentInstallationRegistry } from "./installation-registry.mjs";

const DEFAULT_CACHE_TTL_MS = 30_000;

/**
 * Application-scoped authority for local installation discovery.
 *
 * Regular callers share an active scan. A hard refresh requested during that
 * scan is coalesced into one guaranteed follow-up scan, so refresh never
 * resolves with work that began before the user's action.
 */
export function createLocalAgentInstallationService(options = {}) {
  const {
    registry = createLocalAgentInstallationRegistry(),
    now = Date.now,
    monotonicNow = () => performance.now(),
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
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
  let cached = null;
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
    const requestedAt = now();
    if (active) {
      if (refresh) return enqueueFreshScan(onProgress);
      addObserver(active.observers, onProgress);
      return active.promise;
    }
    if (!refresh && cached && requestedAt - cached.cachedAt < cacheTtlMs) {
      diagnostics.cacheHitCount += 1;
      return Promise.resolve(assertLocalAgentInstallationSnapshot({
        ...cached.snapshot,
        source: "memory-cache",
      }));
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
          cached = snapshot.results.some(({ status, reasonCode }) => status === "failed" || reasonCode === "environment-unavailable")
            ? null
            : { cachedAt: completedAtMs, snapshot };
          safelyPublish(publishSnapshot, snapshot);
        }
        return snapshot;
      });
    active = { observers, promise: task, scanGeneration };
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
      publishProgress(observers, {
        scanId,
        generation: scanGeneration,
        completedAgentCount,
        totalAgentCount: registry.length,
        results: stableResults(registry, settled),
      });
    }));
    const results = stableResults(registry, settled);
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
    cached = null;
    latestSnapshot = null;
    active = null;
    if (queuedRefresh) {
      queuedRefresh.reject(new Error("Local Agent installation service is closed."));
      queuedRefresh = null;
    }
  }

  return Object.freeze({ discover, dispose, getDiagnostics, getSnapshot });
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

function publishProgress(observers, progress) {
  const results = Object.freeze([...progress.results]);
  const event = Object.freeze({
    ...progress,
    results,
    availableAgentIds: Object.freeze(
      results.filter(({ status }) => status === "found").map(({ agentId }) => agentId),
    ),
  });
  for (const observer of observers) {
    try {
      observer(event);
    } catch {
      // A renderer disappearing must not interrupt application-scoped discovery.
    }
  }
}

function addObserver(observers, observer) {
  if (typeof observer === "function") observers.add(observer);
}

function safelyPublish(publishSnapshot, snapshot) {
  if (typeof publishSnapshot !== "function") return;
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
  cacheTtlMs: DEFAULT_CACHE_TTL_MS,
  hardRefreshGuaranteesSubsequentScan: true,
});
