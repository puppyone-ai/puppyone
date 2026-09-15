import { assertLocalAgentInstallationProgress } from "../../../shared/local-agent-installation/schema.mjs";

export function registerLocalAgentInstallationIpcHandlers({ ipcMain, installationService }) {
  ipcMain.handle("local-agent-installation:discover", async (event, request) => {
    const requestId = normalizeRequestId(request?.requestId);
    return installationService.discover({
      refresh: request?.refresh === true,
      onProgress: requestId
        ? (progress) => sendProgress(event.sender, requestId, progress)
        : null,
    });
  });
}

function sendProgress(sender, requestId, progress) {
  try {
    if (typeof sender?.isDestroyed === "function" && sender.isDestroyed()) return;
    sender?.send?.("local-agent-installation:progress", assertLocalAgentInstallationProgress({
      requestId,
      ...progress,
    }));
  } catch {
    // The requesting window may close while the shared scan is in flight.
  }
}

function normalizeRequestId(value) {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,96}$/u.test(value) ? value : null;
}
