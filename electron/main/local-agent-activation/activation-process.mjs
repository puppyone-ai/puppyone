import { spawn } from "node:child_process";
import path from "node:path";
import { reportNativeProcess } from "../../native-process-ownership.mjs";
import { ActivationError } from "./activation-error.mjs";

export function activationEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !/^(NODE_OPTIONS|NODE_PATH|BUN_OPTIONS|ELECTRON_RUN_AS_NODE|DYLD_.*|LD_PRELOAD|LD_LIBRARY_PATH)$/iu.test(key)));
}

/** Private, bounded execution port. No renderer command or raw output crosses IPC. */
export function runActivationProcess(file, args, { signal, env, cwd, timeoutMs = 20_000, spawnProcess = spawn } = {}) {
  if (!path.isAbsolute(file) || !Array.isArray(args) || args.some(arg => typeof arg !== "string" || /[\0\r\n]/u.test(arg))) throw new ActivationError("process");
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    let outputBytes = 0;
    let stdout = ""; let stderr = "";
    let failure = null; let reapTimer;
    const child = spawnProcess(file, args, { env: activationEnvironment(env ?? process.env), cwd,
      shell: false, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    reportNativeProcess(child, { grouped: process.platform !== "win32" });
    const finish = (error, result) => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(reapTimer); signal?.removeEventListener("abort", abort);
      child.stdout?.destroy(); child.stderr?.destroy();
      if (error) reject(error); else resolve(result);
    };
    const terminate = (error) => {
      failure ??= error;
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); }
      catch { try { child.kill("SIGKILL"); } catch { /* Already exited. */ } }
      reapTimer ??= setTimeout(() => finish(failure), 2000);
    };
    const abort = () => terminate(signal.reason ?? new ActivationError("interrupted"));
    const timer = setTimeout(() => terminate(new ActivationError("timeout")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const append = (chunk, stream) => {
      outputBytes += chunk.length;
      if (outputBytes > 512 * 1024) { terminate(new ActivationError("process")); return; }
      if (stream === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
    };
    child.stdout?.on("data", chunk => append(chunk, "stdout"));
    child.stderr?.on("data", chunk => append(chunk, "stderr"));
    child.once("error", () => finish(new ActivationError("process")));
    child.once("close", code => finish(failure, { code, stdout, stderr }));
  });
}
