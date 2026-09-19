import { parseItemExecutionTarget } from "../../../shared/item-host-contract/lifecycle.mjs";
import { projectSessionFailure } from "../../../shared/project-session-contract/schema.mjs";

/** Trusted Main management path: no display port or business RPC prerequisites. */
export function registerItemLifecycleIpc({ ipcMain, lifecycle, projectSessions, manage }) {
  const register = (channel, invoke) => ipcMain.handle(channel, async (event, request) => {
    try {
      const project = projectSessions.require(event.sender.id, request?.projectContext, { allowClosing: true, allowClosed: true });
      return invoke(event.sender.id, project, request);
    } catch (error) { return projectSessionFailure(error); }
  });
  register("item-execution:list", (ownerId, project) => lifecycle.list(record => record.ownerId === ownerId
    && record.projectContext?.projectId === project.projectId && record.projectContext?.generation === project.generation));
  for (const retry of [false, true]) register(retry ? "item-execution:retry-cleanup" : "item-execution:terminate", (ownerId, project, request) => {
    const target = parseItemExecutionTarget(request);
    return lifecycle.terminate({ ...target, ownerId, root: project.rootPath,
      projectContext: { projectId: project.projectId, generation: project.generation, rootPath: project.rootPath } }, target.operationId, { retry });
  });
  ipcMain.handle("item-execution:manage", event => manage(event.sender.id));
}
