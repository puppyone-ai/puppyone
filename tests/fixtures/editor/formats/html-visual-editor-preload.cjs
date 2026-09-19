const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("htmlTestDisk", {
  read: () => ipcRenderer.invoke("html-test:read"),
  persist: (request) => ipcRenderer.invoke("html-test:persist", request),
  importImage: (file, folder, preferredName) => ipcRenderer.invoke("html-test:image", {
    sourcePaths: [webUtils.getPathForFile(file)], targetFolderPath: folder, preferredName,
  }),
  agentWrite: (content) => ipcRenderer.invoke("html-test:agent", content),
});
