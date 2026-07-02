const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("puppyoneDesktop", {
  readCloudSession: () => ipcRenderer.invoke("cloud-session:read"),
  restoreCloudSession: (request) => ipcRenderer.invoke("cloud-session:restore", request),
  signInCloudSessionWithPassword: (request) => ipcRenderer.invoke("cloud-session:sign-in-password", request),
  startCloudOAuth: (request) => ipcRenderer.invoke("cloud-session:start-oauth", request),
  clearCloudSession: () => ipcRenderer.invoke("cloud-session:clear"),
  onCloudSessionChanged: (callback) => {
    const listener = (_event, session) => callback(session);
    ipcRenderer.on("cloud-session:changed", listener);
    return () => ipcRenderer.removeListener("cloud-session:changed", listener);
  },
  onCloudAuthError: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("cloud-auth:error", listener);
    return () => ipcRenderer.removeListener("cloud-auth:error", listener);
  },
  requestCloudApi: (request) => ipcRenderer.invoke("cloud:api-request", request),
  requestCloudSessionApi: (request) => ipcRenderer.invoke("cloud:session-api-request", request),
  listCloudAccessPointDirectory: (request) => ipcRenderer.invoke("cloud:access-point-list-directory", request),
  getCloudAccessPointSemantics: (request) => ipcRenderer.invoke("cloud:access-point-semantics", request),
  openExternalUrl: (href) => ipcRenderer.invoke("system:open-external-url", href),
  getLastWorkspace: () => ipcRenderer.invoke("workspace:get-last"),
  rememberLastWorkspace: (folderPath) => ipcRenderer.invoke("workspace:remember-last", folderPath),
  forgetLastWorkspace: () => ipcRenderer.invoke("workspace:forget-last"),
  selectFolder: () => ipcRenderer.invoke("workspace:select-folder"),
  workspaceFromPath: (folderPath) => ipcRenderer.invoke("workspace:from-path", folderPath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  listFolderChildren: (request) => ipcRenderer.invoke("workspace:list-folder-children", request),
  readFile: (request) => ipcRenderer.invoke("workspace:read-file", request),
  writeFile: (request) => ipcRenderer.invoke("workspace:write-file", request),
  createEntry: (request) => ipcRenderer.invoke("workspace:create-entry", request),
  renameEntry: (request) => ipcRenderer.invoke("workspace:rename-entry", request),
  moveEntry: (request) => ipcRenderer.invoke("workspace:move-entry", request),
  deleteEntry: (request) => ipcRenderer.invoke("workspace:delete-entry", request),
  watchWorkspace: (rootPath, callback) => {
    const listener = (_event, payload) => {
      if (payload?.rootPath === rootPath) callback(payload);
    };
    ipcRenderer.on("workspace:changed", listener);
    ipcRenderer.invoke("workspace:watch-start", { rootPath }).catch((error) => {
      callback({
        rootPath,
        eventType: "error",
        path: null,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return () => {
      ipcRenderer.removeListener("workspace:changed", listener);
      ipcRenderer.invoke("workspace:watch-stop", { rootPath }).catch(() => {});
    };
  },
  getLatestAiEditReviewRequest: (request) => ipcRenderer.invoke("ai-edit-review:get-latest", request),
  onAiEditReviewUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ai-edit-review:updated", listener);
    return () => ipcRenderer.removeListener("ai-edit-review:updated", listener);
  },
  getGitStatus: (request) => ipcRenderer.invoke("workspace:git-status", request),
  getGitBranchGraph: (request) => ipcRenderer.invoke("workspace:git-branch-graph", request),
  initGitRepository: (request) => ipcRenderer.invoke("workspace:git-init", request),
  configureGitCloudRemote: (request) => ipcRenderer.invoke("workspace:git-configure-cloud-remote", request),
  readPuppyoneConfig: (request) => ipcRenderer.invoke("workspace:puppyone-config-read", request),
  writePuppyoneConfig: (request) => ipcRenderer.invoke("workspace:puppyone-config-write", request),
  getGitCommitDetail: (request) => ipcRenderer.invoke("workspace:git-commit-detail", request),
  getGitFileDiff: (request) => ipcRenderer.invoke("workspace:git-file-diff", request),
  stageGitPaths: (request) => ipcRenderer.invoke("workspace:git-stage", request),
  stageAllGitChanges: (request) => ipcRenderer.invoke("workspace:git-stage-all", request),
  unstageGitPaths: (request) => ipcRenderer.invoke("workspace:git-unstage", request),
  unstageAllGitChanges: (request) => ipcRenderer.invoke("workspace:git-unstage-all", request),
  discardGitPaths: (request) => ipcRenderer.invoke("workspace:git-discard", request),
  discardAllGitChanges: (request) => ipcRenderer.invoke("workspace:git-discard-all", request),
  commitGit: (request) => ipcRenderer.invoke("workspace:git-commit", request),
  checkoutGitBranch: (request) => ipcRenderer.invoke("workspace:git-checkout-branch", request),
  stashAndCheckoutGitBranch: (request) => ipcRenderer.invoke("workspace:git-stash-checkout-branch", request),
  commitAndCheckoutGitBranch: (request) => ipcRenderer.invoke("workspace:git-commit-checkout-branch", request),
  createGitBranch: (request) => ipcRenderer.invoke("workspace:git-create-branch", request),
  fetchGit: (request) => ipcRenderer.invoke("workspace:git-fetch", request),
  pullGit: (request) => ipcRenderer.invoke("workspace:git-pull", request),
  pushGit: (request) => ipcRenderer.invoke("workspace:git-push", request),
  publishGitBranch: (request) => ipcRenderer.invoke("workspace:git-publish-branch", request),
  syncGit: (request) => ipcRenderer.invoke("workspace:git-sync", request),
  getUpdateState: () => ipcRenderer.invoke("updates:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  downloadUpdate: () => ipcRenderer.invoke("updates:download"),
  updateNow: () => ipcRenderer.invoke("updates:update-now"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdateStateChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("updates:state", listener);
    return () => ipcRenderer.removeListener("updates:state", listener);
  },
  createTerminal: (request) => ipcRenderer.invoke("terminal:create", request),
  writeTerminal: (request) => ipcRenderer.send("terminal:input", request),
  resizeTerminal: (request) => ipcRenderer.send("terminal:resize", request),
  closeTerminal: (id) => ipcRenderer.invoke("terminal:close", id),
  onTerminalData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.removeListener("terminal:data", listener);
  },
  onTerminalExit: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("terminal:exit", listener);
    return () => ipcRenderer.removeListener("terminal:exit", listener);
  },
});
