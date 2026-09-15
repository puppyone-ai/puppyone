import { isWorkspaceResourceReference } from "../../../shared/workspace-resource-reference.mjs";
import { createResourceDragSessionService } from "../resource-drag-session-service.mjs";

export function registerResourceTransferIpcHandlers({
  ipcMain,
  resolveWorkspaceResource,
  resolveProjectRoot,
  nativeDrag,
  getWindow,
}) {
  const resolveEntries = async (event, request) => {
    if (Object.hasOwn(request ?? {}, "projectRootPath")) {
      if (typeof resolveProjectRoot !== "function") throw new Error("Project root export is unavailable.");
      const absolutePath = await resolveProjectRoot(event, request.projectRootPath);
      return [{ absolutePath, entryType: "directory" }];
    }
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
  ipcMain.handle("resource-transfer:start-drag", (event, request) => {
    if (Object.hasOwn(request ?? {}, "projectRootPath")) {
      throw new Error("Project roots require the dedicated drag channel.");
    }
    return sessions?.start(event, request) ?? false;
  });
  ipcMain.handle("resource-transfer:start-project-drag", (event, request) => (
    sessions?.start(event, { projectRootPath: request?.path }, { externalOnly: true }) ?? false
  ));
  ipcMain.handle("resource-transfer:preview-drag", (event) => sessions?.preview(event) ?? null);
  ipcMain.handle("resource-transfer:claim-drop", (event, request) => sessions?.claim(event, request) ?? null);
  return { dispose: () => sessions?.dispose() };
}
