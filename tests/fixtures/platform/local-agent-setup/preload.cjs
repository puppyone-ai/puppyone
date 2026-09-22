const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("puppyoneDesktop", {
  localAgentActivation: {
    read: () => ipcRenderer.invoke("local-agent-activation:read"),
    plan: (request) => ipcRenderer.invoke("local-agent-activation:plan", request),
    start: (request) => ipcRenderer.invoke("local-agent-activation:start", request),
    act: (request) => ipcRenderer.invoke("local-agent-activation:act", request),
    openGuide: (planId) => ipcRenderer.invoke("local-agent-activation:guide", { planId }),
    subscribe: (listener) => {
      const handler = (_event, snapshot) => listener(snapshot);
      ipcRenderer.on("local-agent-activation:changed", handler);
      return () => ipcRenderer.removeListener("local-agent-activation:changed", handler);
    },
  },
  localAgentSetup: {
    inspect: (request) => ipcRenderer.invoke("local-agent-setup:inspect", request),
    act: (request) => ipcRenderer.invoke("local-agent-setup:act", request),
    release: (clientId) => ipcRenderer.invoke("local-agent-setup:release", clientId),
  },
});
