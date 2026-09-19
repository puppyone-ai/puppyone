/** Local cancellation ownership. Cross-process resources still require explicit disposal. */
export class ManagedOperationScope {
  private controller = new AbortController();
  private operations = new Map<string, () => void>();
  get signal() { return this.controller.signal; }
  get size() { return this.operations.size; }
  own(id: string, release: () => void) {
    if (this.signal.aborted) { release(); return () => {}; }
    this.operations.get(id)?.();
    this.operations.set(id, release);
    return () => { if (this.operations.get(id) === release) this.operations.delete(id); };
  }
  cancel() {
    if (this.signal.aborted) return;
    this.controller.abort();
    for (const release of this.operations.values()) { try { release(); } catch { /* Continue sibling cleanup. */ } }
    this.operations.clear();
  }
}

export function waitForScopedOperation<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error: unknown, value?: T) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value as T);
    };
    const abort = () => finish(new Error("The operation scope was cancelled."));
    promise.then(value => finish(null, value), error => finish(error));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(new Error("The operation timed out.")), timeoutMs);
  });
}
