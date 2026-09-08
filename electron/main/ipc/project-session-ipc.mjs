export function registerProjectSessionIpc({ ipcMain, projectSessions }) {
  ipcMain.handle("project-sessions:read", (event) => projectSessions.snapshot(event.sender.id));
}
