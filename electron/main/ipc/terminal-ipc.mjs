import { projectSessionError, projectSessionFailure } from "../../../shared/project-session-contract/schema.mjs";

export function registerTerminalIpcHandlers({
  ipcMain,
  terminalService,
  authorizeWorkspaceRoot,
  projectSessions = null,
}) {
  const register = (name, handler) => ipcMain.handle(name, async (event, request) => {
    try { return await handler(event, request); }
    catch (error) { if (!projectSessions) throw error; return projectSessionFailure(error); }
  });
  const validate = (event, request, allowClosing = false) => {
    if (!projectSessions) return;
    const project = projectSessions.require(event.sender.id, request?.projectContext, { allowClosing, allowClosed: allowClosing });
    if (typeof request?.instanceId !== "string") throw projectSessionError("SESSION_STALE", "The terminal instance identity is required.");
    terminalService.assertSessionInstance(event.sender, request, project.rootPath, { allowClosed: allowClosing });
  };
  register("terminal:create", async (event, request) => {
    if (projectSessions) {
      const context = projectSessions.require(event.sender.id, request?.projectContext);
      if (context.rootPath !== request?.rootPath) throw projectSessionError("PROJECT_UNAUTHORIZED", "The terminal belongs to another project.");
      return projectSessions.run(event.sender.id, request.projectContext, (operation) => (
        terminalService.create(event.sender, request, context.rootPath, operation)
      ));
    }
    const workspaceRoot = await authorizeWorkspaceRoot(event, request?.rootPath);
    return terminalService.create(event.sender, request, workspaceRoot);
  });

  ipcMain.on("terminal:input", (event, request) => {
    try { validate(event, request); } catch { return; }
    terminalService.input(event.sender, request);
  });

  ipcMain.on("terminal:resize", (event, request) => {
    try { validate(event, request); } catch { return; }
    terminalService.resize(event.sender, request);
  });

  ipcMain.on("terminal:appearance", (event, request) => {
    try { validate(event, request); } catch { return; }
    terminalService.appearance(event.sender, request);
  });

  register("terminal:close", async (event, id) => {
    validate(event, id, true);
    return terminalService.close(event.sender, id);
  });
}
