export const DEFAULT_RUNTIME_DISCOVERY_TIMEOUT_MS = 15_000;

/** Host-owned deadline and one outstanding native probe per runtime. */
export class RuntimeDiscoverySupervisor {
  constructor({ timeoutMs = DEFAULT_RUNTIME_DISCOVERY_TIMEOUT_MS } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("Discovery deadline must be positive.");
    this.timeoutMs = timeoutMs;
    this.flights = new Map();
    this.disposed = false;
  }

  run(runtimeId, discover) {
    if (this.disposed) return Promise.reject(new Error("Agent runtime discovery has closed."));
    const existing = this.flights.get(runtimeId);
    if (existing) return existing.result;

    const controller = new AbortController();
    let rejectObservation;
    let timer;
    const cancelled = new Promise((_resolve, reject) => { rejectObservation = reject; });
    const cancel = (message) => {
      clearTimeout(timer);
      const error = new Error(message);
      rejectObservation(error);
      controller.abort(error);
    };
    const native = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return discover(controller.signal);
    });
    const flight = { cancel, result: Promise.race([native, cancelled]) };
    this.flights.set(runtimeId, flight);
    timer = setTimeout(() => cancel(`Agent runtime ${runtimeId} discovery timed out after ${this.timeoutMs} ms.`), this.timeoutMs);
    timer.unref?.();
    const settled = () => {
      clearTimeout(timer);
      if (this.flights.get(runtimeId) === flight) this.flights.delete(runtimeId);
    };
    // A deadline ends observation, not necessarily native work. Retain the
    // flight until native settlement, so Refresh cannot multiply a stuck probe.
    // Both branches are observed even after timeout or Host disposal.
    void native.then(settled, settled);
    return flight.result;
  }

  hasActiveResources() { return this.flights.size > 0; }

  dispose() {
    this.disposed = true;
    for (const flight of this.flights.values()) flight.cancel("Agent runtime discovery has closed.");
  }
}
