/** Request deadlines end a wait, never the lifetime of the native process.
 * Retain bounded late-receipt handlers; issued IDs outside that window are
 * still recognized so an old reply cannot poison an otherwise healthy stream.
 */
export class NativeRequestLedger {
  constructor({ limit = 512, wasIssued }) {
    this.pending = new Map();
    this.late = new Map();
    this.seen = new Set();
    this.limit = limit;
    this.wasIssued = wasIssued;
  }

  request({ id, method, timeoutMs, signal, timeoutError, abortError, write, onLateResponse }) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const abandon = (error) => {
        if (!this.pending.delete(id)) return;
        cleanup();
        this.late.set(id, { method, cleanup, resolve: (value) => onLateResponse?.(null, value),
          reject: (failure) => onLateResponse?.(failure) });
        this.#trim(this.late);
        reject(error);
      };
      const onAbort = () => abandon(abortError());
      const timer = timeoutMs > 0 ? setTimeout(() => abandon(timeoutError()), timeoutMs) : null;
      timer?.unref?.();
      this.pending.set(id, { method, cleanup, resolve, reject });
      signal?.addEventListener("abort", onAbort, { once: true });
      try { write(); }
      catch (error) { abandon(error); }
    });
  }

  take(id) {
    if (this.seen.has(id)) return { failure: "duplicate" };
    const request = this.pending.get(id) ?? this.late.get(id);
    if (!request) return this.wasIssued(id) ? {} : { failure: "unknown" };
    this.pending.delete(id);
    this.late.delete(id);
    request.cleanup();
    this.seen.add(id);
    this.#trim(this.seen);
    return { request };
  }

  close(errorFor) {
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(errorFor(request.method));
    }
    this.pending.clear();
    this.late.clear();
    this.seen.clear();
  }

  #trim(collection) {
    if (collection.size > this.limit) collection.delete(collection.keys().next().value);
  }
}
