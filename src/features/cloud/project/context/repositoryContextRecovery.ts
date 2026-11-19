/** Recovery belongs to the read-only repository-context query, never to writes.
 * One initial request + two jittered retries; later focus/online events permit
 * one throttled probe. No background polling or stale authorization fallback.
 */
export function canRecoverRepositoryContext(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as { status?: number; code?: string };
  if (failure.code === "SESSION_CHANGED") return false;
  if (failure.status != null) return [408, 500, 502, 503, 504].includes(failure.status);
  return failure.code === "CLOUD_TRANSPORT_UNAVAILABLE" || failure.code === "CLOUD_REQUEST_TIMEOUT";
}

export function startRepositoryContextRecovery(resolve: () => Promise<void>, onFailure: (error: unknown) => void): () => void {
  let disposed = false;
  let inFlight = false;
  let recoverable = false;
  let retries = 0;
  let nextProbeAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      timer = null;
      if (document.visibilityState !== "hidden") void run();
    }, delay);
  };
  const run = async () => {
    if (disposed || inFlight) return;
    inFlight = true;
    recoverable = false;
    nextProbeAt = Date.now() + 5_000;
    try {
      await resolve();
    } catch (error) {
      if (disposed) return;
      onFailure(error);
      recoverable = canRecoverRepositoryContext(error);
      if (recoverable && retries < 2) {
        const ceiling = 1_500 * 2 ** retries++;
        schedule(ceiling / 2 + Math.random() * ceiling / 2);
      }
    } finally {
      inFlight = false;
    }
  };
  const probe = () => {
    if (disposed || !recoverable || inFlight || timer !== null || document.visibilityState === "hidden") return;
    schedule(Math.min(5_000, Math.max(0, nextProbeAt - Date.now())));
  };
  window.addEventListener("online", probe);
  window.addEventListener("focus", probe);
  document.addEventListener("visibilitychange", probe);
  void run();
  return () => {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("online", probe);
    window.removeEventListener("focus", probe);
    document.removeEventListener("visibilitychange", probe);
  };
}
