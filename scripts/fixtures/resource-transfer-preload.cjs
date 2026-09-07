const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("puppyoneDesktop", {
  startResourceDrag: (request) => ipcRenderer.invoke("resource-transfer:start-drag", request),
  resolveResourceReferences: (request) => ipcRenderer.invoke("resource-transfer:resolve", request),
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
contextBridge.exposeInMainWorld("resourceSmoke", {
  config: () => ipcRenderer.invoke("resource-smoke:config"),
  record: (entry) => ipcRenderer.send("resource-smoke:event", entry),
});
