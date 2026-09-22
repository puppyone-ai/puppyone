/** Pass the app's trusted IPC gate; never register this on a viewer's bridge. */
export function registerLocalAgentActivationIpcHandlers({ ipcMain, service }) {
  const observed = new WeakSet();
  const own = (event) => {
    if (!observed.has(event.sender)) {
      observed.add(event.sender);
      const ownerId = event.sender.id;
      event.sender.once("destroyed", () => service.release(ownerId));
    }
    return event.sender.id;
  };
  ipcMain.handle("local-agent-activation:read", () => service.read());
  ipcMain.handle("local-agent-activation:plan", (event, request) => service.plan(own(event), request));
  ipcMain.handle("local-agent-activation:start", (event, request) => service.start(own(event), request));
  ipcMain.handle("local-agent-activation:act", (event, request) => service.act(own(event), request));
  ipcMain.handle("local-agent-activation:guide", (event, request) => service.openGuide(own(event), request));
}
