export const APPEARANCE_WINDOW_BACKGROUND_CHANNEL = "appearance:set-window-background";

const opaqueHexColorPattern = /^#[0-9a-f]{6}$/i;

/**
 * Keeps Electron's native window underlay on the same compiler-validated color
 * as the renderer's synchronous first paint. An opaque hex-only contract gives
 * local Sub Themes the same capability as built-ins without accepting general
 * CSS, gradients, alpha, or another native-window operation.
 */
export function registerAppearanceIpcHandlers({
  ipcMain,
  BrowserWindow,
  nativeTheme,
  windowChrome = null,
}) {
  if (!ipcMain || typeof ipcMain.on !== "function") {
    throw new TypeError("Trusted ipcMain is required for appearance synchronization.");
  }
  if (!BrowserWindow || typeof BrowserWindow.fromWebContents !== "function") {
    throw new TypeError("BrowserWindow is required for appearance synchronization.");
  }
  if (!nativeTheme || !("themeSource" in nativeTheme)) {
    throw new TypeError("Electron nativeTheme is required for appearance synchronization.");
  }

  ipcMain.on(APPEARANCE_WINDOW_BACKGROUND_CHANNEL, (event, request) => {
    const background = request?.background;
    const titlebarBackground = request?.titlebarBackground;
    const themeSource = request?.themeSource;
    if (typeof background !== "string" || !opaqueHexColorPattern.test(background)) return;
    if (themeSource !== "system" && themeSource !== "light" && themeSource !== "dark") return;

    const ownerWindow = BrowserWindow.fromWebContents(event.sender);
    if (!ownerWindow || ownerWindow.isDestroyed?.()) return;
    // Keep AppKit-owned window chrome (including inactive traffic lights) on
    // the same appearance as the renderer. Electron does not expose traffic-
    // light colors on macOS, so nativeTheme is the supported integration seam.
    nativeTheme.themeSource = themeSource;
    ownerWindow.setBackgroundColor(background);
    windowChrome?.synchronizeAppearance?.(ownerWindow, {
      background,
      themeSource,
      titlebarBackground: typeof titlebarBackground === "string" ? titlebarBackground : null,
    });
  });
}
