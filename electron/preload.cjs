const { contextBridge, ipcRenderer, webUtils } = require("electron");
const externalViewerPacksEnabled = process.argv.includes("--puppyone-external-viewer-packs=1");
const gitAutoCommitAvailable = process.argv.includes("--puppyone-git-auto-commit=1");
const MAX_INLINE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
let pendingInlineAttachmentBytes = 0;

contextBridge.exposeInMainWorld("puppyoneDesktop", {
  connectAgentSession: (request) => ipcRenderer.invoke("agent:session-connect", request),
  terminateItemExecution: (request) => ipcRenderer.invoke("item-execution:terminate", request),
  retryItemExecutionCleanup: (request) => ipcRenderer.invoke("item-execution:retry-cleanup", request),
  listItemExecutions: (request) => ipcRenderer.invoke("item-execution:list", request),
  openItemExecutionManager: () => ipcRenderer.invoke("item-execution:manage"),
  connectTerminalSession: (request) => ipcRenderer.invoke("terminal:connect", request),
  onSessionRuntimeFailure: (callback) => {
    const listener = (_event, failure) => callback(failure);
    ipcRenderer.on("session:failure", listener);
    return () => ipcRenderer.removeListener("session:failure", listener);
  },
  getWindowChromeState: () => ipcRenderer.invoke("window-layout:get-chrome-state"),
  setWindowChromeProfile: (request) => (
    ipcRenderer.invoke("window-layout:set-chrome-profile", {
      titlebar: request?.titlebar,
      leadingRail: request?.leadingRail === true,
    })
  ),
  performWindowAction: (request) => (
    ipcRenderer.invoke("window-layout:perform-window-action", {
      action: request?.action,
    })
  ),
  onWindowChromeStateChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("window-layout:chrome-state-changed", listener);
    return () => ipcRenderer.removeListener("window-layout:chrome-state-changed", listener);
  },
  setWindowBackground: (request) => {
    ipcRenderer.send("appearance:set-window-background", {
      background: request?.background,
      titlebarBackground: request?.titlebarBackground,
      themeSource: request?.themeSource,
    });
  },
  themes: {
    list: () => ipcRenderer.invoke("theme:list"),
    openDirectory: () => ipcRenderer.invoke("theme:open-directory"),
    create: () => ipcRenderer.invoke("theme:create"),
    syncNativeMenu: (request) => ipcRenderer.invoke("theme:sync-native-menu", {
      pack: request?.pack,
      requiredTargets: Array.isArray(request?.requiredTargets) ? request.requiredTargets : undefined,
      themes: Array.isArray(request?.themes) ? request.themes.map((theme) => ({
        id: theme?.id,
        name: theme?.name,
        targets: theme?.targets,
      })) : [],
    }),
    onSelectionRequested: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, request) => {
        const kind = request?.kind;
        const themeId = request?.themeId;
        if (kind === "pack" && typeof themeId === "string") {
          callback({ kind, themeId });
        }
      };
      ipcRenderer.on("theme:selection-requested", listener);
      return () => ipcRenderer.removeListener("theme:selection-requested", listener);
    },
  },
  setWindowMinimumWidth: (request) => (
    ipcRenderer.invoke("window-layout:set-minimum-width", request)
  ),
  capturePanePreview: (request) => ipcRenderer.invoke("pane-preview:capture", request),
  setNativeSurfaceOccluded: (request) => {
    ipcRenderer.send("native-surfaces:set-overlay-occluded", {
      occluded: request?.occluded === true,
    });
  },
  setNativeSurfacePointerPassthrough: (request) => {
    ipcRenderer.send("native-surfaces:set-pointer-passthrough", {
      active: request?.active === true,
    });
  },
  setNativeSurfacePointerRoutingRegions: (request) => {
    ipcRenderer.send("native-surfaces:set-pointer-routing-regions", {
      regions: Array.isArray(request?.regions) ? request.regions : [],
    });
  },
  onNativeSurfacePointerHover: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("native-surfaces:pointer-hover", listener);
    return () => ipcRenderer.removeListener("native-surfaces:pointer-hover", listener);
  },
  getBuildInfo: () => ipcRenderer.invoke("build-info:get"),
  getPlatformCapabilities: () => ipcRenderer.invoke("platform:get-capabilities"),
  getTelemetryState: () => ipcRenderer.invoke("telemetry:get-state"),
  getTelemetryDisclosure: () => ipcRenderer.invoke("telemetry:get-disclosure"),
  markTelemetryNoticeSeen: () => ipcRenderer.invoke("telemetry:mark-notice-seen"),
  setTelemetryLevel: (request) => ipcRenderer.invoke("telemetry:set-level", {
    level: request?.level,
  }),
  resetTelemetryIdentity: () => ipcRenderer.invoke("telemetry:reset-identity"),
  onTelemetryStateChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("telemetry:state-changed", listener);
    return () => ipcRenderer.removeListener("telemetry:state-changed", listener);
  },
  getLocalizationBootstrap: () => ipcRenderer.invoke("localization:get-bootstrap"),
  setLanguagePreference: (preference) => (
    ipcRenderer.invoke("localization:set-language-preference", preference)
  ),
  onLocaleChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("localization:changed", listener);
    return () => ipcRenderer.removeListener("localization:changed", listener);
  },
  setMarkdownFormatShortcutsActive: (request) => {
    ipcRenderer.send("editor:markdown-format-active", {
      active: request?.active === true,
    });
  },
  onMarkdownFormatShortcut: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => {
      const type = payload?.type;
      if (
        type === "strong"
        || type === "emphasis"
        || type === "underline"
        || type === "strike"
      ) {
        callback({ type });
      }
    };
    ipcRenderer.on("editor:markdown-format-shortcut", listener);
    return () => ipcRenderer.removeListener("editor:markdown-format-shortcut", listener);
  },
  onDocumentSessionFlushRequested: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = async (_event, payload) => {
      const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
      const reason = payload?.reason === "git-auto-commit" ? "git-auto-commit" : "app-close";
      if (!requestId) return;
      try {
        await callback({ requestId, reason });
        ipcRenderer.send("document-session:flush-result", { requestId, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ipcRenderer.send("document-session:flush-result", {
          requestId,
          ok: false,
          error: message.slice(0, 500),
        });
      }
    };
    ipcRenderer.on("document-session:flush-requested", listener);
    return () => ipcRenderer.removeListener("document-session:flush-requested", listener);
  },
  onDocumentSessionCloseCancelled: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => {
      const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
      if (requestId) callback({ requestId });
    };
    ipcRenderer.on("document-session:close-cancelled", listener);
    return () => ipcRenderer.removeListener("document-session:close-cancelled", listener);
  },
  ...(gitAutoCommitAvailable ? {
    getGitAutoCommitSettings: (request = {}) => ipcRenderer.invoke("git-auto-commit:get-settings", request),
    setGitAutoCommitExperimentalOptIn: (request) => (
      ipcRenderer.invoke("git-auto-commit:set-experimental-opt-in", request)
    ),
    setGitAutoCommitWorkspacePolicy: (request) => (
      ipcRenderer.invoke("git-auto-commit:set-workspace-policy", request)
    ),
    onGitAutoCommitStateChanged: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("git-auto-commit:state", listener);
      return () => ipcRenderer.removeListener("git-auto-commit:state", listener);
    },
  } : {}),
  readCloudSession: () => ipcRenderer.invoke("cloud-session:read"),
  readCloudAuthState: () => ipcRenderer.invoke("cloud-auth:read-state"),
  restoreCloudSession: (request) => ipcRenderer.invoke("cloud-session:restore", request),
  startCloudOAuth: (request) => ipcRenderer.invoke("cloud-session:start-oauth", request),
  clearCloudSession: () => ipcRenderer.invoke("cloud-session:clear"),
  onCloudSessionChanged: (callback) => {
    const listener = (_event, session) => callback(session);
    ipcRenderer.on("cloud-session:changed", listener);
    return () => ipcRenderer.removeListener("cloud-session:changed", listener);
  },
  onCloudAuthStateChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("cloud-auth:state", listener);
    return () => ipcRenderer.removeListener("cloud-auth:state", listener);
  },
  onCloudAuthError: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("cloud-auth:error", listener);
    return () => ipcRenderer.removeListener("cloud-auth:error", listener);
  },
  requestCloudApi: (request) => ipcRenderer.invoke("cloud:api-request", request),
  requestCloudSessionApi: (request) => ipcRenderer.invoke("cloud:session-api-request", request),
  cloudInitializationGetState: (request) => ipcRenderer.invoke("cloud-initialization:get-state", request),
  cloudInitializationStart: (request) => ipcRenderer.invoke("cloud-initialization:start", request),
  cloudInitializationCleanup: (request) => ipcRenderer.invoke("cloud-initialization:cleanup", request),
  onCloudInitializationProgress: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("cloud-initialization:progress", listener);
    return () => ipcRenderer.removeListener("cloud-initialization:progress", listener);
  },
  cloudGitConnectProject: (request) => ipcRenderer.invoke("cloud-git:connect-project", request),
  cloudGitAbandonConnect: (request) => ipcRenderer.invoke("cloud-git:abandon-connect", request),
  listCloudAccessPointDirectory: (request) => ipcRenderer.invoke("cloud:access-point-list-directory", request),
  getCloudAccessPointSemantics: (request) => ipcRenderer.invoke("cloud:access-point-semantics", request),
  openExternalUrl: (href) => ipcRenderer.invoke("system:open-external-url", href),
  submitFeedback: (request) => ipcRenderer.invoke("feedback:submit", request),
  markdownWebEmbed: {
    create: (request) => ipcRenderer.invoke("markdown-web-embed:create", request),
    setBounds: (request) => ipcRenderer.invoke("markdown-web-embed:set-bounds", request),
    destroy: (request) => ipcRenderer.invoke("markdown-web-embed:destroy", request),
  },
  getInitialWorkspace: () => ipcRenderer.invoke("window:get-initial-workspace"),
  getLastWorkspace: () => ipcRenderer.invoke("workspace:get-last"),
  getRecentWorkspaces: () => ipcRenderer.invoke("workspace:get-recent"),
  hydrateRecentWorkspaces: () => ipcRenderer.invoke("workspace:hydrate-recent"),
  projectAppearance: {
    list: (request) => ipcRenderer.invoke("project-appearance:list", {
      projectIdentities: Array.isArray(request?.projectIdentities)
        ? request.projectIdentities
        : [],
    }),
    chooseIcon: (request) => ipcRenderer.invoke("project-appearance:choose-icon", {
      projectIdentity: request?.projectIdentity,
    }),
    resetIcon: (request) => ipcRenderer.invoke("project-appearance:reset-icon", {
      projectIdentity: request?.projectIdentity,
    }),
    setEmoji: (request) => ipcRenderer.invoke("project-appearance:set-emoji", {
      projectIdentity: request?.projectIdentity,
      emoji: request?.emoji,
    }),
    onChanged: (callback) => {
      if (typeof callback !== "function") return () => {};
      const listener = (_event, appearance) => callback(appearance);
      ipcRenderer.on("project-appearance:changed", listener);
      return () => ipcRenderer.removeListener("project-appearance:changed", listener);
    },
  },
  removeRecentWorkspace: (folderPath) => ipcRenderer.invoke("workspace:remove-recent", folderPath),
  renameRecentWorkspace: (request) => ipcRenderer.invoke("workspace:rename-recent", request),
  forgetLastWorkspace: () => ipcRenderer.invoke("workspace:forget-last"),
  showHomepage: () => ipcRenderer.invoke("workspace:show-homepage"),
  readProjectSessions: () => ipcRenderer.invoke("project-sessions:read"),
  onWorkspaceOpenRequested: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("workspace:open-requested", listener);
    return () => ipcRenderer.removeListener("workspace:open-requested", listener);
  },
  onProjectSessionsChanged: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("project-sessions:changed", listener);
    return () => ipcRenderer.removeListener("project-sessions:changed", listener);
  },
  openWorkspaceInCurrentWindow: (folderPath) => ipcRenderer.invoke("workspace:open-current", folderPath),
  openWorkspaceInNewWindow: (folderPath) => ipcRenderer.invoke("workspace:open-new-window", folderPath),
  openDroppedWorkspaceInCurrentWindow: (folder) => {
    const folderPath = webUtils.getPathForFile(folder);
    if (typeof folderPath !== "string" || !folderPath.trim()) {
      return Promise.reject(new Error("Dropped folder could not be resolved."));
    }
    return ipcRenderer.invoke("workspace:open-dropped-current", folderPath.trim());
  },
  selectFolder: () => ipcRenderer.invoke("workspace:select-folder-current"),
  selectFolderToAttach: () => ipcRenderer.invoke("workspace:select-folder-attach"),
  attachFolder: (folderPath) => ipcRenderer.invoke("workspace:attach-current", folderPath),
  detachFolder: (folderPath) => ipcRenderer.invoke("workspace:detach-current", folderPath),
  selectFolderInNewWindow: () => ipcRenderer.invoke("workspace:select-folder-new-window"),
  selectLocalProjectLocation: () => ipcRenderer.invoke("workspace:select-project-location-current"),
  getDefaultLocalProjectLocation: () => ipcRenderer.invoke("workspace:default-project-location-current"),
  createLocalProject: (request) => ipcRenderer.invoke("workspace:create-project-current", request),
  cloneRepository: (request) => ipcRenderer.invoke("workspace:clone-repository-current", request),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  resolveResourceReferences: (request) => ipcRenderer.invoke("resource-transfer:resolve", request),
  resourceDragSessionSupported: process.platform === "darwin",
  previewResourceDrag: () => ipcRenderer.invoke("resource-transfer:preview-drag"),
  claimResourceDrop: (request) => ipcRenderer.invoke("resource-transfer:claim-drop", {
    intent: request.intent, targetResource: request.targetResource,
    paths: request.files.map((file) => webUtils.getPathForFile(file)),
  }),
  inspectResourceDrop: (request) => {
    const files = Array.isArray(request?.files) ? request.files : [];
    const paths = files.map((file) => webUtils.getPathForFile(file));
    if (paths.length === 0 || paths.some((entry) => typeof entry !== "string" || !entry.trim())) {
      return Promise.reject(new Error("One or more dropped resources could not be resolved."));
    }
    return ipcRenderer.invoke("resource-transfer:inspect-drop", { paths });
  },
  onResourceDragState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("resource-transfer:state", handler);
    return () => ipcRenderer.removeListener("resource-transfer:state", handler);
  },
  startResourceDrag: (request) => ipcRenderer.invoke("resource-transfer:start-drag", request),
  startProjectRootDrag: (request) => ipcRenderer.invoke("resource-transfer:start-project-drag", {
    path: request?.path,
  }),
  listFolderChildren: (request) => ipcRenderer.invoke("workspace:list-folder-children", request),
  resolveNode: (request) => ipcRenderer.invoke("workspace:resolve-node", request),
  readFile: (request) => ipcRenderer.invoke("workspace:read-file", request),
  openDatabasePreview: (request) => ipcRenderer.invoke("database-preview:open", request),
  readDatabasePreviewPage: (request) => ipcRenderer.invoke("database-preview:page", request),
  closeDatabasePreview: (request) => ipcRenderer.invoke("database-preview:close", request),
  getFileUrl: (request) => ipcRenderer.invoke("workspace:get-file-url", request),
  createPreviewDocument: (request) => ipcRenderer.invoke("workspace:create-preview-document", request),
  revokeFileUrl: (request) => ipcRenderer.invoke("workspace:revoke-file-url", request),
  convertOfficeDocumentToDocx: (request) => ipcRenderer.invoke("workspace:convert-office-docx", request),
  cancelOfficeDocumentToDocxConversion: (request) => ipcRenderer.invoke("workspace:convert-office-docx-cancel", request),
  writeFile: (request) => ipcRenderer.invoke("workspace:write-file", request),
  createEntry: (request) => ipcRenderer.invoke("workspace:create-entry", request),
  instantiateTemplate: (request) => ipcRenderer.invoke("workspace:instantiate-template", request),
  renameEntry: (request) => ipcRenderer.invoke("workspace:rename-entry", request),
  moveEntry: (request) => ipcRenderer.invoke("workspace:move-entry", request),
  copyEntry: (request) => ipcRenderer.invoke("workspace:copy-entry", request),
  copyEntryBetweenRoots: (request) => ipcRenderer.invoke("workspace:copy-entry-between-roots", request),
  importEntries: (request) => {
    const files = Array.isArray(request?.files) ? request.files : [];
    const sourcePaths = files
      .map((file) => webUtils.getPathForFile(file))
      .filter((sourcePath) => typeof sourcePath === "string" && sourcePath.trim().length > 0);
    if (sourcePaths.length === 0) {
      return Promise.reject(new Error("No dropped files could be resolved."));
    }
    return ipcRenderer.invoke("workspace:import-entries", {
      rootPath: request?.rootPath,
      targetFolderPath: request?.targetFolderPath ?? null,
      sourcePaths,
      ...(request?.preferredName === undefined ? {} : { preferredName: request.preferredName }),
    });
  },
  deleteEntry: (request) => ipcRenderer.invoke("workspace:delete-entry", request),
  revealEntryInFinder: (request) => ipcRenderer.invoke("workspace:reveal-entry-in-finder", request),
  openEntryExternal: (request) => ipcRenderer.invoke("workspace:open-entry-external", request),
  startAppPreview: (request) => ipcRenderer.invoke("app-preview:start", request),
  restartAppPreview: (request) => ipcRenderer.invoke("app-preview:restart", request),
  stopAppPreview: (request) => ipcRenderer.invoke("app-preview:stop", request),
  getAppPreviewLogs: (request) => ipcRenderer.invoke("app-preview:get-logs", request),
  openAppPreviewExternal: (request) => ipcRenderer.invoke("app-preview:open-external", request),
  onAppPreviewRuntimeState: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("app-preview:runtime-state", listener);
    return () => ipcRenderer.removeListener("app-preview:runtime-state", listener);
  },
  watchWorkspace: (rootPath, callback) => {
    const listener = (_event, payload) => {
      if (payload?.rootPath === rootPath) callback(payload);
    };
    ipcRenderer.on("workspace:changed", listener);
    let subscriptionId = null;
    let stopped = false;
    const ready = ipcRenderer.invoke("workspace:watch-start", { rootPath })
      .then((result) => {
        subscriptionId = result?.subscriptionId ?? null;
        // If teardown ran before start resolved, stop the now-known subscription.
        if (stopped && subscriptionId) {
          ipcRenderer.invoke("workspace:watch-stop", { subscriptionId }).catch(() => {});
        }
        return {
          subscriptionId,
          rootPath: result?.rootPath ?? rootPath,
        };
      })
      .catch((error) => {
        callback({
          rootPath,
          eventType: "error",
          path: null,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      });
    const stop = () => {
      stopped = true;
      ipcRenderer.removeListener("workspace:changed", listener);
      if (subscriptionId) {
        ipcRenderer.invoke("workspace:watch-stop", { subscriptionId }).catch(() => {});
      }
    };
    return { stop, ready };
  },
  startGitRepositoryWatch: (request) => ipcRenderer.invoke("git-repository:watch-start", request),
  stopGitRepositoryWatch: (request) => ipcRenderer.invoke("git-repository:watch-stop", request),
  onGitRepositoryInvalidated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("git-repository:invalidated", listener);
    return () => ipcRenderer.removeListener("git-repository:invalidated", listener);
  },
  onGitRepositoryWindowFocus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("git-repository:window-focus", listener);
    return () => ipcRenderer.removeListener("git-repository:window-focus", listener);
  },
  getLatestAiEditReviewRequest: (request) => ipcRenderer.invoke("ai-edit-review:get-latest", request),
  onAiEditReviewUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ai-edit-review:updated", listener);
    return () => ipcRenderer.removeListener("ai-edit-review:updated", listener);
  },
  getGitStatus: (request) => ipcRenderer.invoke("workspace:git-status", request),
  cancelGitStatus: (request) => ipcRenderer.invoke("workspace:git-status-cancel", request),
  getGitBranchGraph: (request) => ipcRenderer.invoke("workspace:git-branch-graph", request),
  cancelGitBranchGraph: (request) => ipcRenderer.invoke("workspace:git-branch-graph-cancel", request),
  initGitRepository: (request) => ipcRenderer.invoke("workspace:git-init", request),
  removeGitRemote: (request) => ipcRenderer.invoke("workspace:git-remove-remote", request),
  readPuppyoneConfig: (request) => ipcRenderer.invoke("workspace:puppyone-config-read", request),
  writePuppyoneConfig: (request) => ipcRenderer.invoke("workspace:puppyone-config-write", request),
  getGitCommitDetail: (request) => ipcRenderer.invoke("workspace:git-commit-detail", request),
  getGitFileDiff: (request) => ipcRenderer.invoke("workspace:git-file-diff", request),
  cancelGitFileDiff: (request) => ipcRenderer.invoke("workspace:git-file-diff-cancel", request),
  readGitDiffResource: (request) => ipcRenderer.invoke("workspace:git-diff-resource-read", request),
  releaseGitDiffResources: (request) => ipcRenderer.invoke("workspace:git-diff-resource-release", request),
  stageGitPaths: (request) => ipcRenderer.invoke("workspace:git-stage", request),
  stageAllGitChanges: (request) => ipcRenderer.invoke("workspace:git-stage-all", request),
  unstageGitPaths: (request) => ipcRenderer.invoke("workspace:git-unstage", request),
  unstageAllGitChanges: (request) => ipcRenderer.invoke("workspace:git-unstage-all", request),
  discardGitPaths: (request) => ipcRenderer.invoke("workspace:git-discard", request),
  discardAllGitChanges: (request) => ipcRenderer.invoke("workspace:git-discard-all", request),
  commitGit: (request) => ipcRenderer.invoke("workspace:git-commit", request),
  stashGitChanges: (request) => ipcRenderer.invoke("workspace:git-stash", request),
  continueGitOperation: (request) => ipcRenderer.invoke("workspace:git-operation-continue", request),
  abortGitOperation: (request) => ipcRenderer.invoke("workspace:git-operation-abort", request),
  checkoutGitBranch: (request) => ipcRenderer.invoke("workspace:git-checkout-branch", request),
  stashAndCheckoutGitBranch: (request) => ipcRenderer.invoke("workspace:git-stash-checkout-branch", request),
  commitAndCheckoutGitBranch: (request) => ipcRenderer.invoke("workspace:git-commit-checkout-branch", request),
  createGitBranch: (request) => ipcRenderer.invoke("workspace:git-create-branch", request),
  fetchGit: (request) => ipcRenderer.invoke("workspace:git-fetch", request),
  pullGit: (request) => ipcRenderer.invoke("workspace:git-pull", request),
  pushGit: (request) => ipcRenderer.invoke("workspace:git-push", request),
  pushGitCommitToRemote: (request) => ipcRenderer.invoke("workspace:git-push-commit-to-remote", request),
  publishGitBranch: (request) => ipcRenderer.invoke("workspace:git-publish-branch", request),
  syncGit: (request) => ipcRenderer.invoke("workspace:git-sync", request),
  getUpdateState: () => ipcRenderer.invoke("updates:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  downloadUpdate: () => ipcRenderer.invoke("updates:download"),
  updateNow: () => ipcRenderer.invoke("updates:update-now"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  setAutomaticallyDownloadUpdates: (request) => (
    ipcRenderer.invoke("updates:set-automatically-download", request)
  ),
  onUpdateStateChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("updates:state", listener);
    return () => ipcRenderer.removeListener("updates:state", listener);
  },
  discoverAgentProviders: (request) => ipcRenderer.invoke("agent:providers-discover", request),
  discoverLocalAgentConnections: (request) => ipcRenderer.invoke("agent:local-connections-discover", request),
  listAgentModels: (request) => ipcRenderer.invoke("agent:models-list", request),
  readAgentAccount: (request) => ipcRenderer.invoke("agent:account-read", request),
  createAgentSession: (request) => ipcRenderer.invoke("agent:session-create", request),
  resumeAgentSession: (request) => ipcRenderer.invoke("agent:session-resume", request),
  openAgentSession: (request) => ipcRenderer.invoke("agent:session-open", request),
  replayAgentSession: (request) => ipcRenderer.invoke("agent:session-replay", request),
  attachAgentSession: (request) => ipcRenderer.invoke("agent:session-attach", request),
  acknowledgeAgentSession: (request) => ipcRenderer.invoke("agent:session-feed-ack", request),
  readAgentSessionWatermark: (request) => ipcRenderer.invoke("agent:session-feed-watermark", request),
  detachAgentSession: (request) => ipcRenderer.invoke("agent:session-detach", request),
  listAgentSessions: (request) => ipcRenderer.invoke("agent:sessions-list", request),
  forkAgentSession: (request) => ipcRenderer.invoke("agent:session-fork", request),
  archiveAgentSession: (request) => ipcRenderer.invoke("agent:session-archive", request),
  deleteAgentSession: (request) => ipcRenderer.invoke("agent:session-delete", request),
  closeAgentSession: (request) => ipcRenderer.invoke("agent:session-close", request),
  /** @param {import('../shared/agent-contract/types').AgentReferenceStageBridgeRequest} request */
  stageAgentAttachments: async (request) => {
    const files = Array.isArray(request?.files) ? request.files : [];
    if (files.length === 0 || files.length > 32) throw new Error("Select between 1 and 32 attachment files.");
    // Capture native paths before any asynchronous byte reads. getPathForFile
    // validates File identity; a genuine clipboard/browser File may have no path.
    const sourcePaths = files.map((file) => webUtils.getPathForFile(file));
    // Source conversion must preserve the project client’s captured generation.
    // Main validates it against the sender; never infer a currently active project.
    const context = { rootPath: request?.rootPath, epoch: request?.epoch, projectContext: request?.projectContext };
    if (sourcePaths.every((sourcePath) => typeof sourcePath === "string" && sourcePath.trim())) {
      return ipcRenderer.invoke("agent:reference-stage", { ...context, sourcePaths });
    }
    let inlineBytes = 0;
    files.forEach((file, index) => {
      if (sourcePaths[index]) return;
      if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("The selected attachment is empty or invalid.");
      inlineBytes += file.size;
    });
    if (inlineBytes > MAX_INLINE_ATTACHMENT_BYTES || pendingInlineAttachmentBytes + inlineBytes > MAX_INLINE_ATTACHMENT_BYTES) {
      throw new Error("Attachments exceed the 25 MB in-flight safety limit. Try fewer files at a time.");
    }
    pendingInlineAttachmentBytes += inlineBytes;
    try {
      const sources = [];
      for (const [index, file] of files.entries()) {
        if (sourcePaths[index]) { sources.push({ path: sourcePaths[index] }); continue; }
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.byteLength !== file.size) throw new Error("The selected attachment changed while it was being read.");
        sources.push({ name: file.name, bytes });
      }
      return await ipcRenderer.invoke("agent:reference-stage", { ...context, sources });
    } finally {
      pendingInlineAttachmentBytes -= inlineBytes;
    }
  },
  revokeAgentAttachments: (request) => ipcRenderer.invoke("agent:reference-revoke", request),
  resolveAgentWorkspaceReferences: (request) => ipcRenderer.invoke("agent:reference-resolve-workspace", request),
  pickAgentWorkspaceReferences: (request) => ipcRenderer.invoke("agent:reference-pick-workspace", request),
  startAgentTurn: (request) => ipcRenderer.invoke("agent:command-dispatch", { ...request, kind: "start" }),
  steerAgentTurn: (request) => ipcRenderer.invoke("agent:command-dispatch", { ...request, kind: "steer" }),
  interruptAgentTurn: (request) => ipcRenderer.invoke("agent:command-dispatch", { ...request, kind: "interrupt" }),
  compactAgentSession: (request) => ipcRenderer.invoke("agent:session-compact", request),
  resolveAgentApproval: (request) => ipcRenderer.invoke("agent:command-dispatch", { ...request, kind: "approval" }),
  resolveAgentQuestion: (request) => ipcRenderer.invoke("agent:command-dispatch", { ...request, kind: "question" }),
  onAgentSessionFrame: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:session-frame", listener);
    return () => ipcRenderer.removeListener("agent:session-frame", listener);
  },
  ...(externalViewerPacksEnabled ? {
    viewerPacks: {
      getSnapshot: () => ipcRenderer.invoke("viewer-pack:get-snapshot"),
      installLocal: () => ipcRenderer.invoke("viewer-pack:install-local"),
      disable: (request) => ipcRenderer.invoke("viewer-pack:disable", request),
      uninstall: (request) => ipcRenderer.invoke("viewer-pack:uninstall", request),
      activate: (request) => ipcRenderer.invoke("viewer-pack:activate", request),
      setBounds: (request) => ipcRenderer.invoke("viewer-pack:set-bounds", request),
      destroySession: (request) => ipcRenderer.invoke("viewer-pack:destroy-session", request),
      onSessionState: (callback) => {
        if (typeof callback !== "function") return () => {};
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on("viewer-pack:session-state", listener);
        return () => ipcRenderer.removeListener("viewer-pack:session-state", listener);
      },
    },
  } : {}),
  discoverLocalAgentInstallations: (request) => ipcRenderer.invoke("local-agent-installation:discover", request),
  localAgentSetup: {
    inspect: (request) => ipcRenderer.invoke("local-agent-setup:inspect", request),
    act: (request) => ipcRenderer.invoke("local-agent-setup:act", request),
    release: (clientId) => ipcRenderer.invoke("local-agent-setup:release", clientId),
  },
  modelConnections: {
    read: () => ipcRenderer.invoke("model-connections:read"),
    discover: () => ipcRenderer.invoke("model-connections:discover"),
    save: (request) => ipcRenderer.invoke("model-connections:save", request),
    remove: (request) => ipcRenderer.invoke("model-connections:remove", request),
    refresh: (request) => ipcRenderer.invoke("model-connections:refresh", request),
    verify: (request) => ipcRenderer.invoke("model-connections:verify", request),
    subscribe: (callback) => {
      const listener = (_event, snapshot) => callback(snapshot);
      ipcRenderer.on("model-connections:changed", listener);
      return () => ipcRenderer.removeListener("model-connections:changed", listener);
    },
  },
  onLocalAgentInstallationProgress: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("local-agent-installation:progress", listener);
    return () => ipcRenderer.removeListener("local-agent-installation:progress", listener);
  },
  onLocalAgentInstallationsChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("local-agent-installation:changed", listener);
    return () => ipcRenderer.removeListener("local-agent-installation:changed", listener);
  },
  createTerminal: (request) => ipcRenderer.invoke("terminal:create", request),
  writeTerminal: (request) => ipcRenderer.send("terminal:input", request),
  resizeTerminal: (request) => ipcRenderer.send("terminal:resize", request),
  updateTerminalAppearance: (request) => ipcRenderer.send("terminal:appearance", request),
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
  subscribeAgentActivity: () => ipcRenderer.invoke("agent-activity:subscribe"),
  unsubscribeAgentActivity: () => ipcRenderer.send("agent-activity:unsubscribe"),
  onAgentActivityEvent: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("agent-activity:event", listener);
    return () => ipcRenderer.removeListener("agent-activity:event", listener);
  },
  getAgentActivityEnrollment: () => ipcRenderer.invoke("agent-activity:enrollment-snapshot"),
  setAgentActivityEnrollment: (request) => ipcRenderer.invoke("agent-activity:enrollment-set", request),
});

// Transfer data ports into the application document; session authority stays in Main.
ipcRenderer.on("session:port", (event, binding) => {
  window.postMessage({ type: "puppyone-session-port", binding }, "*", event.ports);
});
