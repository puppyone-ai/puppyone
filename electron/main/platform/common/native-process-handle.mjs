import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { reportNativeProcess } from "../../../native-process-ownership.mjs";

const execute = promisify(execFile);

/** Pipe EOF/EPIPE must not remove a Windows leader before taskkill sees it. */
export function afterNativeProcessTermination(handle, finish) {
  if (handle?.termination) void handle.termination.then(ok => { if (ok) finish(); });
  else finish();
}

export function terminateWindowsProcessTree(pid, { run = execute, env = process.env } = {}) {
  const root = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  const executable = path.win32.join(root, "System32", "taskkill.exe");
  if (!path.win32.isAbsolute(executable)) throw new Error("Windows system root must be absolute.");
  return run(executable, ["/PID", String(pid), "/T", "/F"],
    { timeout: 3000, maxBuffer: 8192, windowsHide: true });
}

/** Keep ownership until a requested Windows tree termination is confirmed. */
export function createNativeProcessHandle(child, { grouped = false, platform = process.platform } = {}) {
  const handle = { child, grouped, exited: false };
  const reportExit = reportNativeProcess(child, { grouped, subscribeExit: false });
  let reported = false;
  handle.reportExit = () => {
    if (reported) return;
    reported = true;
    reportExit();
  };
  child.once?.("exit", () => {
    handle.exited = true;
    if (platform === "win32" && handle.termination) {
      void handle.termination.then(ok => { if (ok) handle.reportExit(); });
    } else handle.reportExit();
  });
  return handle;
}

/** Starts bounded cleanup; Windows completion is retained on the handle. */
export function terminateNativeProcess(handle, signal = "SIGTERM", {
  platform = process.platform, processKill = process.kill, run = execute, env = process.env,
} = {}) {
  const child = handle?.child;
  if (!child) return false;
  if (platform === "win32") {
    if (handle.terminationPending) return true;
    if (handle.exited || !Number.isSafeInteger(child.pid) || child.pid <= 0) return false;
    // Publish the promise before invoking taskkill: the leader can exit while
    // taskkill is still terminating its descendants. Never fall back to killing
    // just the leader, which would lose the PID needed to address its tree.
    const completion = Promise.withResolvers();
    handle.termination = completion.promise;
    handle.terminationPending = true;
    const finish = (ok) => {
      handle.terminationPending = false;
      completion.resolve(ok);
      if (ok && handle.exited) handle.reportExit?.();
    };
    try {
      Promise.resolve(terminateWindowsProcessTree(child.pid, { run, env })).then(() => finish(true), () => finish(false));
    } catch { finish(false); }
    return true;
  }
  if (handle.grouped && Number.isSafeInteger(child.pid) && child.pid > 0) {
    try { processKill(-child.pid, signal); return true; } catch { /* Try the direct handle. */ }
  }
  try { child.kill(signal); return true; } catch { return false; }
}
