const { contextBridge, ipcRenderer } = require("electron");

// Give the isolated chat fixture its real diagram service without unrelated app APIs.
contextBridge.exposeInMainWorld("puppyoneDesktop", {
  mermaid: {
    render: (request) => ipcRenderer.invoke("mermaid:render", request),
    cancel: (id) => ipcRenderer.invoke("mermaid:cancel", id),
  },
});
