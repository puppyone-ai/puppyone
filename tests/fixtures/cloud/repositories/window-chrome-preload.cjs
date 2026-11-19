const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("__nativeCloudPreviewBridge", {
  retainCloudPreviewResource: (request) => ipcRenderer.invoke("cloud-preview:retain-resource", request),
  revokeCloudPreviewResource: (request) => ipcRenderer.invoke("cloud-preview:revoke-resource", request),
  openCloudDatabasePreview: (request) => ipcRenderer.invoke("cloud-preview:database-open", request),
  readCloudDatabasePreviewPage: (request) => ipcRenderer.invoke("cloud-preview:database-page", request),
  closeCloudNativePreview: (request) => ipcRenderer.invoke("cloud-preview:close", request),
  convertCloudOfficeDocument: (request) => ipcRenderer.invoke("cloud-preview:office-convert", request),
  createSandboxedPreviewDocument: (request) => ipcRenderer.invoke("preview-document:create", request),
  revokeSandboxedPreviewDocument: (request) => ipcRenderer.invoke("preview-document:revoke", request),
});

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
