const { contextBridge, ipcRenderer, webUtils } = require("electron");
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const invoke = (channel) => (request) => ipcRenderer.invoke(channel, request);

contextBridge.exposeInMainWorld("puppyoneItemHost", {
  bootstrap: invoke("item-display:bootstrap"),
  ready: invoke("item-display:ready"),
  publish: (type, payload) => ipcRenderer.send("item-display:publish", { type, payload }),
  request: (type, payload) => ipcRenderer.invoke("item-display:request", { type, payload }),
  onConfiguration: (callback) => subscribe("item-host:configuration", callback),
  connectTerminal: invoke("item-display:connect"),
  connectAgent: invoke("item-display:connect"),
  saveDraft: invoke("item-display:draft"),
});
ipcRenderer.on("item-host:port", (event, binding) => {
  window.postMessage({ type: "puppyone-item-port", binding }, "*", event.ports);
});
const heartbeat = setInterval(() => ipcRenderer.send("item-display:heartbeat"), 1000);
window.addEventListener("pagehide", () => clearInterval(heartbeat), { once: true });

// No filesystem, window management, arbitrary IPC or process authority is
// exposed here. Main checks the registered display, kind and project lease.
contextBridge.exposeInMainWorld("puppyoneDesktop", {
  getLocalizationBootstrap: invoke("localization:get-bootstrap"),
  setLanguagePreference: () => Promise.reject(new Error("Language preferences are owned by the application window.")),
  onLocaleChanged: (callback) => subscribe("localization:changed", callback),
  openExternalUrl: invoke("system:open-external-url"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  resourceDragSessionSupported: process.platform === "darwin",
  previewResourceDrag: invoke("resource-transfer:preview-drag"),
  resolveResourceReferences: invoke("resource-transfer:resolve"),
  claimResourceDrop: (request) => ipcRenderer.invoke("resource-transfer:claim-drop", {
    intent: request.intent, targetResource: request.targetResource,
    paths: request.files.map((file) => webUtils.getPathForFile(file)),
  }),
  onResourceDragState: (callback) => subscribe("resource-transfer:state", callback),
  discoverAgentProviders: invoke("agent:providers-discover"),
  discoverLocalAgentConnections: invoke("agent:local-connections-discover"),
  listAgentModels: invoke("agent:models-list"),
  readAgentAccount: invoke("agent:account-read"),
  createAgentSession: invoke("agent:session-create"),
  resumeAgentSession: invoke("agent:session-resume"),
  openAgentSession: invoke("agent:session-open"),
  forkAgentSession: invoke("agent:session-fork"),
  archiveAgentSession: invoke("agent:session-archive"),
  deleteAgentSession: invoke("agent:session-delete"),
  closeAgentSession: invoke("agent:session-close"),
  stageAgentAttachments: (request) => ipcRenderer.invoke("agent:reference-stage", {
    rootPath: request.rootPath, projectContext: request.projectContext, epoch: request.epoch,
    sourcePaths: request.files.map((file) => webUtils.getPathForFile(file)),
  }),
  revokeAgentAttachments: invoke("agent:reference-revoke"),
  resolveAgentWorkspaceReferences: invoke("agent:reference-resolve-workspace"),
  pickAgentWorkspaceReferences: invoke("agent:reference-pick-workspace"),
  startAgentTurn: (request) => ipcRenderer.invoke("agent:command-dispatch", { ...request, kind: "start" }),
  steerAgentTurn: (request) => ipcRenderer.invoke("agent:command-dispatch", { ...request, kind: "steer" }),
  interruptAgentTurn: (request) => ipcRenderer.invoke("agent:command-dispatch", { ...request, kind: "interrupt" }),
  compactAgentSession: invoke("agent:session-compact"),
  resolveAgentApproval: (request) => ipcRenderer.invoke("agent:command-dispatch", { ...request, kind: "approval" }),
  resolveAgentQuestion: (request) => ipcRenderer.invoke("agent:command-dispatch", { ...request, kind: "question" }),
  writeTerminal: (request) => ipcRenderer.send("terminal:input", request),
  resizeTerminal: (request) => ipcRenderer.send("terminal:resize", request),
  updateTerminalAppearance: (request) => ipcRenderer.send("terminal:appearance", request),
});
