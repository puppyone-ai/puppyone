const { contextBridge, ipcRenderer } = require("electron");
// Compute-only host: no application, filesystem, network or workspace bridge.
contextBridge.exposeInMainWorld("mermaidHost", {
  onRender: (callback) => {
    ipcRenderer.on("mermaid-host:render", (_event, request) => callback(request));
  },
  complete: (result) => ipcRenderer.send("mermaid-host:result", result),
});
