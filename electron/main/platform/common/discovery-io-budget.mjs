const MAX_PENDING_TASKS = 16;
const DEFAULT_TIMEOUT_MS = 1_500;
let pendingTasks = 0;

/** A timed-out filesystem request still occupies a slot until it really ends. */
export function runDiscoveryIo(task, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  signal?.throwIfAborted();
  if (pendingTasks >= MAX_PENDING_TASKS) return Promise.reject(ioError("filesystem-busy"));
  pendingTasks += 1;
  const work = Promise.resolve().then(task).finally(() => { pendingTasks -= 1; });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => finish(reject, signal.reason ?? ioError("filesystem-cancelled"));
    const timer = setTimeout(() => finish(reject, ioError("filesystem-timeout")), timeoutMs);
    timer.unref?.();
    signal?.addEventListener("abort", abort, { once: true });
    work.then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}

function ioError(code) {
  return Object.assign(new Error("Installation filesystem check is incomplete."), { code });
}

export const discoveryIoPolicy = Object.freeze({ maxPendingTasks: MAX_PENDING_TASKS, timeoutMs: DEFAULT_TIMEOUT_MS });
