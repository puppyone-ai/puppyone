import { isWorkspaceResourceReference } from "../../../shared/workspace-resource-reference.mjs";

export function registerResourceTransferIpcHandlers({ ipcMain, resolveWorkspaceResource, getFileIcon }) {
  const resolveEntries = async (event, request) => {
    if (!Array.isArray(request?.resources) || request.resources.length === 0 || request.resources.length > 32) {
      throw new TypeError("Between 1 and 32 resource references are required.");
    }
    if (request.resources.some((resource) => !isWorkspaceResourceReference(resource))
      && (typeof request.sourceWorkspaceId !== "string" || !request.sourceWorkspaceId)) {
      throw new Error("Legacy drag paths require an explicit source project identity.");
    }
    return Promise.all(request.resources.map((resource) => resolveWorkspaceResource(event, resource, {
      legacyRoot: request.rootPath,
      legacyWorkspaceId: request.sourceWorkspaceId,
    })));
  };
  ipcMain.handle("resource-transfer:resolve", async (event, request) => {
    return resolveEntries(event, request);
  });
  ipcMain.handle("resource-transfer:start-drag", async (event, request) => {
    const entries = await resolveEntries(event, request);
    const files = entries.map((entry) => entry.absolutePath);
    const icon = await getFileIcon(files[0], { size: "normal" });
    if (event.sender.isDestroyed()) return false;
    // Revalidate after the asynchronous native icon lookup, including detached roots.
    const currentEntries = await resolveEntries(event, request);
    if (event.sender.isDestroyed()) return false;
    event.sender.startDrag({ files: currentEntries.map((entry) => entry.absolutePath), icon });
    return true;
  });
}
