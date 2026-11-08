import { matchMarkdownShortcutInput } from "../../../shared/markdown-shortcuts.mjs";
export const MARKDOWN_FORMAT_ACTIVE_CHANNEL = "editor:markdown-format-active";
export const MARKDOWN_FORMAT_SHORTCUT_CHANNEL = "editor:markdown-format-shortcut";

export const MARKDOWN_FORMAT_COMMANDS = Object.freeze(["strong", "emphasis", "underline", "strike"]);

const controllers = new Map();

export function isMarkdownFormatCommand(value) {
  return MARKDOWN_FORMAT_COMMANDS.includes(value);
}

/**
 * Route editor-owned Markdown keys before native menu accelerators, including
 * formatting, heading, and insertion commands. Focus controls activation.
 */
export function matchMarkdownFormatInput(input, platform = process.platform) {
  return matchMarkdownShortcutInput(input, platform);
}

export function attachMarkdownFormatShortcuts(
  webContents,
  { platform = process.platform } = {},
) {
  if (!webContents || typeof webContents.on !== "function" || typeof webContents.send !== "function") {
    throw new TypeError("A WebContents instance is required for Markdown format shortcuts.");
  }

  const existing = controllers.get(webContents.id);
  if (existing) return existing;

  let active = false;
  const onBeforeInput = (event, input) => {
    if (!active) return;
    const type = matchMarkdownFormatInput(input, platform);
    if (!type) return;
    event.preventDefault();
    if (webContents.isDestroyed?.()) return;
    webContents.send(MARKDOWN_FORMAT_SHORTCUT_CHANNEL, { type });
  };
  const dispose = () => {
    active = false;
    webContents.removeListener?.("before-input-event", onBeforeInput);
    controllers.delete(webContents.id);
  };

  webContents.on("before-input-event", onBeforeInput);
  webContents.once?.("destroyed", dispose);

  const controller = {
    setActive(nextActive) {
      active = nextActive === true;
    },
    dispose,
  };
  controllers.set(webContents.id, controller);
  return controller;
}

export function setMarkdownFormatShortcutsActive(webContentsId, active) {
  controllers.get(webContentsId)?.setActive(active === true);
}

export function registerMarkdownFormatIpcHandlers({ ipcMain }) {
  if (!ipcMain || typeof ipcMain.on !== "function") {
    throw new TypeError("Trusted ipcMain is required for Markdown format shortcuts.");
  }

  ipcMain.on(MARKDOWN_FORMAT_ACTIVE_CHANNEL, (event, request) => {
    const webContentsId = event?.sender?.id;
    if (!Number.isSafeInteger(webContentsId) || webContentsId <= 0) return;
    setMarkdownFormatShortcutsActive(webContentsId, request?.active === true);
  });
}
