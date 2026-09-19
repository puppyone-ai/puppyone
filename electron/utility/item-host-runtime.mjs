import { EventEmitter } from "node:events";
import { createHostRpc, hostError } from "../../shared/item-host-contract/rpc.mjs";

/** The execution owner survives all display connections and Renderer generations. */
export function runItemHost({ createService, methods, onDisplay = () => {} }) {
  const generation = process.argv.at(-1);
  const parent = process.parentPort;
  if (!parent || !generation) throw new Error("An item utility must be launched by its supervisor.");
  let service;
  let identity;
  let display = null;
  let shuttingDown = false;
  const owner = new EventEmitter();
  owner.isDestroyed = () => shuttingDown;
  owner.send = (channel, payload) => display?.postMessage({ type: "event", channel, payload, generation });
  const emit = (event) => parent.postMessage({ type: "event", generation, event });
  let shutdownPromise;
  const shutdown = () => {
    shuttingDown = true;
    display?.close();
    display = null;
    shutdownPromise ??= Promise.resolve().then(() => service?.closeAll()).then(() => {
      // Stay alive to reap children until Main verifies their cleanup. Exiting
      // first can leave an orphan/zombie group that cannot be confirmed closed.
      parent.postMessage({ type: "shutdown-ready", generation });
      return { closed: true };
    });
    return shutdownPromise;
  };
  const rpc = createHostRpc({ generation, send: (message) => parent.postMessage(message), handle: async (method, args) => {
    if (method === "initialize") {
      if (identity || shuttingDown) throw hostError("HOST_INITIALIZED", "The instance host is already initialized or closing.");
      identity = args[0];
      owner.id = identity.ownerId;
      service = await createService({ identity, owner, callMain: (name, values) => rpc.call(name, values), emit });
      if (shuttingDown) { await service.closeAll(); throw hostError("HOST_CLOSING", "The host closed during initialization."); }
      return { pid: process.pid };
    }
    if (method === "shutdown") {
      return shutdown();
    }
    if (!service || shuttingDown || !methods.has(method)) throw hostError("HOST_METHOD", "The instance does not expose this operation.");
    if (["create", "createSession", "resumeSession", "openSession"].includes(method)) {
      return service[method](owner, ...args, { assertCurrent() {
        if (shuttingDown) throw hostError("HOST_CLOSING", "The item was closed during native startup.");
      } });
    }
    return service[method](owner, ...args);
  } });
  parent.on("message", (event) => {
    const message = event.data;
    if (message?.generation !== generation) { event.ports?.forEach((port) => port.close()); return; }
    if (message.type === "terminate") {
      // Reserved management path is independent of ordinary RPC capacity.
      void shutdown().catch(() => {});
    } else if (message.type === "terminate-exit" && shuttingDown) {
      process.exit(0);
    } else if (message.type === "display-port") {
      const port = event.ports?.[0];
      if (!port || !service || shuttingDown) { port?.close(); return; }
      display?.close();
      display = port;
      port.on("close", () => { if (display === port) display = null; });
      onDisplay({ service, owner, port, binding: message.binding, generation });
      port.start();
    } else void rpc.receive(message).catch(() => process.exit(1));
  });
  const heartbeat = () => parent.postMessage({ type: "heartbeat", generation, rss: process.memoryUsage().rss });
  setInterval(heartbeat, 2_000).unref();
  heartbeat();
}
