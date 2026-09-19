const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("puppyoneDesktop", {
  localAgentSetup: {
    inspect: (request) => ipcRenderer.invoke("local-agent-setup:inspect", request),
    act: (request) => ipcRenderer.invoke("local-agent-setup:act", request),
    release: (clientId) => ipcRenderer.invoke("local-agent-setup:release", clientId),
  },
});
