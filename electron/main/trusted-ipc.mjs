export class TrustedIpcError extends Error {
  constructor(message) {
    super(message);
    this.name = "TrustedIpcError";
  }
}

/**
 * The only production entry point for registering renderer -> main IPC.
 * Every handler is gated to the top-level application frame before any
 * channel-specific code runs.
 */
export function createTrustedIpcMain({
  ipcMain,
  applicationUrl,
  logger = console,
}) {
  if (!ipcMain || typeof ipcMain.handle !== "function" || typeof ipcMain.on !== "function") {
    throw new TypeError("A valid ipcMain implementation is required.");
  }
  // Fail during startup instead of silently accepting an invalid trust root.
  parseUrl(applicationUrl, "Application URL is invalid.");

  return Object.freeze({
    handle(channel, listener) {
      requireChannelAndListener(channel, listener);
      ipcMain.handle(channel, async (event, ...args) => {
        assertTrustedIpcEvent(event, applicationUrl);
        return listener(event, ...args);
      });
    },

    on(channel, listener) {
      requireChannelAndListener(channel, listener);
      ipcMain.on(channel, (event, ...args) => {
        try {
          assertTrustedIpcEvent(event, applicationUrl);
        } catch (error) {
          event?.preventDefault?.();
          logger.warn?.(`Blocked untrusted IPC event on ${channel}:`, error);
          return undefined;
        }
        return listener(event, ...args);
      });
    },
  });
}

export function assertTrustedIpcEvent(event, applicationUrl) {
  const sender = event?.sender;
  const senderFrame = event?.senderFrame;
  if (!sender || !senderFrame || senderFrame !== sender.mainFrame) {
    throw new TrustedIpcError("IPC is allowed only from the application main frame.");
  }

  if (!isTrustedApplicationFrameUrl(senderFrame.url, applicationUrl)) {
    throw new TrustedIpcError("IPC sender URL is not the trusted application URL.");
  }
}

export function isTrustedApplicationFrameUrl(frameValue, applicationValue) {
  let frameUrl;
  let applicationUrl;
  try {
    frameUrl = new URL(frameValue);
    applicationUrl = new URL(applicationValue);
  } catch {
    return false;
  }

  if (applicationUrl.protocol === "http:" || applicationUrl.protocol === "https:") {
    return (
      frameUrl.protocol === applicationUrl.protocol
      && frameUrl.origin === applicationUrl.origin
      && frameUrl.username === applicationUrl.username
      && frameUrl.password === applicationUrl.password
    );
  }

  if (applicationUrl.protocol === "file:") {
    return (
      frameUrl.protocol === "file:"
      && frameUrl.host === applicationUrl.host
      && frameUrl.pathname === applicationUrl.pathname
      && frameUrl.search === applicationUrl.search
      && frameUrl.username === applicationUrl.username
      && frameUrl.password === applicationUrl.password
    );
  }

  frameUrl.hash = "";
  applicationUrl.hash = "";
  return frameUrl.href === applicationUrl.href;
}

function requireChannelAndListener(channel, listener) {
  if (typeof channel !== "string" || channel.trim().length === 0) {
    throw new TypeError("IPC channel is required.");
  }
  if (typeof listener !== "function") {
    throw new TypeError(`IPC listener for ${channel} must be a function.`);
  }
}

function parseUrl(value, message) {
  try {
    return new URL(value);
  } catch {
    throw new TypeError(message);
  }
}
