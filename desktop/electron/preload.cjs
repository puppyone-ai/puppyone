const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("puppyoneDesktop", {
  selectFolder: () => ipcRenderer.invoke("workspace:select-folder"),
  workspaceFromPath: (folderPath) => ipcRenderer.invoke("workspace:from-path", folderPath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  listFolderChildren: (request) => ipcRenderer.invoke("workspace:list-folder-children", request),
});
