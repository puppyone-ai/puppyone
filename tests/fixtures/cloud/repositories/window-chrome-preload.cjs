const { contextBridge, ipcRenderer } = require("electron");

// Fixture-only namespace: the file-workbench harness supplies its own transport,
// but native chrome still uses the production platform and window-layout IPC.
contextBridge.exposeInMainWorld("__nativeCloudChromeBridge", {
  getPlatformCapabilities: () => ipcRenderer.invoke("platform:get-capabilities"),
  getWindowChromeState: () => ipcRenderer.invoke("window-layout:get-chrome-state"),
  onWindowChromeStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("window-layout:chrome-state-changed", listener);
    return () => ipcRenderer.removeListener("window-layout:chrome-state-changed", listener);
  },
});
