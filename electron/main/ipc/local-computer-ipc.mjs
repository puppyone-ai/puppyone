export function registerLocalComputerIpcHandlers({
  ipcMain,
  service,
  requireRecentWorkspacePath,
}) {
  ipcMain.handle("local-computers:snapshot", async () => {
    return service.getSnapshot();
  });

  ipcMain.handle("local-computers:set-experimental-opt-in", async (_event, request) => {
    return service.setExperimentalOptIn({
      enabled: request?.enabled === true,
    });
  });

  ipcMain.handle("local-computers:register", async (_event, request) => {
    const workspacePath = await requireRecentWorkspacePath(request?.workspacePath);
    return service.register({
      workspacePath,
      name: typeof request?.name === "string" ? request.name : undefined,
      startNow: request?.startNow !== false,
    });
  });

  ipcMain.handle("local-computers:wake", async (_event, request) => {
    const id = typeof request?.id === "string" ? request.id.trim() : "";
    if (!id) throw new Error("A computer id is required.");
    return service.wake({ id });
  });

  ipcMain.handle("local-computers:sleep", async (_event, request) => {
    const id = typeof request?.id === "string" ? request.id.trim() : "";
    if (!id) throw new Error("A computer id is required.");
    return service.sleep({ id });
  });

  ipcMain.handle("local-computers:provision-desktop", async (_event, request) => {
    const id = typeof request?.id === "string" ? request.id.trim() : "";
    if (!id) throw new Error("A computer id is required.");
    return service.provisionDesktop({ id });
  });

  ipcMain.handle("local-computers:remove", async (_event, request) => {
    const id = typeof request?.id === "string" ? request.id.trim() : "";
    if (!id) throw new Error("A computer id is required.");
    return service.remove({ id });
  });

  ipcMain.handle("local-computers:connect-screen", async (_event, request) => {
    const id = typeof request?.id === "string" ? request.id.trim() : "";
    if (!id) throw new Error("A computer id is required.");
    return service.connectScreen({ id });
  });
}
