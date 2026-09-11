import { hostError } from "../../../shared/item-host-contract/rpc.mjs";

export const itemHostBudgetDefaults = Object.freeze({
  application: 24,
  window: 16,
  project: 12,
  concurrentStarts: 4,
  rendererRssBytes: 768 * 1024 * 1024,
  utilityRssBytes: 768 * 1024 * 1024,
  applicationRssBytes: 4 * 1024 * 1024 * 1024,
  windowRssBytes: 3 * 1024 * 1024 * 1024,
  projectRssBytes: 2 * 1024 * 1024 * 1024,
  reservationBytes: 128 * 1024 * 1024,
  sustainedCpuPercent: 95,
  sustainedCpuMs: 30_000,
  startupTimeoutMs: 30_000,
  heartbeatTimeoutMs: 15_000,
  closeTimeoutMs: 10_000,
});

/** Leases include starting, hidden, failed and closing hosts until actual exit. */
export function createItemHostBudget(limits = {}, { readMetrics, now = Date.now } = {}) {
  const policy = Object.freeze({ ...itemHostBudgetDefaults, ...limits });
  const leases = new Map();
  let monitor = null;
  const memory = (entries) => entries.reduce((total, entry) => total + Math.max(entry.rss ?? 0, policy.reservationBytes), 0);
  const sample = (metrics) => {
    const byPid = new Map(metrics.map((metric) => [metric.pid, metric]));
    for (const entry of leases.values()) {
      const metric = byPid.get(entry.pid);
      if (!metric || entry.failed) continue;
      entry.rss = Math.max(0, metric.memory?.workingSetSize ?? 0) * 1024;
      const cpu = metric.cpu?.percentCPUUsage ?? 0;
      entry.cpuSince = cpu >= policy.sustainedCpuPercent ? entry.cpuSince ?? now() : null;
      const memoryLimit = entry.role === "renderer" ? policy.rendererRssBytes : policy.utilityRssBytes;
      const code = entry.rss > memoryLimit ? "HOST_MEMORY_BUDGET"
        : entry.cpuSince !== null && now() - entry.cpuSince >= policy.sustainedCpuMs ? "HOST_CPU_BUDGET" : null;
      if (code) {
        entry.failed = true;
        entry.onExceeded?.(hostError(code, "This instance exceeded its sustained process resource budget."));
      }
    }
    // Aggregate pressure closes only the largest contributor, then waits for
    // confirmed release before selecting another. Siblings are not restarted.
    const entries = [...leases.values()];
    const pressure = entries.filter((entry) => memory(entries) > policy.applicationRssBytes
      || memory(entries.filter((other) => other.ownerId === entry.ownerId)) > policy.windowRssBytes
      || memory(entries.filter((other) => other.ownerId === entry.ownerId && other.projectId === entry.projectId)) > policy.projectRssBytes);
    if (!pressure.some((entry) => entry.failed)) {
      const largest = pressure.filter((entry) => entry.pid).sort((a, b) => b.rss - a.rss)[0];
      if (largest) {
        largest.failed = true;
        largest.onExceeded?.(hostError("HOST_AGGREGATE_MEMORY_BUDGET", "This instance exceeded the available project process memory budget."));
      }
    }
  };
  return Object.freeze({
    policy,
    reserve({ key, ownerId, projectId, kind }) {
      if (leases.has(key)) throw hostError("HOST_DUPLICATE", "An instance already owns this resource lease.");
      const entries = [...leases.values()];
      const atLimit = entries.length >= policy.application
        || entries.filter((entry) => entry.ownerId === ownerId).length >= policy.window
        || entries.filter((entry) => entry.ownerId === ownerId && entry.projectId === projectId).length >= policy.project
        || entries.filter((entry) => entry.starting).length >= policy.concurrentStarts
        || memory(entries) + policy.reservationBytes > policy.applicationRssBytes
        || memory(entries.filter((entry) => entry.ownerId === ownerId)) + policy.reservationBytes > policy.windowRssBytes
        || memory(entries.filter((entry) => entry.ownerId === ownerId && entry.projectId === projectId)) + policy.reservationBytes > policy.projectRssBytes;
      if (atLimit) throw hostError("HOST_BUDGET_EXHAUSTED", "Instance process capacity is exhausted. Close an unused tab and try again.");
      const entry = { key, ownerId, projectId, kind, starting: true, rss: 0, cpuSince: null, failed: false };
      leases.set(key, entry);
      let released = false;
      return Object.freeze({
        bindProcess(pid, role, onExceeded) {
          Object.assign(entry, { pid, role, onExceeded });
          if (readMetrics && !monitor) {
            monitor = setInterval(() => sample(readMetrics()), 2000);
            monitor.unref?.();
          }
        },
        ready() { if (!released) entry.starting = false; },
        release() {
          if (!released) { released = true; leases.delete(key); }
          if (!leases.size && monitor) { clearInterval(monitor); monitor = null; }
        },
      });
    },
    sample,
    snapshot: () => [...leases.values()].map(({ onExceeded: _callback, ...entry }) => ({ ...entry })),
  });
}
