export const PROJECT_APPEARANCE_CHANGED_CHANNEL = "project-appearance:changed";

export function registerProjectAppearanceIpcHandlers({
  ipcMain,
  service,
  getWindows,
} = {}) {
  if (!ipcMain?.handle) throw new TypeError("Trusted ipcMain is required.");
  if (!service?.list || !service?.chooseIcon || !service?.setEmoji || !service?.resetIcon) {
    throw new TypeError("Project appearance service is required.");
  }

  const publish = (appearance) => {
    for (const window of getWindows?.() ?? []) {
      if (window?.isDestroyed?.() || window?.webContents?.isDestroyed?.()) continue;
      window.webContents.send(PROJECT_APPEARANCE_CHANGED_CHANNEL, appearance);
    }
  };

  ipcMain.handle("project-appearance:list", (_event, request) => (
    service.list(request?.projectIdentities)
  ));
  ipcMain.handle("project-appearance:choose-icon", async (event, request) => {
    const result = await service.chooseIcon({
      projectIdentity: request?.projectIdentity,
      sender: event.sender,
    });
    if (result.status === "updated") publish(result.appearance);
    return result;
  });
  ipcMain.handle("project-appearance:reset-icon", async (_event, request) => {
    const appearance = await service.resetIcon(request?.projectIdentity);
    publish(appearance);
    return appearance;
  });
  ipcMain.handle("project-appearance:set-emoji", async (_event, request) => {
    const appearance = await service.setEmoji({
      projectIdentity: request?.projectIdentity,
      emoji: request?.emoji,
    });
    publish(appearance);
    return appearance;
  });
}
