const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("editorRuntimeDisk", {
  read: (path) => ipcRenderer.invoke("editor-runtime-smoke:read", path),
  persist: (request) => ipcRenderer.invoke("editor-runtime-smoke:persist", request),
  rename: (path, name) => ipcRenderer.invoke("editor-runtime-smoke:rename", path, name),
  agentWrite: (path, content) => ipcRenderer.invoke("editor-runtime-smoke:agent-write", path, content),
  onChange: (listener) => {
    const handler = (_event, path) => listener(path);
    ipcRenderer.on("editor-runtime-smoke:changed", handler);
    return () => ipcRenderer.removeListener("editor-runtime-smoke:changed", handler);
  },
});
