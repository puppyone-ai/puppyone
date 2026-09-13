import type { SessionConnection } from "../../../shared/session-transport/types";

type PendingPort = { port: MessagePort; timeout: number };
const ports = new Map<string, PendingPort>();
const waiters = new Map<string, (port: MessagePort) => void>();
const connectionKey = (binding: SessionConnection) => `${binding.connection}:${binding.hostGeneration}`;

// A transferred port can arrive just before its IPC response. Match the two by
// connection identity; every unmatched port expires instead of accumulating.
function acceptSessionPort(event: MessageEvent) {
  if (event.source !== window || event.data?.type !== "puppyone-session-port" || event.ports.length !== 1) return;
  const binding = event.data.binding as SessionConnection;
  const port = event.ports[0]!;
  if (typeof binding?.connection !== "string" || typeof binding.hostGeneration !== "string") {
    port.close();
    return;
  }
  const key = connectionKey(binding);
  const accept = waiters.get(key);
  if (accept) {
    waiters.delete(key);
    accept(port);
    return;
  }
  if (ports.has(key) || ports.size >= 64) {
    port.close();
    return;
  }
  const timeout = window.setTimeout(() => {
    ports.delete(key);
    port.close();
  }, 10_000);
  ports.set(key, { port, timeout });
}

if (typeof window !== "undefined") window.addEventListener("message", acceptSessionPort);

export function receiveSessionPort(binding: SessionConnection): Promise<MessagePort> {
  const key = connectionKey(binding);
  const pending = ports.get(key);
  if (pending) {
    ports.delete(key);
    clearTimeout(pending.timeout);
    return Promise.resolve(pending.port);
  }
  if (waiters.has(key)) return Promise.reject(new Error("Session connection is already being received."));
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      waiters.delete(key);
      reject(new Error("Session connection timed out."));
    }, 10_000);
    waiters.set(key, (port) => {
      clearTimeout(timeout);
      resolve(port);
    });
  });
}
