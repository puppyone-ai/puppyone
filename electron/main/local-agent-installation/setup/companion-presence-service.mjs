import { companionIdentities } from "./setup-registry.mjs";

export function createCompanionPresenceService({ port, now = Date.now }) {
  let active = null;
  let queued = null;
  let cache = null;
  let disposed = false;
  let controller = null;
  let epoch = 0;
  let generation = 0;
  const revisions = new WeakMap();
  function discover({ refresh = false } = {}) {
    if (disposed) return Promise.resolve([]);
    if (active) {
      if (!refresh) return queued ?? active;
      if (!queued) {
        const queuedEpoch = epoch;
        queued = active.then(() => { queued = null; return queuedEpoch === epoch ? discover({ refresh: true }) : []; });
      }
      return queued;
    }
    if (!refresh && cache && now() >= cache.at && now() - cache.at < 30_000) return Promise.resolve(cache.value);
    controller = new AbortController();
    const scanGeneration = ++generation;
    const signal = controller.signal;
    active = Promise.resolve().then(() => port.inspect(companionIdentities, { signal }))
      .catch(() => companionIdentities.map(({ id }) => ({ companionId: id, status: "unknown" })))
      .then((value) => {
        revisions.set(value, scanGeneration);
        cache = !disposed && !signal.aborted && value.every(({ status }) => status !== "unknown") ? { value, at: now() } : null;
        return disposed || signal.aborted ? [] : value;
      }).finally(() => { active = null; });
    return active;
  }
  function cancel() { epoch += 1; generation += 1; cache = null; controller?.abort(); }
  return Object.freeze({
    discover, cancel,
    getRevision: (value) => revisions.get(value),
    isCurrentRevision: (revision) => !disposed && !active && !queued && revision === generation,
    dispose() { disposed = true; cancel(); },
  });
}
