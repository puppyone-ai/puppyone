export function registerWorkspaceNavigationIpcHandlers({
  ipcMain,
  workspaceStateStore,
  getInitialWorkspaceResultForWindow,
  forgetCurrentWindowWorkspace,
  showHomepageForCurrentWindow,
  openWorkspaceInCurrentWindow,
  openWorkspaceInNewWindow,
  createProjectForCurrentWindow,
  cloneRepositoryForCurrentWindow,
  selectProjectLocationForCurrentWindow,
  getDefaultProjectLocationForCurrentWindow,
  selectWorkspaceForCurrentWindow,
  selectWorkspaceForCurrentComposition,
  selectWorkspaceForNewWindow,
  attachWorkspaceToCurrentWindow,
  detachWorkspaceFromCurrentWindow,
}) {
  ipcMain.handle("window:get-initial-workspace", async (event) => {
    return getInitialWorkspaceResultForWindow(event.sender);
  });

  ipcMain.handle("workspace:get-last", async () => {
    return workspaceStateStore.getLastWorkspaceResult();
  });

  ipcMain.handle("workspace:get-recent", async () => {
    return workspaceStateStore.getRecentWorkspacesResult();
  });

  ipcMain.handle("workspace:hydrate-recent", async () => {
    return workspaceStateStore.hydrateRecentWorkspacesResult();
  });

  ipcMain.handle("workspace:remove-recent", async (_event, folderPath) => {
    const result = await workspaceStateStore.removeRecentWorkspacePath(folderPath);
    return { ok: true, ...result };
  });

  ipcMain.handle("workspace:forget-last", async (event) => {
    await forgetCurrentWindowWorkspace(event.sender);
    return { ok: true };
  });

  ipcMain.handle("workspace:show-homepage", async (event) => {
    await showHomepageForCurrentWindow(event.sender);
    return { ok: true };
  });

  ipcMain.handle("workspace:open-current", async (event, folderPath) => {
    const persistedPath = await workspaceStateStore.requireRecentWorkspacePath(folderPath);
    return openWorkspaceInCurrentWindow(event.sender, persistedPath);
  });

  // This path bypasses the recent-workspace allowlist only because the preload
  // resolves it from a native File object granted by a user drop gesture. The
  // renderer never receives a general arbitrary-path opener.
  ipcMain.handle("workspace:open-dropped-current", async (event, folderPath) => {
    if (typeof folderPath !== "string" || !folderPath.trim()) {
      throw new Error("Dropped folder path is required.");
    }
    return openWorkspaceInCurrentWindow(event.sender, folderPath.trim());
  });

  ipcMain.handle("workspace:open-new-window", async (_event, folderPath) => {
    const persistedPath = await workspaceStateStore.requireRecentWorkspacePath(folderPath);
    return openWorkspaceInNewWindow(persistedPath);
  });

  ipcMain.handle("workspace:create-project-current", async (event, request) => {
    return createProjectForCurrentWindow(event.sender, request);
  });

  ipcMain.handle("workspace:select-project-location-current", async (event) => {
    return selectProjectLocationForCurrentWindow(event.sender);
  });

  ipcMain.handle("workspace:default-project-location-current", async (event) => {
    return getDefaultProjectLocationForCurrentWindow(event.sender);
  });

  ipcMain.handle("workspace:clone-repository-current", async (event, request) => {
    return cloneRepositoryForCurrentWindow(event.sender, request);
  });

  ipcMain.handle("workspace:select-folder", async (event) => {
    return selectWorkspaceForCurrentWindow(event.sender);
  });

  ipcMain.handle("workspace:select-folder-current", async (event) => {
    return selectWorkspaceForCurrentWindow(event.sender);
  });

  ipcMain.handle("workspace:select-folder-attach", async (event) => {
    return selectWorkspaceForCurrentComposition(event.sender);
  });

  ipcMain.handle("workspace:attach-current", async (event, folderPath) => {
    const persistedPath = await workspaceStateStore.requireRecentWorkspacePath(folderPath);
    return attachWorkspaceToCurrentWindow(event.sender, persistedPath);
  });

  ipcMain.handle("workspace:detach-current", async (event, folderPath) => {
    return detachWorkspaceFromCurrentWindow(event.sender, folderPath);
  });

  ipcMain.handle("workspace:select-folder-new-window", async (event) => {
    return selectWorkspaceForNewWindow(event.sender);
  });
}
