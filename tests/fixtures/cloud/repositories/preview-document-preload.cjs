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
