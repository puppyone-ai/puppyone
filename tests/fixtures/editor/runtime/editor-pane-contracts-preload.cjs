const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("paneContracts", Object.fromEntries(
  ["config", "capture", "verifyClosed", "seed", "read", "persist", "input", "record"].map((method) => [method, (...args) => ipcRenderer.invoke(`pane-contracts:${method}`, ...args)]),
));
