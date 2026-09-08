import { randomUUID } from "node:crypto";

export const DOCUMENT_SESSION_FLUSH_REQUEST_CHANNEL = "document-session:flush-requested";
export const DOCUMENT_SESSION_FLUSH_RESULT_CHANNEL = "document-session:flush-result";
export const DOCUMENT_SESSION_CLOSE_CANCELLED_CHANNEL = "document-session:close-cancelled";

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_DIALOG_MESSAGES = Object.freeze({
  "native.projectClose.message": "Some project tasks have not stopped yet.",
  "native.projectClose.detail": "The window will stay open. Try closing it again to finish stopping these tasks.",
  "native.documentClose.keepOpen": "Keep Window Open",
  "native.documentClose.closeAnyway": "Close Anyway",
  "native.documentClose.message": "Some document changes could not be saved.",
  "native.documentClose.detail": "Keep the window open and try again to avoid losing changes.",
});

/** Preserve app-quit intent across the asynchronous BrowserWindow close gate. */
export function createApplicationQuitIntent({ app, platform = process.platform }) {
  if (!app || typeof app.quit !== "function") {
    throw new TypeError("An Electron app implementation is required.");
  }
  let requested = false;
  return Object.freeze({
    markRequested: () => {
      requested = true;
    },
    cancel: () => {
      requested = false;
    },
    resumeAfterLastWindowClosed: () => {
      if (platform !== "darwin" || requested) app.quit();
    },
  });
}

/**
 * Coordinates BrowserWindow close with the renderer-owned Document Sessions.
 * The renderer owns editor snapshots; Main owns the final close decision.
 */
export function createDocumentSessionCloseCoordinator({
  dialog,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = console,
  onCloseCancelled = () => undefined,
  closeResources = async () => true,
  t = (messageId) => DEFAULT_DIALOG_MESSAGES[messageId] ?? "",
}) {
  if (!dialog || typeof dialog.showMessageBox !== "function") {
    throw new TypeError("A dialog implementation is required.");
  }

  const pendingRequests = new Map();
  const windowStates = new WeakMap();
  const windowStateByWebContentsId = new Map();

  function registerIpc(ipc) {
    if (!ipc || typeof ipc.on !== "function") {
      throw new TypeError("A trusted IPC registrar is required.");
    }
    ipc.on(DOCUMENT_SESSION_FLUSH_RESULT_CHANNEL, (event, payload) => {
      const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
      const pending = requestId ? pendingRequests.get(requestId) : null;
      if (!pending || event?.sender?.id !== pending.webContentsId) return;

      pending.resolve(payload?.ok === true
        ? { ok: true, kind: null, error: null }
        : { ok: false, kind: "persistence-failed", error: sanitizeError(payload?.error) });
    });
  }

  function attachWindow(window) {
    if (!window || typeof window.on !== "function" || !window.webContents) {
      throw new TypeError("A BrowserWindow is required.");
    }
    if (windowStates.has(window)) return () => undefined;

    // BrowserWindow.webContents must not be dereferenced from the `closed`
    // event: Electron has already destroyed the BrowserWindow by then and its
    // native-backed property getter can throw "Object has been destroyed".
    const webContents = window.webContents;

    const state = {
      allowClose: false,
      closeInProgress: false,
      rendererReady: false,
      requestId: null,
    };
    let cleanedUp = false;
    windowStates.set(window, state);
    windowStateByWebContentsId.set(webContents.id, state);

    const markRendererReady = () => {
      state.rendererReady = true;
    };
    const markRendererUnavailable = () => {
      state.rendererReady = false;
      cancelPendingRequestsForWebContents(
        webContents.id,
        "renderer-unavailable",
        "The renderer stopped before its documents finished saving.",
      );
    };
    const markRendererLoading = (details, _url, _isInPlace, legacyIsMainFrame) => {
      const isMainFrame = typeof details?.isMainFrame === "boolean"
        ? details.isMainFrame
        : legacyIsMainFrame;
      const isSameDocument = details?.isSameDocument === true;
      if (isMainFrame && !isSameDocument) markRendererUnavailable();
    };
    const handleClose = (event) => {
      if (state.allowClose) return;
      event.preventDefault();
      if (state.closeInProgress) return;

      state.closeInProgress = true;
      void finishInterceptedClose(window, webContents, state).catch((error) => {
        state.closeInProgress = false;
        onCloseCancelled(window);
        logger.error?.("Unable to coordinate document flush before closing:", error);
      });
    };
    const handleClosed = () => {
      cancelPendingRequestsForWebContents(
        webContents.id,
        "renderer-unavailable",
        "The window closed before its documents were saved.",
      );
      cleanup();
    };
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      window.removeListener?.("close", handleClose);
      window.removeListener?.("closed", handleClosed);
      if (!webContents.isDestroyed()) {
        webContents.removeListener?.("did-finish-load", markRendererReady);
        webContents.removeListener?.("did-start-navigation", markRendererLoading);
        webContents.removeListener?.("render-process-gone", markRendererUnavailable);
      }
      windowStates.delete(window);
      if (windowStateByWebContentsId.get(webContents.id) === state) {
        windowStateByWebContentsId.delete(webContents.id);
      }
    };

    webContents.on("did-finish-load", markRendererReady);
    webContents.on("did-start-navigation", markRendererLoading);
    webContents.on("render-process-gone", markRendererUnavailable);
    window.on("close", handleClose);
    window.on("closed", handleClosed);

    return cleanup;
  }

  async function finishInterceptedClose(window, webContents, state) {
    const result = state.rendererReady && !webContents.isDestroyed()
      ? await requestRendererFlush(webContents, { reason: "app-close", state })
      : { ok: true };
    if (result.ok) {
      await finishResourceClose(window, webContents, state, result.requestId);
      return;
    }

    if (window.isDestroyed()) return;
    if (result.error) {
      logger.warn?.("Document flush failed before close:", result.error);
    }
    let choice;
    try {
      choice = await dialog.showMessageBox(window, {
        type: "warning",
        buttons: [
          t("native.documentClose.keepOpen"),
          t("native.documentClose.closeAnyway"),
        ],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        message: t("native.documentClose.message"),
        detail: t("native.documentClose.detail"),
      });
    } catch (error) {
      notifyRendererCloseCancelled(window, webContents, result.requestId);
      throw error;
    }
    if (choice.response === 1) {
      await finishResourceClose(window, webContents, state, result.requestId);
      return;
    }
    notifyRendererCloseCancelled(window, webContents, result.requestId);
    state.closeInProgress = false;
    onCloseCancelled(window);
  }

  async function finishResourceClose(window, webContents, state, requestId) {
    if (window.isDestroyed()) return;
    let closed = false;
    try { closed = await closeResources(window); }
    catch (error) { logger.error?.("Unable to stop project resources before closing:", error); }
    if (!closed) {
      state.closeInProgress = false;
      notifyRendererCloseCancelled(window, webContents, requestId);
      onCloseCancelled(window);
      await dialog.showMessageBox(window, {
        type: "warning", buttons: [t("native.documentClose.keepOpen")],
        message: t("native.projectClose.message"), detail: t("native.projectClose.detail"),
      });
      return;
    }
    state.allowClose = true;
    if (!window.isDestroyed()) window.close();
  }

  function requestRendererFlush(webContents, {
    reason = "git-auto-commit",
    state = null,
    signal = null,
  } = {}) {
    const requestId = randomUUID();
    if (state) state.requestId = requestId;

    return new Promise((resolve) => {
      let settled = false;
      const settle = (result) => {
        if (settled) return;
        settled = true;
        pendingRequests.delete(requestId);
        clearTimeout(timer);
        signal?.removeEventListener("abort", handleAbort);
        if (state?.requestId === requestId) state.requestId = null;
        resolve({ ...result, requestId });
      };
      const handleAbort = () => settle({
        ok: false,
        kind: "cancelled",
        error: "The workspace changed before its documents finished saving.",
      });
      const timer = setTimeout(() => settle({
        ok: false,
        kind: "timeout",
        error: "Saving open documents timed out. Keep the window open and try again.",
      }), normalizeTimeout(timeoutMs));
      pendingRequests.set(requestId, {
        webContentsId: webContents.id,
        timer,
        resolve: settle,
      });
      signal?.addEventListener("abort", handleAbort, { once: true });
      if (signal?.aborted) {
        handleAbort();
        return;
      }

      try {
        webContents.send(DOCUMENT_SESSION_FLUSH_REQUEST_CHANNEL, { requestId, reason });
      } catch (error) {
        const pending = pendingRequests.get(requestId);
        if (!pending) return;
        pending.resolve({
          ok: false,
          kind: "renderer-unavailable",
          error: sanitizeError(error),
        });
      }
    });
  }

  function requestFlush(webContents, reason = "git-auto-commit", { signal = null } = {}) {
    const state = webContents && Number.isSafeInteger(webContents.id)
      ? windowStateByWebContentsId.get(webContents.id)
      : null;
    if (!state?.rendererReady || webContents.isDestroyed?.()) {
      return Promise.resolve({
        ok: false,
        kind: "renderer-unavailable",
        error: "The workspace renderer is unavailable.",
        requestId: null,
      });
    }
    return requestRendererFlush(webContents, { reason, signal });
  }

  function cancelPendingRequestsForWebContents(webContentsId, kind, message) {
    for (const [requestId, pending] of pendingRequests.entries()) {
      if (pending.webContentsId !== webContentsId) continue;
      pending.resolve({ ok: false, kind, error: message });
    }
  }

  return Object.freeze({ attachWindow, registerIpc, requestFlush });
}

function notifyRendererCloseCancelled(window, webContents, requestId) {
  if (!requestId || window.isDestroyed() || webContents.isDestroyed()) return;
  try {
    webContents.send(DOCUMENT_SESSION_CLOSE_CANCELLED_CHANNEL, { requestId });
  } catch {
    // The window stays open by default; a missing renderer needs no further action.
  }
}

function normalizeTimeout(value) {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : DEFAULT_TIMEOUT_MS;
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "Unable to save open documents.");
  return message.slice(0, 500);
}
