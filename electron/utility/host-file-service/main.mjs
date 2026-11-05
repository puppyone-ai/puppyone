/**
 * Utility process for remote access to registered folders. Keeps file reads,
 * writes, recursive removal and watchers off the Electron main thread.
 *
 * Main resolves the CURRENT local registration for every request and sends it
 * with the request; this process never accepts a root from the network and
 * never learns account or session state. `forget` drops a folder immediately.
 */
import { createHostFileService, HostFileError } from "../../main/hosts/host-file-service.mjs";

const port = process.parentPort;
const folders = new Map();
const watches = new Map();
const service = createHostFileService({ resolveFolder: async (folderId) => folders.get(folderId) ?? null });

function remember(folderId, folder) {
  if (folder && typeof folder.rootPath === "string") folders.set(folderId, folder);
  else folders.delete(folderId);
}

function stopWatches(folderId) {
  for (const [subscription, watch] of watches) {
    if (folderId && watch.folderId !== folderId) continue;
    watch.stop?.();
    watches.delete(subscription);
  }
}

port.on("message", async ({ data: message }) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "forget") {
    folders.delete(message.folderId);
    stopWatches(message.folderId);
    return;
  }
  if (message.type === "unwatch") {
    watches.get(message.subscription)?.stop?.();
    watches.delete(message.subscription);
    return;
  }
  if (message.type === "watch") {
    remember(message.folderId, message.folder);
    try {
      const stop = await service.watch(message.folderId, (event) => {
        port.postMessage({ type: "event", subscription: message.subscription, ...event });
      });
      if (watches.has(message.subscription)) { stop(); return; }
      watches.set(message.subscription, { folderId: message.folderId, stop });
      port.postMessage({ type: "watching", subscription: message.subscription });
    } catch (error) {
      port.postMessage({ type: "watch_failed", subscription: message.subscription,
        error: error instanceof HostFileError ? error.code : "file_operation_failed" });
    }
    return;
  }
  if (message.type !== "request" || typeof message.id !== "string") return;
  remember(message.request?.folder_id, message.folder);
  try {
    const result = await service.run(message.request);
    port.postMessage({ type: "response", id: message.id, result });
  } catch (error) {
    port.postMessage({ type: "response", id: message.id,
      error: error instanceof HostFileError ? error.code : "file_operation_failed" });
  }
});

process.on("uncaughtException", () => process.exit(70));
port.postMessage({ type: "ready" });
