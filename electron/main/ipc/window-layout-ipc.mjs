import { DESKTOP_WINDOW_MIN_WIDTH } from "../window-layout-contract.mjs";
import { applyWindowChromeProfile } from "../window-chrome-profile.mjs";

const MAXIMUM_REQUESTED_WINDOW_MIN_WIDTH = 4096;
const WINDOW_ACTIONS = new Set(["minimize", "toggle-maximize", "close"]);

/**
 * Keeps renderer pane constraints and the native BrowserWindow resize boundary
 * in one contract. The renderer reports only the current workbench minimum;
 * main owns validation and the product-level 640px floor.
 */
export function registerWindowLayoutIpcHandlers({ ipcMain, BrowserWindow }) {
  ipcMain.handle("window-layout:get-chrome-state", (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    return {
      fullScreen: Boolean(
        ownerWindow
        && !ownerWindow.isDestroyed?.()
        && ownerWindow.isFullScreen?.(),
      ),
      maximized: Boolean(
        ownerWindow
        && !ownerWindow.isDestroyed?.()
        && ownerWindow.isMaximized?.(),
      ),
    };
  });

  ipcMain.handle("window-layout:set-chrome-profile", (event, request) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    if (!ownerWindow || ownerWindow.isDestroyed?.()) return { applied: false };

    const profile = applyWindowChromeProfile(ownerWindow, request?.titlebar);
    return { applied: true, customControls: profile.customControls };
  });

  ipcMain.handle("window-layout:perform-window-action", (event, request) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    if (!ownerWindow || ownerWindow.isDestroyed?.()) return { applied: false };
    const action = request?.action;
    if (!WINDOW_ACTIONS.has(action)) return { applied: false };

    if (action === "minimize") ownerWindow.minimize?.();
    if (action === "toggle-maximize") {
      if (ownerWindow.isMaximized?.()) ownerWindow.unmaximize?.();
      else ownerWindow.maximize?.();
    }
    if (action === "close") ownerWindow.close?.();
    return { applied: true };
  });

  ipcMain.handle("window-layout:set-minimum-width", (event, request) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    if (!ownerWindow || ownerWindow.isDestroyed?.()) return { applied: false };

    const requestedWidth = normalizeRequestedWidth(request?.width);
    const minimumWidth = Math.max(DESKTOP_WINDOW_MIN_WIDTH, requestedWidth);
    const [, minimumHeight] = ownerWindow.getMinimumSize();
    ownerWindow.setMinimumSize(minimumWidth, minimumHeight);

    const [currentWidth, currentHeight] = ownerWindow.getSize();
    if (currentWidth < minimumWidth) {
      ownerWindow.setSize(minimumWidth, currentHeight, true);
    }

    return { applied: true, width: minimumWidth };
  });
}

function normalizeRequestedWidth(value) {
  if (!Number.isFinite(value)) return DESKTOP_WINDOW_MIN_WIDTH;
  return Math.min(
    Math.max(0, Math.round(value)),
    MAXIMUM_REQUESTED_WINDOW_MIN_WIDTH,
  );
}
