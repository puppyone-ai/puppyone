/** Per-renderer ownership of cancellable GETs; never replay/cancel a write. */
export function createCloudReadRequests() {
  const reads = new Map();
  function begin(sender, request) {
    if (!request?.requestId || (request.method ?? "GET").toUpperCase() !== "GET") return null;
    if (typeof request.requestId !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(request.requestId)) {
      throw new Error("Invalid Cloud read request id.");
    }
    const key = `${sender.id}:${request.requestId}`;
    if (reads.has(key)) throw new Error("Duplicate Cloud read request id.");
    const controller = new AbortController();
    const abort = () => controller.abort();
    sender.once("destroyed", abort);
    reads.set(key, controller);
    return { signal: controller.signal, close() {
      sender.removeListener("destroyed", abort);
      if (reads.get(key) === controller) reads.delete(key);
    } };
  }
  return { begin, cancel(sender, requestId) { reads.get(`${sender.id}:${requestId}`)?.abort(); } };
}
