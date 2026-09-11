type Binding = { connection: string; hostGeneration: string };
type Connection = { port: MessagePort; binding: Binding };
const ports = new Map<string, Connection>();
const waiters = new Map<string, (connection: Connection) => void>();

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.data?.type !== "puppyone-item-port" || event.ports.length !== 1) return;
  const binding = event.data.binding as Binding;
  if (typeof binding?.connection !== "string" || typeof binding.hostGeneration !== "string") return;
  const connection = { port: event.ports[0]!, binding };
  const accept = waiters.get(binding.connection);
  if (accept) { waiters.delete(binding.connection); accept(connection); }
  else {
    if (ports.size >= 4) { ports.values().next().value?.port.close(); ports.delete(ports.keys().next().value!); }
    ports.set(binding.connection, connection);
  }
});

export function receiveDisplayPort(binding: Binding): Promise<Connection> {
  const connection = ports.get(binding.connection);
  if (connection) { ports.delete(binding.connection); return Promise.resolve(connection); }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { waiters.delete(binding.connection); reject(new Error("Display connection timed out.")); }, 10_000);
    waiters.set(binding.connection, (value) => { clearTimeout(timer); resolve(value); });
  });
}
