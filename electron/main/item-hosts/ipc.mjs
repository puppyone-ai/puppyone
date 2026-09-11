export function registerItemHostIpc({ ipcMain, trustedIpcMain, authority, manager, projectSessions }) {
  for (const [channel, method] of [["create", "create"], ["configure", "configure"], ["close", "close"], ["recover", "recover"]]) {
    trustedIpcMain.handle(`item-host:${channel}`, (event, request) => manager[method](event.sender, request));
  }
  for (const [channel, method] of [["geometry", "geometry"], ["focus", "focus"], ["respond", "respond"]]) {
    trustedIpcMain.on(`item-host:${channel}`, (event, request) => {
      try { manager[method](event.sender, request); } catch { /* Stale geometry/focus has no authority after project close. */ }
    });
  }
  const require = (event) => {
    const entry = authority.require(event);
    projectSessions.require(entry.owner.id, entry.projectContext);
    return entry;
  };
  const handle = (channel, listener) => ipcMain.handle(`item-display:${channel}`, (event, request) => {
    const entry = require(event);
    return authority.invoke({ ...event, itemHost: entry }, `item-display:${channel}`, [request],
      (_event, value) => listener(entry, value));
  });
  handle("bootstrap", (entry) => manager.bootstrap(entry));
  handle("ready", (entry) => manager.ready(entry));
  handle("connect", (entry, request) => manager.connect(entry, request));
  handle("draft", (entry, request) => manager.saveDraft(entry, request));
  handle("request", (entry, request) => manager.request(entry, request?.type, request?.payload));
  ipcMain.on("item-display:heartbeat", (event) => { try { manager.heartbeat(require(event)); } catch { /* Closed display. */ } });
  ipcMain.on("item-display:publish", (event, request) => {
    try { manager.publish(require(event), request?.type, request?.payload); } catch { /* Reject malformed summaries without poisoning Main. */ }
  });
}
