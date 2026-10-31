import {
  getLatestWorkspaceEditReviewRequest,
  initializeWorkspaceEditReview,
} from "../../local-api/edit-review.mjs";

export function registerWorkspaceWatchIpcHandlers({
  ipcMain,
  workspaceWatchService,
  authorizeWorkspaceRoot,
}) {
  ipcMain.handle("workspace:watch-start", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    const result = workspaceWatchService.start(event.sender, rootPath) ?? {};
    return { ok: true, subscriptionId: result.subscriptionId ?? null, rootPath: result.rootPath ?? rootPath };
  });

  ipcMain.handle("workspace:watch-stop", async (event, request) => {
    // Token-based stop: the subscriptionId is server-issued and scoped to this
    // sender, so no root re-authorization is required (and cannot remove a
    // newer subscription that reused the same webContents).
    const subscriptionId = request?.subscriptionId;
    if (typeof subscriptionId === "string" && subscriptionId.length > 0) {
      workspaceWatchService.stop(subscriptionId, event.sender.id);
    }
    return { ok: true };
  });

  ipcMain.handle("ai-edit-review:get-latest", async (event, request) => {
    const rootPath = await authorizeWorkspaceRoot(event, request?.rootPath);
    await initializeWorkspaceEditReview(rootPath);
    return getLatestWorkspaceEditReviewRequest(rootPath);
  });
}
