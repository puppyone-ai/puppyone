const VERSION = 1;
const encoder = new TextEncoder();

export function hostError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Bounded, generation-bound RPC. A timed-out command is never retried. */
export function createHostRpc({
  generation, send, handle = async () => { throw hostError("HOST_METHOD", "Unknown host method."); },
  timeoutMs = 15_000, maxPending = 32, maxMessageBytes = 16 * 1024 * 1024,
  maxPendingBytes = 32 * 1024 * 1024,
}) {
  const pending = new Map();
  let sequence = 0;
  let outboundBytes = 0;
  let incoming = 0;
  let incomingBytes = 0;
  let lastRequestId = 0;
  let closed = false;
  const envelope = (value) => ({ version: VERSION, generation, ...value });
  const size = (value) => encoder.encode(JSON.stringify(value)).byteLength;
  const transmit = (value) => {
    const message = envelope(value);
    if (size(message) > maxMessageBytes) throw hostError("HOST_MESSAGE_BUDGET", "Host message exceeds its byte budget.");
    send(message);
  };
  const settle = (id, error, value) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    outboundBytes -= entry.bytes;
    clearTimeout(entry.timer);
    if (error) entry.reject(error);
    else entry.resolve(value);
  };
  return Object.freeze({
    call(method, args = [], options = {}) {
      if (closed) return Promise.reject(hostError("HOST_CLOSED", "The instance host has closed."));
      const id = ++sequence;
      const request = { type: "request", id, method, args };
      let bytes;
      try { bytes = size(envelope(request)); }
      catch { return Promise.reject(hostError("HOST_PAYLOAD", "Host payload is not serializable.")); }
      if (bytes > maxMessageBytes || outboundBytes + bytes > maxPendingBytes || pending.size >= maxPending) {
        return Promise.reject(hostError("HOST_BUSY", "The instance control channel is at capacity."));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => settle(id, hostError("HOST_DELIVERY_UNKNOWN", "Host response timed out; command delivery is unknown.")), options.timeoutMs ?? timeoutMs);
        timer.unref?.();
        pending.set(id, { resolve, reject, timer, bytes });
        outboundBytes += bytes;
        try { transmit(request); }
        catch (error) { settle(id, error); }
      });
    },
    async receive(message) {
      if (closed || message?.version !== VERSION || message.generation !== generation) return;
      if (!Number.isSafeInteger(message.id) || message.id < 1) return;
      if (message.type === "result") {
        if (size(message) > maxMessageBytes) {
          settle(message.id, hostError("HOST_MESSAGE_BUDGET", "Host response exceeds its byte budget."));
        } else settle(message.id, message.error ? hostError(message.error.code, message.error.message) : null, message.value);
        return;
      }
      if (message.type !== "request" || typeof message.method !== "string" || !Array.isArray(message.args)) return;
      if (message.id <= lastRequestId) return;
      lastRequestId = message.id;
      const respond = (result) => { if (!closed) transmit({ type: "result", id: message.id, ...result }); };
      const bytes = size(message);
      if (incoming >= maxPending || bytes > maxMessageBytes || incomingBytes + bytes > maxPendingBytes) {
        respond({ error: { code: "HOST_BUSY", message: "The instance control channel is at capacity." } });
        return;
      }
      incoming += 1;
      incomingBytes += bytes;
      try { respond({ value: await handle(message.method, message.args) }); }
      catch (error) {
        try { respond({ error: { code: error?.code ?? "HOST_FAILED", message: String(error?.message ?? error).slice(0, 2000) } }); }
        catch { /* The transport is already gone; the caller owns its deadline. */ }
      } finally { incoming -= 1; incomingBytes -= bytes; }
    },
    close(error = hostError("HOST_CLOSED", "The instance host has closed.")) {
      if (closed) return;
      closed = true;
      for (const id of pending.keys()) settle(id, error);
    },
    diagnostics: () => ({ pending: pending.size, pendingBytes: outboundBytes, incoming, incomingBytes, closed }),
  });
}
