import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hostError } from "../../../shared/item-host-contract/rpc.mjs";

const execute = promisify(execFile);

/** Retains OS cleanup authority even when the utility's event loop is gone. */
export function createNativeProcessOwner({ platform = process.platform, kill = process.kill, run = execute } = {}) {
  const processes = new Map();
  const pending = new Map();
  const target = (entry) => entry.grouped && platform !== "win32" ? -entry.pid : entry.pid;
  const alive = (entry) => {
    try { kill(target(entry), 0); return true; }
    catch (error) { if (error.code === "ESRCH") return false; throw error; }
  };
  const terminate = async (entry) => {
    if (pending.has(entry.pid)) return pending.get(entry.pid);
    const closing = (async () => {
      if (platform === "win32") {
        await run("taskkill", ["/PID", String(entry.pid), "/T", "/F"], { timeout: 3000, maxBuffer: 8192, windowsHide: true })
          .catch((error) => { if (alive(entry)) throw error; });
      } else {
        try { kill(target(entry), "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      }
      const start = Date.now();
      while (alive(entry)) {
        if (Date.now() - start > 500 && platform !== "win32") {
          try { kill(target(entry), "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
        }
        if (Date.now() - start > 3500) throw hostError("HOST_NATIVE_EXIT_UNCONFIRMED", "A native process group has not exited; its lease is retained.");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (processes.get(entry.pid) === entry) processes.delete(entry.pid);
    })().finally(() => pending.delete(entry.pid));
    pending.set(entry.pid, closing);
    return closing;
  };
  return {
    receive(message) {
      if (!Number.isSafeInteger(message.pid) || message.pid <= 0 || message.pid === process.pid) return;
      if (message.action === "spawn") processes.set(message.pid, { pid: message.pid, grouped: message.grouped === true });
      else if (message.action === "exit") {
        const entry = processes.get(message.pid);
        if (!entry) return;
        if (!entry.grouped) processes.delete(entry.pid);
        else void terminate(entry).catch(() => {});
      }
    },
    async close() {
      const results = await Promise.allSettled([...processes.values()].map(terminate));
      const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
      if (errors.length) throw new AggregateError(errors, "Native process cleanup is incomplete.");
    },
    snapshot: () => [...processes.values()].map((entry) => ({ ...entry })),
  };
}
