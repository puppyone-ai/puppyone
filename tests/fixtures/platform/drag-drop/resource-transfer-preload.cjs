const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("puppyoneDesktop", {
  resourceDragSessionSupported: process.platform === "darwin",
  previewResourceDrag: () => ipcRenderer.invoke("resource-transfer:preview-drag"),
  claimResourceDrop: (request) => ipcRenderer.invoke("resource-transfer:claim-drop", {
    intent: request.intent, targetResource: request.targetResource,
    paths: request.files.map((file) => webUtils.getPathForFile(file)),
  }),
  onResourceDragState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("resource-transfer:state", handler);
    return () => ipcRenderer.removeListener("resource-transfer:state", handler);
  },
  startResourceDrag: (request) => ipcRenderer.invoke("resource-transfer:start-drag", request),
  resolveResourceReferences: (request) => ipcRenderer.invoke("resource-transfer:resolve", request),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  setNativeSurfacePointerPassthrough: (request) => {
    ipcRenderer.send("native-surfaces:set-pointer-passthrough", request);
    ipcRenderer.send("resource-smoke:event", { pointerPassthrough: request });
  },
  setNativeSurfaceOccluded: (request) => {
    ipcRenderer.send("native-surfaces:set-overlay-occluded", request);
    ipcRenderer.send("resource-smoke:event", { occlusion: request });
  },
});
contextBridge.exposeInMainWorld("resourceSmoke", {
  config: () => ipcRenderer.invoke("resource-smoke:config"),
  read: (resource) => ipcRenderer.invoke("resource-smoke:read", resource),
  record: (entry) => ipcRenderer.send("resource-smoke:event", entry),
});
