const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("paneContracts", Object.fromEntries(
  ["config", "capture", "verifyClosed", "seed", "read", "persist", "input", "nativeState", "record"].map((method) => [method, (...args) => ipcRenderer.invoke(`pane-contracts:${method}`, ...args)]),
));
contextBridge.exposeInMainWorld("puppyoneDesktop", {
  setNativeSurfacePointerPassthrough: (request) => ipcRenderer.send("native-surfaces:set-pointer-passthrough", request),
  setNativeSurfaceOccluded: (request) => ipcRenderer.send("native-surfaces:set-overlay-occluded", request),
  editorSurfaces: {
    ...Object.fromEntries(["activate", "setBounds", "destroy", "updateAppearance"].map((method) => [method, (request) => ipcRenderer.invoke(`pane-contracts:surface:${method}`, request)])),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on("editor-surface:state", handler);
      return () => ipcRenderer.removeListener("editor-surface:state", handler);
    },
  },
});
