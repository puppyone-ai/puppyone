import { randomUUID } from "node:crypto";
import { createHostRpc, hostError } from "../../../shared/item-host-contract/rpc.mjs";
import { createNativeProcessOwner } from "./native-process-owner.mjs";

/** One replaceable execution process, never a shared pool or an inline fallback. */
export function createUtilityHost({ utilityProcess, modulePath, identity, budget, initialize,
  handle, onEvent = () => {}, onExit = () => {}, logger = console }) {
  const generation = randomUUID();
  const nativeProcesses = createNativeProcessOwner();
  const lease = budget.reserve({ ...identity, key: `utility:${identity.key}` });
  let child;
  try {
    child = utilityProcess.fork(modulePath, [generation], {
      serviceName: `PuppyOne ${identity.kind} ${identity.key}`,
      stdio: "pipe",
      execArgv: ["--max-old-space-size=512"],
    });
  } catch (error) { lease.release(); throw error; }
  // Drain native diagnostics without creating an unbounded Main log stream.
  child.stdout?.resume();
  let diagnosticBytes = 0;
  child.stderr?.on("data", (chunk) => { diagnosticBytes = Math.min(Number.MAX_SAFE_INTEGER, diagnosticBytes + chunk.length); });
  let exited = false;
  let closing = false;
  let lastHeartbeat = Date.now();
  let failure = null;
  let resolveExit;
  let exitInfo = null;
  const exit = new Promise((resolve) => { resolveExit = resolve; });
  const rpc = createHostRpc({ generation, send: (message) => child.postMessage(message), handle,
    timeoutMs: budget.policy.startupTimeoutMs });
  const fail = (error) => {
    if (exited || failure) return;
    failure = error;
    rpc.close(error);
    onEvent({ type: "host-failed", code: error.code, message: error.message });
    child.kill();
  };
  const watchdog = setInterval(() => {
    if (Date.now() - lastHeartbeat > budget.policy.heartbeatTimeoutMs) {
      fail(hostError("HOST_UNRESPONSIVE", "The execution host stopped responding."));
    }
  }, 2_000);
  watchdog.unref?.();
  child.once("spawn", () => lease.bindProcess(child.pid, "utility", fail));
  child.on("message", (message) => {
    if (message?.generation !== generation) return;
    if (message.type === "native-process") nativeProcesses.receive(message);
    else if (message.type === "heartbeat") {
      lastHeartbeat = Date.now();
      if (message.rss > budget.policy.utilityRssBytes) fail(hostError("HOST_MEMORY_BUDGET", "The execution host exceeded its memory budget."));
    } else if (message.type === "event") onEvent(message.event);
    else void rpc.receive(message).catch((error) => fail(error));
  });
  child.once("exit", (code) => {
    if (code !== 0 && diagnosticBytes) logger.warn?.("Instance execution host exited:", { code, diagnosticBytes });
    exited = true;
    clearInterval(watchdog);
    rpc.close(failure ?? hostError("HOST_EXITED", "The execution host exited."));
    exitInfo = { code, expected: closing && !failure };
    void nativeProcesses.close().then(() => {
      lease.release(); resolveExit(exitInfo);
      onExit({ ...exitInfo, error: failure });
    }).catch((error) => { onExit({ code, expected: false, error }); });
  });
  child.on("error", () => fail(hostError("HOST_CRASHED", "The execution host crashed.")));
  const ready = rpc.call("initialize", [initialize]).then((result) => {
    lease.ready();
    return result;
  }).catch((error) => { fail(error); throw error; });
  // Startup failure remains observable through ready, without an unhandled rejection.
  void ready.catch(() => {});
  return Object.freeze({
    generation, ready, exit,
    get pid() { return child.pid; },
    get exited() { return exited; },
    async call(method, args = [], options) {
      await ready;
      if (failure) throw failure;
      return rpc.call(method, args, options);
    },
    attachPort(port, binding) {
      if (exited || failure) { port.close(); throw failure ?? hostError("HOST_EXITED", "The execution host exited."); }
      child.postMessage({ type: "display-port", generation, binding }, [port]);
    },
    async close() {
      if (exited) {
        await nativeProcesses.close();
        lease.release();
        resolveExit(exitInfo);
        return exitInfo;
      }
      if (!closing) {
        closing = true;
        try { await ready; await rpc.call("shutdown", [], { timeoutMs: budget.policy.closeTimeoutMs }); }
        catch (error) { logger.warn?.("Instance shutdown did not acknowledge:", error.code ?? error.name); child.kill(); }
      }
      let timer;
      try {
        return await Promise.race([exit, new Promise((_, reject) => {
          timer = setTimeout(() => {
            child.kill();
            reject(hostError("HOST_CLOSE_UNCONFIRMED", "Execution process exit is not confirmed; its resource lease is retained."));
          }, budget.policy.closeTimeoutMs);
          timer.unref?.();
        })]);
      } finally { clearTimeout(timer); }
    },
    diagnostics: () => ({ generation, pid: child.pid ?? null, exited, closing, failure: failure?.code ?? null, nativeProcesses: nativeProcesses.snapshot(), ...rpc.diagnostics() }),
  });
}
