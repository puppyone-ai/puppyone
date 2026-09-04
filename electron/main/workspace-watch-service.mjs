import fs from "node:fs";
import path from "node:path";
import {
  WORKSPACE_EDIT_REVIEW_FLUSH_DELAY_MS,
  disposeWorkspaceEditReview,
  flushWorkspaceEditReviewChanges,
  initializeWorkspaceEditReview,
  noteWorkspaceEditReviewPath,
} from "../../local-api/edit-review.mjs";
import { getWorkspaceTextVersion } from "../../local-api/workspace.mjs";

export const WORKSPACE_WATCH_REARM_MIN_DELAY_MS = 250;
export const WORKSPACE_WATCH_REARM_MAX_DELAY_MS = 30_000;
export const WORKSPACE_WATCH_MAX_PENDING_PATHS = 4_096;
const WORKSPACE_INTERNAL_WRITE_TTL_MS = 2_000;

let workspaceWatchSubscriptionSequence = 0;

export function createWorkspaceWatchService({ logger = console, fsModule = fs } = {}) {
  const watchers = new Map();
  // Token-based subscriptions: cleanup keys on a unique subscriptionId, not on
  // the sender id or root, so a React Strict Mode setup/cleanup cycle cannot let
  // an old stop remove a newer subscription for the same webContents.
  const subscriptions = new Map();

  function start(sender, rootPath) {
    const resolvedRoot = path.resolve(rootPath);
    let entry = watchers.get(resolvedRoot);

    if (!entry) {
      entry = createWatcher(resolvedRoot, logger, fsModule);
      watchers.set(resolvedRoot, entry);
    }

    const subscriptionId = `workspace-watch-${(workspaceWatchSubscriptionSequence += 1)}-${Date.now().toString(36)}`;
    const onSenderDestroyed = () => stop(subscriptionId);
    entry.clients.set(subscriptionId, sender);
    subscriptions.set(subscriptionId, {
      root: resolvedRoot,
      senderId: sender.id,
      sender,
      onSenderDestroyed,
    });
    if (typeof sender.once === "function") {
      sender.once("destroyed", onSenderDestroyed);
    }

    return { subscriptionId, rootPath: resolvedRoot };
  }

  function subscribeActivity(rootPath, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("A workspace activity listener is required.");
    }
    const resolvedRoot = path.resolve(rootPath);
    let entry = watchers.get(resolvedRoot);
    if (!entry) {
      entry = createWatcher(resolvedRoot, logger, fsModule);
      watchers.set(resolvedRoot, entry);
    }
    const token = Symbol(resolvedRoot);
    entry.activityListeners.set(token, listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      entry.activityListeners.delete(token);
      disposeEntryIfUnused(entry, resolvedRoot);
    };
  }

  function stop(subscriptionId, expectedSenderId = null) {
    const subscription = subscriptions.get(subscriptionId);
    if (!subscription) return { ok: true };
    if (expectedSenderId !== null && subscription.senderId !== expectedSenderId) {
      return { ok: true };
    }
    subscriptions.delete(subscriptionId);
    subscription.sender.removeListener?.("destroyed", subscription.onSenderDestroyed);

    const entry = watchers.get(subscription.root);
    if (!entry) return { ok: true };

    entry.clients.delete(subscriptionId);
    disposeEntryIfUnused(entry, subscription.root);
    return { ok: true };
  }

  function stopForWindow(webContentsId) {
    for (const [subscriptionId, subscription] of Array.from(subscriptions.entries())) {
      if (subscription.senderId === webContentsId) stop(subscriptionId);
    }
  }

  function stopForWorkspaceRoot(webContentsId, rootPath) {
    const resolvedRoot = typeof rootPath === "string" && rootPath.trim()
      ? path.resolve(rootPath)
      : null;
    if (!Number.isInteger(webContentsId) || !resolvedRoot) return 0;
    let stopped = 0;
    for (const [subscriptionId, subscription] of Array.from(subscriptions.entries())) {
      if (subscription.senderId !== webContentsId || subscription.root !== resolvedRoot) continue;
      stop(subscriptionId);
      stopped += 1;
    }
    return stopped;
  }

  function closeAll() {
    for (const subscriptionId of Array.from(subscriptions.keys())) {
      stop(subscriptionId);
    }
    for (const [rootPath, entry] of Array.from(watchers.entries())) {
      disposeWatcher(entry, rootPath);
    }
    watchers.clear();
    subscriptions.clear();
  }

  function disposeEntryIfUnused(entry, rootPath) {
    if (entry.clients.size > 0 || entry.activityListeners.size > 0) return;
    disposeWatcher(entry, rootPath);
    if (watchers.get(rootPath) === entry) watchers.delete(rootPath);
  }

  function noteInternalWrite(request) {
    const rootPath = request?.rootPath;
    const relativePath = normalizeWorkspaceRelativePath(request?.path);
    const senderId = request?.senderId;
    const version = normalizeWorkspaceTextVersion(request?.version);
    if (
      typeof rootPath !== "string"
      || !relativePath
      || !version
      || !Number.isSafeInteger(senderId)
      || senderId <= 0
    ) {
      return { tracked: false };
    }

    const entry = watchers.get(path.resolve(rootPath));
    if (!entry || entry.disposed) return { tracked: false };

    const now = Date.now();
    pruneExpiredInternalWrites(entry, now);
    entry.internalWrites.set(relativePath, {
      senderId,
      version,
      expiresAt: now + WORKSPACE_INTERNAL_WRITE_TTL_MS,
    });
    return { tracked: true };
  }

  return {
    start,
    stop,
    stopForWindow,
    stopForWorkspaceRoot,
    closeAll,
    noteInternalWrite,
    subscribeActivity,
    getWatcherCount: () => watchers.size,
  };
}

function createWatcher(rootPath, logger, fsModule) {
  const clients = new Map();
  const entry = {
    clients,
    activityListeners: new Map(),
    debounceTimer: null,
    editReviewTimer: null,
    lastEvent: null,
    pendingPaths: new Set(),
    pendingUnknownPath: false,
    internalWrites: new Map(),
    watcher: null,
    rearmTimer: null,
    rearmDelay: WORKSPACE_WATCH_REARM_MIN_DELAY_MS,
    disposed: false,
    rootPath,
    logger,
    fsModule,
  };

  void initializeWorkspaceEditReview(rootPath).catch((error) => {
    logger.warn("Unable to initialize edit review baseline:", error);
  });

  armWorkspaceWatcher(entry);
  return entry;
}

function armWorkspaceWatcher(entry) {
  if (entry.disposed) return false;
  clearTimeout(entry.rearmTimer);
  entry.rearmTimer = null;

  if (entry.watcher) {
    try {
      entry.watcher.close();
    } catch {
      // Best-effort close before re-arm.
    }
    entry.watcher = null;
  }

  try {
    entry.watcher = entry.fsModule.watch(entry.rootPath, { recursive: true }, (eventType, filename) => {
      if (entry.disposed) return;
      if (shouldIgnoreWorkspaceChange(filename)) return;

      const eventPath = normalizeWorkspaceRelativePath(
        typeof filename === "string" ? filename : null,
      );
      if (eventPath && !entry.pendingUnknownPath) {
        if (entry.pendingPaths.size < WORKSPACE_WATCH_MAX_PENDING_PATHS) {
          entry.pendingPaths.add(eventPath);
        } else {
          // Never grow an unbounded IPC payload during generated-file storms.
          // A root-scoped bulk invalidation is conservative and lossless.
          entry.pendingPaths.clear();
          entry.pendingUnknownPath = true;
        }
      } else if (!eventPath) {
        entry.pendingPaths.clear();
        entry.pendingUnknownPath = true;
      }
      entry.lastEvent = {
        rootPath: entry.rootPath,
        eventType: eventType ?? "change",
        path: eventPath,
      };
      notifyWorkspaceActivity(entry);
      noteWorkspaceEditReviewPath(entry.rootPath, eventPath);
      scheduleWorkspaceEditReviewFlush(entry);
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = setTimeout(() => {
        broadcastWorkspaceChange(entry);
      }, 200);
      if (typeof entry.debounceTimer.unref === "function") entry.debounceTimer.unref();

      // Rename of the watched root (or empty filename) often means the watch
      // handle is dead; re-arm so subsequent edits keep flowing.
      if (eventType === "rename" && (!filename || filename === "" || filename === ".")) {
        scheduleWorkspaceRearm(entry, "watcher-recovered");
      }
    });

    entry.watcher.on("error", (error) => {
      if (entry.disposed) return;
      entry.lastEvent = {
        rootPath: entry.rootPath,
        eventType: "error",
        path: null,
        error: error instanceof Error ? error.message : String(error),
      };
      notifyWorkspaceActivity(entry);
      broadcastWorkspaceChange(entry);
      scheduleWorkspaceRearm(entry, "watcher-error");
    });

    entry.rearmDelay = WORKSPACE_WATCH_REARM_MIN_DELAY_MS;
    return true;
  } catch (error) {
    entry.lastEvent = {
      rootPath: entry.rootPath,
      eventType: "error",
      path: null,
      error: error instanceof Error ? error.message : String(error),
    };
    broadcastWorkspaceChange(entry);
    scheduleWorkspaceRearm(entry, "watcher-error");
    return false;
  }
}

function scheduleWorkspaceRearm(entry, reason) {
  if (entry.disposed || entry.rearmTimer) return;
  const delay = entry.rearmDelay;
  entry.rearmDelay = Math.min(entry.rearmDelay * 2, WORKSPACE_WATCH_REARM_MAX_DELAY_MS);
  entry.logger.warn?.("workspace content watcher re-arm scheduled", {
    rootPath: entry.rootPath,
    reason,
    delayMs: delay,
  });
  entry.rearmTimer = setTimeout(() => {
    entry.rearmTimer = null;
    if (entry.disposed) return;
    if (!armWorkspaceWatcher(entry)) return;
    entry.lastEvent = {
      rootPath: entry.rootPath,
      eventType: "change",
      path: null,
      recovered: true,
      reason,
    };
    notifyWorkspaceActivity(entry);
    broadcastWorkspaceChange(entry);
  }, delay);
  if (typeof entry.rearmTimer.unref === "function") entry.rearmTimer.unref();
}

function disposeWatcher(entry, rootPath) {
  entry.disposed = true;
  clearTimeout(entry.debounceTimer);
  clearTimeout(entry.editReviewTimer);
  clearTimeout(entry.rearmTimer);
  entry.debounceTimer = null;
  entry.editReviewTimer = null;
  entry.rearmTimer = null;
  entry.internalWrites.clear();
  entry.pendingPaths.clear();
  entry.pendingUnknownPath = false;
  if (entry.watcher) {
    try {
      entry.watcher.close();
    } catch {
      // Best-effort.
    }
    entry.watcher = null;
  }
  disposeWorkspaceEditReview(rootPath);
  entry.clients.clear();
}

function notifyWorkspaceActivity(entry) {
  for (const listener of entry.activityListeners.values()) {
    try {
      listener(entry.lastEvent);
    } catch (error) {
      entry.logger.warn?.("Workspace activity listener failed:", error);
    }
  }
}

function scheduleWorkspaceEditReviewFlush(entry) {
  clearTimeout(entry.editReviewTimer);
  entry.editReviewTimer = setTimeout(() => {
    entry.editReviewTimer = null;
    void flushWorkspaceEditReviewChanges(entry.rootPath)
      .then((request) => {
        if (request) broadcastWorkspaceEditReviewChange(entry, entry.rootPath, request);
      })
      .catch((error) => {
        entry.logger.warn("Unable to flush edit review changes:", error);
      });
  }, WORKSPACE_EDIT_REVIEW_FLUSH_DELAY_MS);
  if (typeof entry.editReviewTimer.unref === "function") entry.editReviewTimer.unref();
}

function broadcastWorkspaceChange(entry) {
  if (!entry.lastEvent) return;

  const paths = [...entry.pendingPaths];
  const unknownPath = entry.pendingUnknownPath || paths.length === 0;
  entry.pendingPaths.clear();
  entry.pendingUnknownPath = false;
  const event = {
    ...entry.lastEvent,
    path: !unknownPath && paths.length === 1 ? paths[0] : null,
    ...(unknownPath ? {} : { paths }),
  };
  if (unknownPath || paths.length === 0) {
    deliverWorkspaceChange(entry, event, new Map());
    return;
  }

  const now = Date.now();
  const internalWrites = paths.map((eventPath) => ({
    eventPath,
    internalWrite: findInternalWrite(entry, eventPath, now),
  }));
  if (internalWrites.every(({ internalWrite }) => !internalWrite)) {
    deliverWorkspaceChange(entry, event, new Map());
    return;
  }

  void Promise.all(internalWrites.map(async ({ eventPath, internalWrite }) => {
    if (!internalWrite) return [eventPath, null];
    try {
      const matches = await internalWriteMatchesDisk(entry, eventPath, internalWrite);
      if (!matches && entry.internalWrites.get(eventPath) === internalWrite) {
        entry.internalWrites.delete(eventPath);
      }
      return [eventPath, matches ? internalWrite.senderId : null];
    } catch {
      if (entry.internalWrites.get(eventPath) === internalWrite) {
        entry.internalWrites.delete(eventPath);
      }
      return [eventPath, null];
    }
  })).then((suppressionEntries) => {
    deliverWorkspaceChange(entry, event, new Map(suppressionEntries));
  });
}

function deliverWorkspaceChange(entry, event, suppressedSendersByPath) {
  if (entry.disposed) return;
  for (const [id, sender] of entry.clients.entries()) {
    if (typeof sender.isDestroyed === "function" && sender.isDestroyed()) {
      entry.clients.delete(id);
      continue;
    }
    const visiblePaths = Array.isArray(event.paths)
      ? event.paths.filter((eventPath) => suppressedSendersByPath.get(eventPath) !== sender.id)
      : null;
    if (visiblePaths && visiblePaths.length === 0) continue;
    const payload = visiblePaths
      ? {
          ...event,
          paths: visiblePaths,
          path: visiblePaths.length === 1 ? visiblePaths[0] : null,
        }
      : event;
    try {
      sender.send("workspace:changed", payload);
    } catch {
      entry.clients.delete(id);
    }
  }
}

function findInternalWrite(entry, relativePath, now) {
  pruneExpiredInternalWrites(entry, now);
  return entry.internalWrites.get(relativePath) ?? null;
}

function pruneExpiredInternalWrites(entry, now) {
  for (const [relativePath, internalWrite] of entry.internalWrites.entries()) {
    if (internalWrite.expiresAt < now) entry.internalWrites.delete(relativePath);
  }
}

async function internalWriteMatchesDisk(entry, relativePath, internalWrite) {
  const readFile = entry.fsModule.promises?.readFile;
  if (typeof readFile !== "function") return false;

  const absolutePath = path.resolve(
    entry.rootPath,
    relativePath.split("/").join(path.sep),
  );
  const pathFromRoot = path.relative(entry.rootPath, absolutePath);
  if (pathFromRoot.startsWith("..") || path.isAbsolute(pathFromRoot)) return false;

  const bytes = await readFile.call(entry.fsModule.promises, absolutePath);
  const version = getWorkspaceTextVersion(bytes);
  return version === internalWrite.version;
}

function broadcastWorkspaceEditReviewChange(entry, rootPath, request) {
  for (const [id, sender] of entry.clients.entries()) {
    if (typeof sender.isDestroyed === "function" && sender.isDestroyed()) {
      entry.clients.delete(id);
      continue;
    }
    try {
      sender.send("ai-edit-review:updated", {
        rootPath,
        request,
      });
    } catch {
      entry.clients.delete(id);
    }
  }
}

function shouldIgnoreWorkspaceChange(filename) {
  if (!filename) return false;
  const normalized = String(filename).replaceAll("\\", "/");
  return (
    normalized === ".git"
    || normalized.startsWith(".git/")
    || /(^|\/)\.[^/]+\.puppyone-\d+-[0-9a-f-]+\.tmp$/i.test(normalized)
  );
}

function normalizeWorkspaceRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const normalized = path.posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//, "");
  return normalized && normalized !== "." ? normalized : null;
}

function normalizeWorkspaceTextVersion(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value)
    ? value
    : null;
}
