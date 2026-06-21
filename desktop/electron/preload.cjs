const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("puppyoneDesktop", {
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
  getGitStatus: (request) => ipcRenderer.invoke("workspace:git-status", request),
  initGitRepository: (request) => ipcRenderer.invoke("workspace:git-init", request),
  getGitCommitDetail: (request) => ipcRenderer.invoke("workspace:git-commit-detail", request),
  getGitFileDiff: (request) => ipcRenderer.invoke("workspace:git-file-diff", request),
  stageGitPaths: (request) => ipcRenderer.invoke("workspace:git-stage", request),
  unstageGitPaths: (request) => ipcRenderer.invoke("workspace:git-unstage", request),
  discardGitPaths: (request) => ipcRenderer.invoke("workspace:git-discard", request),
  commitGit: (request) => ipcRenderer.invoke("workspace:git-commit", request),
  checkoutGitBranch: (request) => ipcRenderer.invoke("workspace:git-checkout-branch", request),
  stashAndCheckoutGitBranch: (request) => ipcRenderer.invoke("workspace:git-stash-checkout-branch", request),
  commitAndCheckoutGitBranch: (request) => ipcRenderer.invoke("workspace:git-commit-checkout-branch", request),
  createGitBranch: (request) => ipcRenderer.invoke("workspace:git-create-branch", request),
  fetchGit: (request) => ipcRenderer.invoke("workspace:git-fetch", request),
  pullGit: (request) => ipcRenderer.invoke("workspace:git-pull", request),
  pushGit: (request) => ipcRenderer.invoke("workspace:git-push", request),
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
