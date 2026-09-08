const DEFAULT_POSITIVE_TTL_MS = 5 * 60_000;
const DEFAULT_TRANSIENT_TTL_MS = 5_000;

const TRANSIENT_CODES = new Set([
  "AUTHENTICATION_PROBE_FAILED",
  "AUTHENTICATION_PROBE_CRASHED",
  "AUTHENTICATION_PROBE_TIMED_OUT",
  "AUTHENTICATION_STATUS_UNKNOWN",
  "RUNTIME_DISCOVERY_FAILED",
  "RUNTIME_INSPECTION_FAILED",
  "PROTOCOL_PROBE_FAILED",
]);

/** Bounded, refreshable and single-flight cache for one Runtime discovery. */
export function createCachedRuntimeDiscovery(load, {
  now = () => Date.now(),
  positiveTtlMs = DEFAULT_POSITIVE_TTL_MS,
  transientTtlMs = DEFAULT_TRANSIENT_TTL_MS,
} = {}) {
  if (typeof load !== "function") throw new TypeError("Runtime discovery cache requires a loader.");
  let generation = 0;
  let cached = null;
  let inFlight = null;

  async function discover({ refresh = false, signal } = {}) {
    signal?.throwIfAborted();
    if (refresh) {
      generation += 1;
      cached = null;
      inFlight = null;
    }
    const requestGeneration = generation;
    const currentTime = now();
    if (cached && cached.generation === requestGeneration && cached.expiresAt > currentTime) {
      return cached.value;
    }
    if (inFlight?.generation === requestGeneration) return inFlight.promise;

    const promise = Promise.resolve().then(() => {
      signal?.throwIfAborted();
      return load({ signal });
    });
    inFlight = { generation: requestGeneration, promise };
    try {
      const value = await promise;
      signal?.throwIfAborted();
      if (generation === requestGeneration) {
        const ttlMs = isTransient(value) ? transientTtlMs : positiveTtlMs;
        cached = {
          generation: requestGeneration,
          expiresAt: now() + Math.max(1, ttlMs),
          value,
        };
      }
      return value;
    } finally {
      if (inFlight?.generation === requestGeneration && inFlight.promise === promise) inFlight = null;
    }
  }

  return { discover };
}

function isTransient(value) {
  return TRANSIENT_CODES.has(value?.code)
    || (value?.status === "error" && value?.code !== "RUNTIME_NOT_INSTALLED");
}

export const runtimeDiscoveryCachePolicy = Object.freeze({
  positiveTtlMs: DEFAULT_POSITIVE_TTL_MS,
  transientTtlMs: DEFAULT_TRANSIENT_TTL_MS,
});
