export function historyFailure(message, code = "HISTORY_QUERY_FAILED", retryable = true) {
  return Object.assign(new Error(message), { code, retryable });
}

/** Stop observing a query; each caller still owns and releases its native resources. */
export function observeHistoryOperation(operation, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      if (signal?.aborted) throw signal.reason;
      return operation();
    }).then(resolve, reject).finally(() => signal?.removeEventListener("abort", abort));
  });
}
