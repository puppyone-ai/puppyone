export function registerLocalAgentSetupIpcHandlers({ ipcMain, setupService }) {
  const observed = new WeakSet();
  ipcMain.handle("local-agent-setup:inspect", (event, request) => {
    if (!observed.has(event.sender)) {
      observed.add(event.sender);
      const ownerId = event.sender.id;
      event.sender.once("destroyed", () => setupService.release(ownerId));
    }
    return setupService.inspect(event.sender.id, request);
  });
  ipcMain.handle("local-agent-setup:act", (event, request) => setupService.act(event.sender.id, request));
  ipcMain.handle("local-agent-setup:release", (event, clientId) => setupService.release(event.sender.id, clientId));
}
