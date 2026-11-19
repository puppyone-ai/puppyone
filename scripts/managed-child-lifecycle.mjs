import { setTimeout as delay } from "node:timers/promises";
import { terminateManagedChild } from "./managed-child-process.mjs";

export function registerDevelopmentShutdown({ target = process, shutdown, logger = console }) {
  let closing = false, fatalReported = false;
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    // Keep listeners until process exit: a second Ctrl+C must not restore the
    // default abrupt exit while owned descendant cleanup is still pending.
    target.on(signal, () => {
      if (closing) return;
      closing = true;
      shutdown(code);
    });
  }
  for (const event of ["uncaughtException", "unhandledRejection"]) {
    target.on(event, error => {
      if (fatalReported) return;
      fatalReported = true;
      closing = true;
      try { logger.error(`[desktop-dev] Fatal launcher ${event}:`, error); }
      catch { /* A closed terminal/log sink must not bypass owned cleanup. */ }
      shutdown(1);
    });
  }
}

// Await teardown, including descendants that outlive an npm/CLI wrapper. Only
// use this for a detached process group created and owned by this launcher.
export async function stopOwnedChild(child, {
  graceMs = 5_000,
  killWaitMs = 2_000,
  platform = process.platform,
  processKill = process.kill.bind(process),
} = {}) {
  if (!child || !Number.isInteger(child.pid)) return;
  const groupId = child.pid;
  const isAlive = () => {
    if (platform === "win32") return child.exitCode === null && child.signalCode === null;
    try {
      processKill(-groupId, 0);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      throw error;
    }
  };
  const signalGroup = (signal) => {
    if (platform === "win32") return terminateManagedChild(child, signal, { platform });
    try { processKill(-groupId, signal); }
    catch (error) { if (error?.code !== "ESRCH") throw error; }
  };
  const waitUntil = async (deadline) => {
    while (isAlive() && Date.now() < deadline) await delay(25);
    return !isAlive();
  };

  if (!isAlive()) return;
  signalGroup("SIGTERM");
  if (await waitUntil(Date.now() + graceMs)) return;
  signalGroup("SIGKILL");
  if (!await waitUntil(Date.now() + killWaitMs)) {
    throw new Error(`Owned development process group ${groupId} did not exit.`);
  }
}
