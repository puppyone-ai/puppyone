import { companionIdentities } from "./setup-registry.mjs";

/** App observations share the CLI discovery session, not a view lifetime or TTL. */
export function createCompanionPresenceService({ port }) {
  let active = null;
  let queued = null;
  let cache = null;
  let disposed = false;
  let epoch = 0;
  let generation = 0;
  const revisions = new WeakMap();
  function discover({ installationGeneration } = {}) {
    if (disposed) return Promise.resolve([]);
    if (!Number.isSafeInteger(installationGeneration) || installationGeneration < 1) {
      return Promise.reject(new Error("Invalid installation generation."));
    }
    if (active) {
      if (!active.controller.signal.aborted && installationGeneration <= active.installationGeneration) return active.promise;
      if (!queued) {
        const next = { installationGeneration, epoch, promise: null };
        next.promise = active.promise.then(() => {
          if (queued === next) queued = null;
          return !disposed && next.epoch === epoch ? discover({ installationGeneration: next.installationGeneration }) : [];
        });
        queued = next;
      } else {
        queued.installationGeneration = Math.max(queued.installationGeneration, installationGeneration);
      }
      return queued.promise;
    }
    if (cache && installationGeneration <= cache.installationGeneration) return Promise.resolve(cache.value);
    const controller = new AbortController();
    const scanGeneration = ++generation;
    const signal = controller.signal;
    const scan = { installationGeneration, controller, promise: null };
    scan.promise = Promise.resolve().then(() => port.inspect(companionIdentities, { signal }))
      .catch(() => companionIdentities.map(({ id }) => ({ companionId: id, status: "unknown" })))
      .then((value) => {
        if (disposed || signal.aborted) return [];
        revisions.set(value, scanGeneration);
        // Unknown remains unknown, never absence. Retry only after an explicit CLI
        // scan, so a denied/slow filesystem cannot create a view-open probe loop.
        cache = { value, installationGeneration, revision: scanGeneration };
        return value;
      }).finally(() => { if (active === scan) active = null; });
    active = scan;
    return scan.promise;
  }
  function cancel() {
    epoch += 1;
    active?.controller.abort();
    queued = null;
    // Releasing the last view cancels outstanding work, not completed evidence.
  }
  return Object.freeze({
    discover, cancel,
    getRevision: (value) => revisions.get(value),
    isCurrentRevision: (revision) => !disposed && !active && !queued && cache !== null && revision === cache.revision,
    dispose() { disposed = true; cancel(); cache = null; },
  });
}
