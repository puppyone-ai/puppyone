import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPresetViewerDefinitionForViewerId } from "../viewer-packs/preset-viewer-manifest.mjs";

const ALLOWED_RESOURCE_PROTOCOLS = new Set(["puppyone-local:", "https:"]);
const APPEARANCE_ATTRIBUTE_PATTERN = /^data-[a-z0-9-]{1,80}$/;
const APPEARANCE_VARIABLE_PATTERN = /^--po-[a-z0-9-]{1,80}$/;
const UNRESPONSIVE_TIMEOUT_MS = 12_000;
const NAVIGATION_TIMEOUT_MS = 15_000;
const VIEWER_ATTACH_TIMEOUT_MS = 10_000;
const CHROMIUM_PDF_VIEWER_URL_PREFIX =
  "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";
const MAX_SESSIONS_PER_OWNER = 8;
const MAX_SESSIONS_TOTAL = 24;

/** Owns one sandboxed built-in Viewer runtime per committed Editor pane. */
export function createEditorSurfaceSessionManager({
  WebContentsView,
  browserSession,
  getOwnerWindow,
  nativeSurfaceOcclusion = null,
  nativeSurfacePointerPassthrough = null,
  admitResource = null,
  navigationTimeoutMs = NAVIGATION_TIMEOUT_MS,
  viewerAttachTimeoutMs = VIEWER_ATTACH_TIMEOUT_MS,
  onStateChange = null,
  logger = console,
}) {
  const sessions = new Map();

  function publish(entry, status, details = {}) {
    entry.status = status;
    const event = {
      sessionId: entry.sessionId,
      viewerId: entry.viewerId,
      status,
      ...details,
    };
    try {
      onStateChange?.(event);
    } catch (error) {
      logger.warn?.("Editor Surface state observer failed:", error);
    }
    if (entry.window?.isDestroyed?.() || entry.window?.webContents?.isDestroyed?.()) return;
    try { entry.window.webContents.send("editor-surface:state", event); }
    catch (error) { logger.warn?.("Editor Surface owner notification failed:", error); }
  }

  function destroySession(sessionId, { reason = "disposed", publishDisposed = false } = {}) {
    const entry = sessions.get(sessionId);
    if (!entry) return Promise.resolve(false);
    if (entry.retirement) return entry.retirement;
    entry.retiring = true;
    entry.retirement = (async () => {
      if (entry.unresponsiveTimer) clearTimeout(entry.unresponsiveTimer);
      if (entry.navigationTimer) clearTimeout(entry.navigationTimer);
      entry.unresponsiveTimer = null;
      entry.navigationTimer = null;
      entry.releaseOcclusion?.();
      entry.releasePointerPassthrough?.();
      for (const [emitter, eventName, listener] of entry.listeners) {
        try {
          emitter.removeListener?.(eventName, listener);
        } catch {
          // Native teardown may race process termination.
        }
      }
      entry.listeners = [];
      try {
        entry.view.setVisible?.(false);
        entry.view.webContents?.setAudioMuted?.(true);
      } catch {
        // Ignore a renderer that already exited.
      }
      try {
        if (!entry.window.isDestroyed() && entry.window.contentView) {
          entry.window.contentView.removeChildView(entry.view);
        }
      } catch {
        // Ignore detach races.
      }
      await closeEditorWebContents(entry.view.webContents);
      sessions.delete(sessionId);
      if (publishDisposed) publish(entry, "disposed", { reason });
      return true;
    })().catch((error) => {
      entry.retirement = null;
      publish(entry, "error", { reason: "exit-unconfirmed", message: normalizeMessage(error) });
      throw error;
    });
    return entry.retirement;
  }

  function applyVisibility(entry) {
    const visible = entry.attached
      && !entry.retiring
      && entry.visible
      && entry.geometryVisible
      && !entry.occluded
      && entry.status !== "crashed"
      && entry.status !== "unresponsive";
    try {
      entry.view.setVisible?.(visible);
      entry.view.webContents?.setAudioMuted?.(!visible);
    } catch {
      // A dead renderer is handled by render-process-gone.
    }
  }

  async function navigate(entry) {
    const timeout = new Promise((_, reject) => {
      entry.navigationTimer = setTimeout(() => {
        entry.navigationTimer = null;
        const error = new Error("Editor Surface navigation timed out.");
        error.code = "navigation-timeout";
        reject(error);
      }, navigationTimeoutMs);
      entry.navigationTimer.unref?.();
    });
    try {
      await Promise.race([entry.view.webContents.loadURL(entry.navigationUrl), timeout]);
    } finally {
      if (entry.navigationTimer) clearTimeout(entry.navigationTimer);
      entry.navigationTimer = null;
    }
  }

  async function waitForChromiumPdfViewer(entry) {
    const deadline = Date.now() + viewerAttachTimeoutMs;
    do {
      if (sessions.get(entry.sessionId) !== entry) {
        throw new Error("Editor Surface was disposed while attaching its native Viewer.");
      }
      if (hasFrameWithUrlPrefix(entry.view.webContents.mainFrame, CHROMIUM_PDF_VIEWER_URL_PREFIX)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    const error = new Error("Chromium PDF Viewer did not attach in time.");
    error.code = "viewer-attach-timeout";
    throw error;
  }

  return Object.freeze({
    async activate(request) {
      const ownerWebContentsId = requirePositiveInteger(
        request?.ownerWebContentsId,
        "Editor Surface owner is invalid.",
      );
      const window = getOwnerWindow(ownerWebContentsId);
      if (!window || window.isDestroyed()) throw new Error("Editor Surface owner is unavailable.");
      if (sessions.size >= MAX_SESSIONS_TOTAL) {
        throw new Error("Editor Surface process budget is exhausted.");
      }
      const ownerSessionCount = [...sessions.values()].filter(
        (entry) => entry.ownerWebContentsId === ownerWebContentsId,
      ).length;
      if (ownerSessionCount >= MAX_SESSIONS_PER_OWNER) {
        throw new Error("This window has reached its Editor Surface process budget.");
      }
      const viewerId = requireString(request?.viewerId, "Editor Surface Viewer id is required.", 100);
      const definition = getPresetViewerDefinitionForViewerId(viewerId);
      if (
        definition.id !== viewerId
        || definition.surfaceIsolation !== "isolated-webcontents"
        || definition.computeIsolation !== "browser-engine"
      ) {
        throw new Error(`Preset Viewer ${viewerId} is not admitted to a browser-engine runtime.`);
      }
      const resourceUrl = normalizeResourceUrl(request?.resourceUrl);
      const admission = await admitResource?.({
        resourceUrl,
        ownerWebContentsId,
        resourcePolicy: definition.resourcePolicy,
      });
      // Admission is asynchronous; both the owner and capacity may have changed.
      if (window.isDestroyed() || window.webContents.isDestroyed()) throw new Error("Editor Surface owner is unavailable.");
      if (sessions.size >= MAX_SESSIONS_TOTAL
        || [...sessions.values()].filter((entry) => entry.ownerWebContentsId === ownerWebContentsId).length >= MAX_SESSIONS_PER_OWNER) {
        throw new Error("Editor Surface process budget is exhausted.");
      }
      const admittedNavigationUrl = normalizeBrowserEngineNavigationUrl(admission?.navigationUrl);
      const navigationUrl = viewerId === "pdf-preview"
        ? configureChromiumPdfViewerUrl(admittedNavigationUrl)
        : admittedNavigationUrl;
      const title = requireString(request?.title, "Editor Surface title is required.", 500);
      const bounds = normalizeBounds(request?.bounds, window);
      const geometryRevision = normalizeGeometryRevision(request?.geometryRevision, 0);
      const appearance = normalizeAppearance(request?.appearance);
      const documentPath = requireString(request?.documentPath, "Document path is required.", 4_096);
      const safeMode = false;
      const sessionId = `bes_${randomUUID()}`;
      // Chromium's built-in PDF extension does not initialize inside an
      // ephemeral Electron partition created after the App Shell. The host
      // supplies one dedicated persistent browser session so PDFium works
      // without sharing the App Shell's cookies or storage.
      if (!browserSession) throw new Error("Editor Surface browser session is unavailable.");

      const view = new WebContentsView({
        webPreferences: {
          session: browserSession,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false,
          webSecurity: true,
          webviewTag: false,
          plugins: true,
          spellcheck: false,
          devTools: false,
          backgroundThrottling: false,
        },
      });
      const entry = {
        sessionId,
        viewerId,
        documentPath,
        documentRevision: typeof request?.documentRevision === "string"
          ? request.documentRevision.slice(0, 500)
          : null,
        resourceUrl,
        navigationUrl,
        title,
        safeMode,
        resourcePolicy: definition.resourcePolicy,
        appearance,
        ownerWebContentsId,
        window,
        view,
        browserSession,
        requestedBounds: bounds,
        geometryRevision,
        geometryVisible: request?.visible !== false,
        attached: false,
        visible: true,
        occluded: false,
        status: "creating",
        listeners: [],
        releaseOcclusion: null,
        releasePointerPassthrough: null,
        unresponsiveTimer: null,
        navigationTimer: null,
        statusBeforeUnresponsive: null,
      };
      sessions.set(sessionId, entry);
      try {
        view.setBounds(bounds);
        view.setBackgroundColor?.(appearance.dark ? "#202124" : "#f1f3f4");
        view.setVisible?.(false);
        view.webContents?.setAudioMuted?.(true);
        installNavigationGuard(view.webContents, navigationUrl);

        entry.releaseOcclusion = nativeSurfaceOcclusion?.register?.({
          ownerWebContentsId,
          setOccluded: (occluded) => {
            entry.occluded = occluded;
            if (sessions.get(sessionId) === entry) applyVisibility(entry);
          },
        }) ?? null;
        entry.releasePointerPassthrough = nativeSurfacePointerPassthrough?.register?.({
          ownerWebContentsId,
          ownerWebContents: window.webContents,
          surfaceView: view,
        }) ?? null;
        window.contentView.addChildView(view);
        entry.attached = true;
        applyVisibility(entry);

        listen(entry, window, "closed", () => {
          void destroySession(sessionId, { reason: "owner-closed" }).catch((error) => console.warn("Editor Surface cleanup failed:", error));
        });
        listen(entry, window, "hide", () => {
          entry.visible = false;
          applyVisibility(entry);
        });
        listen(entry, window, "show", () => {
          entry.visible = true;
          applyVisibility(entry);
        });
        listen(entry, view.webContents, "render-process-gone", (_event, details) => {
          publish(entry, "crashed", {
            reason: normalizeGoneReason(details?.reason),
            exitCode: Number.isSafeInteger(details?.exitCode) ? details.exitCode : null,
          });
          void destroySession(sessionId, { reason: "render-process-gone" }).catch((error) => console.warn("Editor Surface cleanup failed:", error));
        });
        listen(entry, view.webContents, "unresponsive", () => {
          if (entry.status !== "unresponsive") entry.statusBeforeUnresponsive = entry.status;
          publish(entry, "unresponsive");
          applyVisibility(entry);
          entry.unresponsiveTimer = setTimeout(() => {
            if (sessions.get(sessionId) !== entry || entry.status !== "unresponsive") return;
            try {
              entry.view.webContents.forcefullyCrashRenderer();
            } catch (error) {
              logger.warn?.("Unable to terminate unresponsive Editor Surface:", error);
            }
          }, UNRESPONSIVE_TIMEOUT_MS);
        });
        listen(entry, view.webContents, "responsive", () => {
          if (entry.unresponsiveTimer) clearTimeout(entry.unresponsiveTimer);
          entry.unresponsiveTimer = null;
          const recoveredStatus = entry.statusBeforeUnresponsive === "ready" ? "ready" : "loading";
          entry.statusBeforeUnresponsive = null;
          publish(entry, recoveredStatus);
          applyVisibility(entry);
        });

        publish(entry, "loading");
        await navigate(entry);
        if (sessions.get(sessionId) !== entry) throw new Error("Editor Surface was disposed while loading.");
        await waitForChromiumPdfViewer(entry);
        publish(entry, "ready");
        applyVisibility(entry);
      } catch (error) {
        if (sessions.get(sessionId) !== entry) throw error;
        const timedOut = error?.code === "navigation-timeout" || error?.code === "viewer-attach-timeout";
        publish(entry, timedOut ? "error" : "crashed", {
          reason: timedOut ? error.code : "launch-failed",
          message: normalizeMessage(error),
        });
        await destroySession(sessionId, { reason: "launch-failed" });
        throw error;
      }

      return {
        sessionId,
        viewerId,
        safeMode,
        processId: view.webContents.getOSProcessId?.() ?? null,
        status: entry.status,
      };
    },

    setBounds(sessionId, bounds, ownerWebContentsId, geometryRevision, visible) {
      const entry = sessions.get(sessionId);
      if (!entry || entry.ownerWebContentsId !== ownerWebContentsId) return { ok: false };
      const nextRevision = normalizeGeometryRevision(
        geometryRevision,
        entry.geometryRevision + 1,
      );
      if (nextRevision <= entry.geometryRevision) {
        return { ok: true, applied: false, geometryRevision: entry.geometryRevision };
      }
      entry.geometryRevision = nextRevision;
      entry.requestedBounds = normalizeBounds(bounds, entry.window);
      entry.geometryVisible = visible !== false;
      entry.view.setBounds(entry.requestedBounds);
      applyVisibility(entry);
      return { ok: true, applied: true, geometryRevision: entry.geometryRevision };
    },

    updateAppearance(sessionId, appearance, ownerWebContentsId) {
      const entry = sessions.get(sessionId);
      if (!entry || entry.ownerWebContentsId !== ownerWebContentsId) return { ok: false };
      entry.appearance = normalizeAppearance(appearance);
      entry.view.setBackgroundColor?.(entry.appearance.dark ? "#202124" : "#f1f3f4");
      return { ok: true };
    },

    async destroy(sessionId, ownerWebContentsId) {
      const entry = sessions.get(sessionId);
      if (!entry || entry.ownerWebContentsId !== ownerWebContentsId) return { ok: false };
      return { ok: await destroySession(sessionId) };
    },


    async destroyForOwner(ownerWebContentsId) {
      const results = await Promise.allSettled([...sessions].filter(([, entry]) => entry.ownerWebContentsId === ownerWebContentsId)
        .map(([id]) => destroySession(id, { reason: "owner-released" })));
      const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      if (failures.length) throw new AggregateError(failures, "Editor Surface retirement failed.");
    },

    async destroyForResource(ownerWebContentsId, resourcePath) {
      const matching = [...sessions].filter(([, entry]) => {
        if (entry.ownerWebContentsId !== ownerWebContentsId) return false;
        if (new URL(entry.navigationUrl).protocol !== "file:") return false;
        const relative = path.relative(path.resolve(resourcePath), fileURLToPath(entry.navigationUrl));
        return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
      });
      const results = await Promise.allSettled(matching.map(([id]) => destroySession(id)));
      const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      if (failures.length) throw new AggregateError(failures, "Editor resource surfaces have not exited.");
    },

    async destroyAll() {
      const results = await Promise.allSettled([...sessions.keys()].map((id) => destroySession(id)));
      const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      if (failures.length) throw new AggregateError(failures, "Editor Surface retirement failed.");
    },

    values() {
      return [...sessions.values()];
    },
  });
}

function listen(entry, emitter, eventName, listener) {
  emitter.on?.(eventName, listener);
  entry.listeners.push([emitter, eventName, listener]);
}

function closeEditorWebContents(contents) {
  if (!contents || contents.isDestroyed()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); contents.removeListener("destroyed", destroyed); };
    const destroyed = () => { cleanup(); resolve(); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("Editor WebContents did not confirm destruction.")); }, 4_000);
    contents.once("destroyed", destroyed);
    try {
      // WebContents.close is the public Electron API. Removing a child view
      // or calling an optional nonexistent destroy method does not release it.
      contents.close({ waitForBeforeUnload: false });
      if (contents.isDestroyed()) destroyed();
    } catch (error) {
      cleanup();
      if (contents.isDestroyed()) resolve();
      else reject(error);
    }
  });
}

function installNavigationGuard(webContents, navigationUrl) {
  const trusted = new URL(navigationUrl);
  webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
  webContents.on?.("will-navigate", (event, target) => {
    const next = new URL(target);
    if (next.protocol === trusted.protocol && next.origin === trusted.origin && next.pathname === trusted.pathname) {
      return;
    }
    event.preventDefault();
  });
}

function hasFrameWithUrlPrefix(frame, prefix) {
  if (!frame) return false;
  const pending = [...(frame.frames ?? [])];
  while (pending.length > 0) {
    const candidate = pending.shift();
    if (candidate?.url?.startsWith(prefix)) return true;
    pending.push(...(candidate?.frames ?? []));
  }
  return false;
}

function normalizeBrowserEngineNavigationUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Browser-engine Editor Surface resource was not admitted.");
  }
  const url = new URL(value);
  if (
    (url.protocol !== "file:" && url.protocol !== "https:")
    || url.username
    || url.password
  ) {
    throw new Error("Browser-engine Editor Surface navigation URL is not allowed.");
  }
  return url.toString();
}

/**
 * Keeps Chromium/PDFium as the PDF runtime while removing browser-owned chrome.
 * These fragment parameters are part of Chromium's supported PDF open-parameter
 * contract, so this does not depend on the component extension's private DOM.
 */
function configureChromiumPdfViewerUrl(value) {
  const url = new URL(value);
  const rawFragment = url.hash.slice(1);
  const params = new URLSearchParams();

  if (rawFragment) {
    if (!rawFragment.includes("=") && !rawFragment.includes("&")) {
      params.set("nameddest", safelyDecodeURIComponent(rawFragment));
    } else {
      const existing = new URLSearchParams(rawFragment);
      for (const [name, fragmentValue] of existing) params.append(name, fragmentValue);
    }
  }

  params.set("toolbar", "0");
  params.set("navpanes", "0");
  url.hash = params.toString();
  return url.toString();
}

function safelyDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeBounds(value, window) {
  const [contentWidth, contentHeight] = window.getContentSize?.() ?? [1, 1];
  const x = clampInteger(value?.x, 0, Math.max(0, contentWidth - 1));
  const y = clampInteger(value?.y, 0, Math.max(0, contentHeight - 1));
  return {
    x,
    y,
    width: clampInteger(value?.width, 1, Math.max(1, contentWidth - x)),
    height: clampInteger(value?.height, 1, Math.max(1, contentHeight - y)),
  };
}

function normalizeGeometryRevision(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Editor Surface geometry revision is invalid.");
  }
  return value;
}

function normalizeResourceUrl(value) {
  const raw = requireString(value, "Editor Surface resource URL is required.", 16_384);
  const parsed = new URL(raw);
  if (!ALLOWED_RESOURCE_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Editor Surface resource URL is not allowed.");
  }
  return parsed.toString();
}

function normalizeAppearance(value) {
  const attributes = {};
  const variables = {};
  for (const [name, raw] of Object.entries(value?.attributes ?? {}).slice(0, 32)) {
    if (APPEARANCE_ATTRIBUTE_PATTERN.test(name) && typeof raw === "string") {
      attributes[name] = raw.slice(0, 200);
    }
  }
  for (const [name, raw] of Object.entries(value?.variables ?? {}).slice(0, 128)) {
    if (APPEARANCE_VARIABLE_PATTERN.test(name) && typeof raw === "string") {
      variables[name] = raw.slice(0, 500);
    }
  }
  return Object.freeze({
    dark: value?.dark === true,
    direction: value?.direction === "rtl" ? "rtl" : "ltr",
    attributes: Object.freeze(attributes),
    variables: Object.freeze(variables),
  });
}

function normalizeGoneReason(value) {
  return typeof value === "string" && value.length <= 80 ? value : "unknown";
}

function normalizeMessage(value) {
  const message = value instanceof Error ? value.message : String(value ?? "Editor Surface failed.");
  return message.slice(0, 1_000);
}

function requireString(value, message, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new Error(message);
  return value.trim();
}

function requirePositiveInteger(value, message) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(message);
  return value;
}

function clampInteger(value, minimum, maximum) {
  const normalized = Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(maximum, Math.max(minimum, normalized));
}
