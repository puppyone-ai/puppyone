export function registerMermaidIpc({ ipcMain, service }) {
  const owners = new Set();
  ipcMain.handle("mermaid:render", (event, request) => {
    const sender = event.sender;
    if (!owners.has(sender.id)) {
      owners.add(sender.id);
      const release = () => { void service.releaseOwner(sender.id).catch(console.error); };
      sender.on("render-process-gone", release);
      sender.on("did-start-navigation", (details) => {
        if (details.isMainFrame && !details.isSameDocument) release();
      });
      sender.once("destroyed", () => { owners.delete(sender.id); release(); });
    }
    return service.render(sender.id, request);
  });
  ipcMain.handle("mermaid:cancel", (event, id) => service.cancel(event.sender.id, id));
}
