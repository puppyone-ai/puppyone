import { randomUUID } from "node:crypto";
import { HostFileError } from "./host-file-service.mjs";

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Main-process client for `electron/utility/host-file-service/main.mjs`.
 *
 * Same surface as `createHostFileService` (`run`, `watch`), but the file work
 * happens in a utility process. Main resolves the current registration for each
 * request; a folder that no longer resolves is refused here and never sent.
 * A crashed process fails its in-flight requests (outcome unknown for writes:
 * the gateway reports that) and is restarted on the next request; live
 * watchers receive a reset and are re-established.
 */
export function createHostFileProcess({ utilityProcess, modulePath, resolveFolder, logger = console }) {
  let child = null;
  let ready = null;
  const pending = new Map();
  const watches = new Map();

  function start() {
    if (ready) return ready;
    const process = utilityProcess.fork(modulePath, [], {
      serviceName: "PuppyOne shared folder files", stdio: "ignore",
      execArgv: ["--max-old-space-size=256"],
    });
    child = process;
    ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new HostFileError("file_operation_failed")), 10_000);
      process.on("message", (message) => {
        if (message?.type === "ready") { clearTimeout(timer); resolve(process); return; }
        if (message?.type === "response") {
          const waiter = pending.get(message.id);
          if (!waiter) return;
          pending.delete(message.id); clearTimeout(waiter.timer);
          if (message.error) waiter.reject(new HostFileError(message.error));
          else waiter.resolve(message.result);
        } else if (message?.type === "event") {
          watches.get(message.subscription)?.onEvent({ paths: Array.isArray(message.paths) ? message.paths : [],
            reset: message.reset === true });
        } else if (message?.type === "watching") {
          watches.get(message.subscription)?.started.resolve();
        } else if (message?.type === "watch_failed") {
          const watch = watches.get(message.subscription);
          watches.delete(message.subscription);
          watch?.started.reject(new HostFileError(message.error));
        }
      });
      process.once("exit", (code) => {
        clearTimeout(timer);
        if (child === process) { child = null; ready = null; }
        if (code !== 0) logger.warn?.("Shared folder file process exited", { code });
        for (const [id, waiter] of pending) {
          clearTimeout(waiter.timer); pending.delete(id);
          waiter.reject(new HostFileError("file_operation_failed"));
        }
        reject(new HostFileError("file_operation_failed"));
        // Watchers do not survive the process: ask readers to rescan, then re-arm.
        for (const [subscription, watch] of watches) {
          watch.onEvent({ paths: [], reset: true });
          void arm(subscription, watch).catch(() => { watches.delete(subscription); watch.onEnded?.(); });
        }
      });
    });
    return ready;
  }

  async function arm(subscription, watch) {
    const folder = await resolveFolder(watch.folderId);
    if (!folder) throw new HostFileError("folder_unavailable");
    const process = await start();
    process.postMessage({ type: "watch", subscription, folderId: watch.folderId, folder });
  }

  async function run(request) {
    const folder = await resolveFolder(request?.folder_id);
    if (!folder) throw new HostFileError("folder_unavailable");
    const process = await start();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new HostFileError("file_operation_failed"));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      process.postMessage({ type: "request", id, folder, request });
    });
  }

  async function watch(folderId, onEvent, onEnded) {
    const subscription = randomUUID();
    let resolveStarted, rejectStarted;
    const started = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
    const record = { folderId, onEvent, onEnded, started: { resolve: resolveStarted, reject: rejectStarted } };
    watches.set(subscription, record);
    try {
      await arm(subscription, record);
      await started;
    } catch (error) {
      watches.delete(subscription);
      throw error;
    }
    return () => {
      if (!watches.delete(subscription)) return;
      child?.postMessage({ type: "unwatch", subscription });
    };
  }

  function forget(folderId) {
    for (const [subscription, record] of watches) {
      if (record.folderId === folderId) { watches.delete(subscription); record.onEnded?.(); }
    }
    child?.postMessage({ type: "forget", folderId });
  }

  function dispose() {
    for (const record of watches.values()) record.onEnded?.();
    watches.clear();
    child?.kill();
    child = null; ready = null;
  }

  return Object.freeze({ run, watch, forget, dispose });
}
