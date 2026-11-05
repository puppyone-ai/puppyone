/**
 * Main-side handle on `electron/utility/host-exec/main.mjs`, shaped like the
 * terminal service the exec service expects (create/input/resize/close plus an
 * output transport). Main never owns a PTY. A crashed process ends every remote
 * session it held; the next start forks a new one.
 */
export function createUtilityTerminals({ utilityProcess, modulePath, appVersion, createOutputTransport, logger = console }) {
  let child = null;
  let ready = null;
  const transports = new Map();
  const starting = new Map();

  function start() {
    if (ready) return ready;
    const process = utilityProcess.fork(modulePath, [], {
      serviceName: "PuppyOne remote terminals", stdio: "ignore", execArgv: ["--max-old-space-size=256"] });
    child = process;
    ready = new Promise((resolve, reject) => {
      process.on("message", (message) => {
        if (message?.type === "ready") { resolve(process); return; }
        if (message?.type === "opened") starting.get(message.session)?.resolve();
        else if (message?.type === "failed") starting.get(message.session)?.reject(new Error(message.message));
        else if (message?.type === "output") transports.get(message.session)?.write(message.data);
        else if (message?.type === "exit") {
          const transport = transports.get(message.session);
          transports.delete(message.session);
          transport?.exit({ code: message.code });
        }
      });
      process.once("exit", (code) => {
        if (child === process) { child = null; ready = null; }
        if (code !== 0) logger.warn?.("Remote terminal process exited", { code });
        for (const [, waiter] of starting) waiter.reject(new Error("Remote terminal process exited."));
        starting.clear();
        for (const [, transport] of transports) transport.exit({ code: null });
        transports.clear();
        reject(new Error("Remote terminal process exited."));
      });
    });
    return ready;
  }

  return Object.freeze({
    async create(_sender, request, root) {
      const process = await start();
      transports.set(request.id, createOutputTransport({ id: request.id }));
      try {
        await new Promise((resolve, reject) => {
          starting.set(request.id, { resolve, reject });
          process.postMessage({ type: "open", session: request.id, launcher: request.launcherId, cols: request.cols,
            rows: request.rows, root, appVersion });
        });
      } catch (error) {
        transports.delete(request.id);
        throw error;
      } finally {
        starting.delete(request.id);
      }
    },
    input(_sender, request) { child?.postMessage({ type: "input", session: request.id, data: request.data }); },
    resize(_sender, request) { child?.postMessage({ type: "resize", session: request.id, cols: request.cols, rows: request.rows }); },
    async close(_sender, request) { child?.postMessage({ type: "close", session: request.id }); },
    dispose() { child?.kill(); child = null; ready = null; },
  });
}
