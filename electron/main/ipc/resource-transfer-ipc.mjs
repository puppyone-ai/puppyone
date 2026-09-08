import { isWorkspaceResourceReference } from "../../../shared/workspace-resource-reference.mjs";
import { createResourceDragSessionService } from "../resource-drag-session-service.mjs";

export function registerResourceTransferIpcHandlers({ ipcMain, resolveWorkspaceResource, nativeDrag, getWindow }) {
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
  const sessions = nativeDrag ? createResourceDragSessionService({ native: nativeDrag, resolveEntries, getWindow }) : null;
  ipcMain.handle("resource-transfer:start-drag", (event, request) => sessions?.start(event, request) ?? false);
  ipcMain.handle("resource-transfer:preview-drag", (event) => sessions?.preview(event) ?? null);
  ipcMain.handle("resource-transfer:claim-drop", (event, request) => sessions?.claim(event, request) ?? null);
  return { dispose: () => sessions?.dispose() };
}
