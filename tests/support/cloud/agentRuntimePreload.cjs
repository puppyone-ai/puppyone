const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("puppyoneDesktop", {
  readCloudAuthState: () => ipcRenderer.invoke("cloud-auth:read-state"),
  requestCloudSessionApi: input => ipcRenderer.invoke("cloud:session-api-request", input),
});
contextBridge.exposeInMainWorld("agentAcceptance", {
  configuration: () => ipcRenderer.invoke("agent-acceptance:configuration"),
});
