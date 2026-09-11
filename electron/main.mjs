import { installBrokenStdioGuards } from "./main/stdio-guard.mjs";
import { app, BrowserWindow, dialog, ipcMain, Menu, MessageChannelMain, nativeImage, nativeTheme, powerMonitor, protocol, safeStorage, session as electronSession, shell, utilityProcess, webContents, WebContentsView } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  getMimeType,
  openWorkspaceFileRangeStream,
  readWorkspaceTextFile,
  readWorkspaceFile,
  statWorkspaceFile,
  resolveExistingWorkspacePath as resolveLocalWorkspaceFilePath,
  resolveLocalWorkspaceIdentity,
  resolveWorkspacePath as resolveLocalWorkspacePath,
  workspaceFromPath,
} from "../local-api/workspace.mjs";
import { initializeWorkspaceEditReview } from "../local-api/edit-review.mjs";
import { resolveRuntimeAppImage, setDevelopmentDockIcon } from "./main/app-icon.mjs";
import { createUpdateService } from "./update-service.mjs";
import { createAppPreviewRuntime } from "./app-preview-runtime.mjs";
import { createAppPreviewService } from "./main/app-preview-service.mjs";
import {
  configureDesktopApplicationIdentity,
  loadDesktopBuildInfo,
} from "./main/build-info-service.mjs";
import { createEphemeralAgentSessionCache } from "./main/agent/cache/ephemeral-agent-session-cache.mjs";
import { createAgentConversationCatalog } from "./main/agent/persistence/agent-conversation-catalog.mjs";
import { createAgentSessionRepository } from "./main/agent/persistence/agent-session-repository.mjs";
import { createAgentProcessSupervisor } from "./main/agent/application/processes/agent-process-supervisor.mjs";
import { createApplicationCloseCoordinator } from "./main/workspace/project-sessions/application-close-coordinator.mjs";
import { createAgentService } from "./main/agent/application/agent-service.mjs";
import { createProjectSessionHost } from "./main/bootstrap/create-project-session-host.mjs";
import { registerProjectSessionIpc } from "./main/ipc/project-session-ipc.mjs";
import { createAgentAttachmentStore } from "./main/agent/infrastructure/attachments/agent-attachment-store.mjs";
import { createLocalAgentInventory } from "./main/agent/connections/local-agent-inventory.mjs";
import { createDefaultAgentRuntimeHost } from "./main/agent/bootstrap/create-agent-runtime-host.mjs";
import {
  getCloudApiErrorMessage,
  requestCloudApi,
} from "./main/cloud-api-client.mjs";
import { createCloudAuthService } from "./cloud-auth-service.mjs";
import {
  createApplicationQuitIntent,
  createDocumentSessionCloseCoordinator,
} from "./main/document-session-close-coordinator.mjs";
import {
  createDesktopLaunchIntent,
  handleSecondInstanceLaunch,
} from "./main/desktop-launch-intent.mjs";
import { registerAgentIpcHandlers } from "./main/ipc/agent-ipc.mjs";
import { createWorkspaceResourceResolver } from "./main/workspace-resource-resolver.mjs";
import { loadMacosResourceDrag } from "./main/platform/macos/resource-drag.mjs";
import { registerResourceTransferIpcHandlers } from "./main/ipc/resource-transfer-ipc.mjs";
import { registerAgentActivityIpcHandlers } from "./main/ipc/agent-activity-ipc.mjs";
import { registerAppearanceIpcHandlers } from "./main/ipc/appearance-ipc.mjs";
import {
  registerThemeIpcHandlers,
  THEME_SELECTION_REQUESTED_CHANNEL,
} from "./main/ipc/theme-ipc.mjs";
import { registerAppPreviewIpcHandlers } from "./main/ipc/app-preview-ipc.mjs";
import { registerBuildInfoIpcHandlers } from "./main/ipc/build-info-ipc.mjs";
import { registerPlatformIpcHandlers } from "./main/ipc/platform-ipc.mjs";
import { registerCloudIpcHandlers } from "./main/ipc/cloud-ipc.mjs";
import { registerCloudPublishIpcHandlers } from "./main/ipc/cloud-publish-ipc.mjs";
import { registerMarkdownWebEmbedIpcHandlers } from "./main/ipc/markdown-web-embed-ipc.mjs";
import {
  attachMarkdownFormatShortcuts,
  dispatchMarkdownEditorCommand,
  isMarkdownEditorActive,
  registerMarkdownFormatIpcHandlers,
} from "./main/ipc/markdown-format-ipc.mjs";
import { registerNativeSurfaceOcclusionIpcHandlers } from "./main/ipc/native-surface-occlusion-ipc.mjs";
import { registerNativeSurfacePointerPassthroughIpcHandlers } from "./main/ipc/native-surface-pointer-passthrough-ipc.mjs";
import { registerPanePreviewIpcHandlers } from "./main/ipc/pane-preview-ipc.mjs";
import { registerLocalizationIpcHandlers } from "./main/ipc/localization-ipc.mjs";
import { registerTelemetryIpcHandlers } from "./main/ipc/telemetry-ipc.mjs";
import { createMarkdownWebEmbedService } from "./main/markdown-web-embed-service.mjs";
import { createExternalNavigationService } from "./main/external-navigation-service.mjs";
import { createNativeSurfaceOcclusionCoordinator } from "./main/native-surfaces/occlusion-coordinator.mjs";
import { createNativeSurfacePointerPassthroughCoordinator } from "./main/native-surfaces/pointer-passthrough-coordinator.mjs";
import { createDesktopNativeMenuService } from "./main/native-menu-service.mjs";
import { createNativeUpdateMenuAction } from "./main/native-update-menu-action.mjs";
import { registerFeedbackIpcHandlers } from "./main/ipc/feedback-ipc.mjs";
import { registerSystemIpcHandlers } from "./main/ipc/system-ipc.mjs";
import { registerTerminalIpcHandlers } from "./main/ipc/terminal-ipc.mjs";
import { registerWorkspaceFileIpcHandlers } from "./main/ipc/workspace-files-ipc.mjs";
import { registerWorkspaceGitIpcHandlers } from "./main/ipc/workspace-git-ipc.mjs";
import { registerWorkspaceNavigationIpcHandlers } from "./main/ipc/workspace-navigation-ipc.mjs";
import { registerWorkspaceWatchIpcHandlers } from "./main/ipc/workspace-watch-ipc.mjs";
import { registerWindowLayoutIpcHandlers } from "./main/ipc/window-layout-ipc.mjs";
import { registerProjectAppearanceIpcHandlers } from "./main/ipc/project-appearance-ipc.mjs";
import { registerGitMetadataWatchIpcHandlers } from "./main/ipc/git-metadata-watch-ipc.mjs";
import { registerLocalFileProtocol } from "./main/local-file-protocol.mjs";
import { createLocalFileCapabilityStore } from "./main/local-file-capabilities.mjs";
import { createProjectAppearanceStore } from "./main/project-appearance/project-appearance-store.mjs";
import { createProjectAppearanceService } from "./main/project-appearance/project-appearance-service.mjs";
import { registerProjectIconProtocol } from "./main/project-appearance/project-icon-protocol.mjs";
import { createEditorSurfaceResourceAdmission } from "./main/editor-surfaces/resource-admission.mjs";
import { installWindowNavigationSecurity, requireNonEmptyString } from "./main/security.mjs";
import { createTerminalProcessService } from "./main/item-hosts/terminal-process-service.mjs";
import { createAgentProcessService } from "./main/item-hosts/agent-process-service.mjs";
import { createItemHostBudget } from "./main/item-hosts/resource-budget.mjs";
import { createItemRendererAuthority } from "./main/item-hosts/renderer-authority.mjs";
import { createItemDisplayManager } from "./main/item-hosts/display-manager.mjs";
import { registerItemHostIpc } from "./main/item-hosts/ipc.mjs";
import { createTerminalAgentLocator } from "./main/terminal-agent/terminal-agent-locator.mjs";
import { createDefaultTerminalAgentActivityHost } from "./main/terminal-agent/activity/bootstrap/create-terminal-agent-activity-host.mjs";
import { createTrustedIpcMain } from "./main/trusted-ipc.mjs";
import { acquireRendererOutputLease } from "./main/renderer-output-lease.mjs";
import { createThemeService } from "./main/themes/theme-service.mjs";
import { createSenderWorkspaceAuthorization } from "./main/workspace-authorization.mjs";
import { createWorkspaceStateStore } from "./main/workspace-state-store.mjs";
import { WindowWorkspaceState } from "./main/window-workspace-state.mjs";
import { createWindowWorkspaceCompositionService } from "./main/window-workspace-composition.mjs";
import { createWindowWorkspaceOperationQueue } from "./main/workspace/project-sessions/window-workspace-operation-queue.mjs";
import {
  createProjectEntryService,
  requireGitRepository,
  requireProjectName,
} from "./main/project-entry-service.mjs";
import { createProjectLocationGrantStore } from "./main/project-location-grants.mjs";
import { createDesktopLocaleService } from "./main/localization/desktop-locale-service.mjs";
import { createWorkspaceWatchService } from "./main/workspace-watch-service.mjs";
import { createWorkspaceMutationTracker } from "./main/workspace-mutation-tracker.mjs";
import { createGitMetadataWatchService } from "./main/git-metadata-watch-service.mjs";
import { createDesktopTelemetryHost } from "./main/telemetry/bootstrap/create-desktop-telemetry-host.mjs";
import {
  DESKTOP_WINDOW_MIN_HEIGHT,
  DESKTOP_WINDOW_MIN_WIDTH,
} from "./main/window-layout-contract.mjs";
import {
  reapplyWindowChromeProfile,
} from "./main/window-chrome-profile.mjs";
import { createDesktopPlatformHost } from "./main/platform/create-platform-host.mjs";
import { FALLBACK_SUB_THEME_FIRST_PAINT } from "./main/sub-theme-first-paint.generated.mjs";
import { createGitOperationCoordinator } from "./main/git-operation-coordinator.mjs";
import { createCloudPublishCoordinator } from "./main/cloud-publish-coordinator.mjs";
import { createCloudPublishSecretVault } from "./main/cloud-publish-secret-vault.mjs";
import { createCloudGitConnectCoordinator } from "./main/cloud-git-connect-coordinator.mjs";
import { createCloudGitOperationLease } from "./main/cloud-git-operation-lease.mjs";
import { createCloudPublishGitCredentialManager } from "./main/cloud-publish-git-credentials.mjs";
import {
  getViewerPackPrivilegedSchemes,
  loadViewerPackRuntime,
} from "./main/viewer-packs/bootstrap.mjs";
import { resolveViewerPackFeatureProfile } from "./main/viewer-packs/feature-profile.mjs";
import { resolveGitAutoCommitFeatureProfile } from "./main/git-auto-commit/feature-profile.mjs";
import { createGitAutoCommitHost } from "./main/git-auto-commit/host.mjs";
import { createEditorSurfaceSessionManager } from "./main/editor-surfaces/session-manager.mjs";
import { registerEditorSurfaceIpcHandlers } from "./main/editor-surfaces/ipc.mjs";

// Must run before any console.* / IPC replyWithError logging: broken inherited
// stdout/stderr (Dock launch, detached child, closed terminal) otherwise throws
// uncaught `write EIO` / `write EPIPE` and Electron shows a fatal dialog.
installBrokenStdioGuards();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageMetadata = require("../package.json");
const projectRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(__dirname, "preload.cjs");
const rendererDistPath = path.join(projectRoot, "dist", "index.html");
const desktopBuildInfo = loadDesktopBuildInfo({
  app,
  packageMetadata,
  projectRoot,
});
const desktopApplicationIdentity = configureDesktopApplicationIdentity({
  app,
  buildInfo: desktopBuildInfo,
});
const desktopPlatformHost = createDesktopPlatformHost({
  safeStorage,
});
const appName = desktopApplicationIdentity.applicationName;

// Resolve only core launch data before the single-instance boundary. A
// duplicate CLI launch must exit before optional subsystems are constructed.
const initialLaunchIntent = createDesktopLaunchIntent({
  argv: process.argv,
  workingDirectory: process.cwd(),
  isPackaged: app.isPackaged,
});
const gotSingleInstanceLock = app.requestSingleInstanceLock(initialLaunchIntent);
if (!gotSingleInstanceLock) {
  app.exit(0);
}

const devServerUrl = process.env.PUPPYONE_DESKTOP_DEV_URL;
if (!app.isPackaged && !devServerUrl) {
  try {
    const releaseRendererOutput = acquireRendererOutputLease({
      outputDirectory: path.dirname(rendererDistPath),
      mode: "preview",
    });
    app.once("quit", releaseRendererOutput);
  } catch (error) {
    console.error("Unable to open the renderer:", error);
    dialog.showErrorBox("PuppyOne Development", error.message);
    app.exit(1);
  }
}
const rendererApplicationUrl = devServerUrl || pathToFileURL(rendererDistPath).toString();
if (devServerUrl) app.commandLine.appendSwitch("remote-debugging-port", "9222");
const viewerPackFeatureProfile = resolveViewerPackFeatureProfile({
  packageMetadata,
  environment: process.env,
  isPackaged: app.isPackaged,
});
const gitAutoCommitFeatureProfile = resolveGitAutoCommitFeatureProfile({
  packageMetadata,
  environment: process.env,
  isPackaged: app.isPackaged,
});
const workspaceStateFilename = "desktop-workspace-state.json";
const desktopWindowChromeOptions = desktopPlatformHost.windowChrome.browserWindowOptions;

const privilegedSchemes = [
  {
    scheme: "puppyone-local",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
  {
    scheme: "puppyone-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
];

privilegedSchemes.push(...getViewerPackPrivilegedSchemes(
  viewerPackFeatureProfile.externalViewerPacks,
));

protocol.registerSchemesAsPrivileged(privilegedSchemes);

let updateService = null;
let telemetryHost = null;
let appPreviewRuntime = null;
let viewerPackHost = null;
let viewerPackRuntime = null;
let markdownWebEmbedService = null;
let editorSurfaceManager = null;
let itemDisplayManager = null;
const itemRendererAuthority = createItemRendererAuthority();
const itemHostBudget = createItemHostBudget({}, { readMetrics: () => app.getAppMetrics() });
let stopLocaleNativeRefresh = null;
const windowsById = new Map();
const windowStateById = new Map();
const workspaceWindowByPath = new Map();
const localFileCapabilities = createLocalFileCapabilityStore();
let lastFocusedWindowId = null;
const trustedIpcMain = createTrustedIpcMain({
  ipcMain,
  applicationUrl: rendererApplicationUrl,
  itemRendererAuthority,
});
const nativeSurfaceOcclusion = createNativeSurfaceOcclusionCoordinator({
  onCallbackError: (error) => {
    console.warn("Unable to synchronize a native surface visibility state:", error);
  },
});
const nativeSurfacePointerPassthrough = createNativeSurfacePointerPassthroughCoordinator({
  onForwardError: (error) => {
    console.warn("Unable to forward a native surface drag event:", error);
  },
});
const externalNavigation = createExternalNavigationService({ shell });
const themeService = createThemeService({
  userDataPath: app.getPath("userData"),
  bundledThemesPath: path.join(app.getAppPath(), "electron", "themes"),
  shell,
});
const projectAppearanceStore = createProjectAppearanceStore({
  userDataPath: app.getPath("userData"),
});
const projectAppearanceService = createProjectAppearanceService({
  store: projectAppearanceStore,
  dialog,
  nativeImage,
  getDialogOwnerWindow,
});
const localeService = createDesktopLocaleService({
  app,
  getWindows: () => BrowserWindow.getAllWindows(),
});
const checkForUpdatesFromNativeMenu = createNativeUpdateMenuAction({
  appName,
  dialog,
  getOwnerWindow: () => getLastFocusedWindow(),
  getUpdateService: () => updateService,
  t: (messageId, values) => localeService.t(messageId, values),
});
const nativeMenuService = createDesktopNativeMenuService({
  app,
  Menu,
  t: (messageId, values) => localeService.t(messageId, values),
  onNewWindow: () => createWindow(),
  onCheckForUpdates: checkForUpdatesFromNativeMenu,
  isMarkdownEditorActive: () => {
    const window = getLastFocusedWindow();
    return Boolean(window && !window.isDestroyed() && isMarkdownEditorActive(window.webContents.id));
  },
  onMarkdownCommand: (command) => {
    const window = getLastFocusedWindow();
    if (!window || window.isDestroyed()) return;
    dispatchMarkdownEditorCommand(window.webContents, command);
  },
  onSelectTheme: (request) => {
    const window = getLastFocusedWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(THEME_SELECTION_REQUESTED_CHANNEL, request);
  },
  onOpenThemesDirectory: () => themeService.openDirectory(),
});
const applicationQuitIntent = createApplicationQuitIntent({ app });
const documentSessionCloseCoordinator = createDocumentSessionCloseCoordinator({
  dialog,
  t: (messageId, values) => localeService.t(messageId, values),
  onCloseCancelled: applicationQuitIntent.cancel,
  closeResources: async (window) => {
    await editorSurfaceManager?.destroyForOwner(window.webContents.id);
    return (await projectSessions.closeWindow(window.webContents.id)).closed;
  },
});
documentSessionCloseCoordinator.registerIpc(trustedIpcMain);
const authorizeWorkspaceRoot = createSenderWorkspaceAuthorization({
  getWorkspaceRootsForSender,
});
const resolveWorkspaceResource = createWorkspaceResourceResolver({
  getFoldersForSender: (sender) => projectSessions.folders(sender.id),
  authorizeWorkspaceRoot,
});
const terminalAgentActivityHost = createDefaultTerminalAgentActivityHost({
  appPath: app.getAppPath(),
  userDataPath: app.getPath("userData"),
  executablePath: process.execPath,
  getWebContents: (webContentsId) => webContents.fromId(webContentsId),
});
const terminalService = createTerminalProcessService({
  utilityProcess,
  modulePath: path.join(__dirname, "utility", "terminal", "main.mjs"),
  budget: itemHostBudget,
  appVersion: desktopBuildInfo.version,
  initializeWorkspaceEditReview,
  terminalAgentActivityHost,
  onHostEvent: (record, event) => itemDisplayManager?.hostEvent(record, event),
});
const terminalAgentLocator = createTerminalAgentLocator();
const agentEventCache = createEphemeralAgentSessionCache({ app });
const agentConversationCatalog = createAgentConversationCatalog({
  filePath: path.join(app.getPath("userData"), "agent-runtime", "conversations.json"),
});
const agentSessionRepository = createAgentSessionRepository({
  eventCache: agentEventCache,
  conversationCatalog: agentConversationCatalog,
});
const agentProcessSupervisor = createAgentProcessSupervisor({ maxConcurrentStarts: 2 });
const agentRuntimeRegistry = createDefaultAgentRuntimeHost({
  appVersion: desktopBuildInfo.version,
});
const agentAttachmentStore = createAgentAttachmentStore({
  rootPath: path.join(app.getPath("userData"), "agent-runtime", "attachments"),
});
void agentAttachmentStore.initialize().catch((error) => {
  console.error("puppyone failed to initialize Agent attachment staging:", error);
});
const agentCatalogService = createAgentService({
  runtimeRegistry: agentRuntimeRegistry,
  sessionCache: agentSessionRepository,
  conversationCatalog: agentConversationCatalog,
  attachmentStore: agentAttachmentStore,
  processSupervisor: agentProcessSupervisor,
});
const agentService = createAgentProcessService({
  utilityProcess,
  modulePath: path.join(__dirname, "utility", "agent", "main.mjs"),
  budget: itemHostBudget,
  appVersion: desktopBuildInfo.version,
  catalogService: agentCatalogService,
  conversationCatalog: agentConversationCatalog,
  attachmentStore: agentAttachmentStore,
  onHostEvent: (record, event) => itemDisplayManager?.hostEvent(record, event),
});
const localAgentInventory = createLocalAgentInventory({
  appVersion: desktopBuildInfo.version,
  cacheFilePath: path.join(app.getPath("userData"), "agent-runtime-inventory.json"),
});
const workspaceMutationTracker = createWorkspaceMutationTracker();
const workspaceWatchService = createWorkspaceWatchService();
const gitMetadataWatchService = createGitMetadataWatchService();
const workspaceStateStore = createWorkspaceStateStore({
  app,
  filename: workspaceStateFilename,
  canonicalizeWorkspacePath,
  workspaceFromPath,
  resolveWorkspaceIdentity: resolveLocalWorkspaceIdentity,
});
const projectEntryService = createProjectEntryService();
const projectEntryOperationSenders = new Set();
const projectLocationGrants = createProjectLocationGrantStore();
const cloudAuthService = createCloudAuthService({
  app,
  requestCloudApi,
  getCloudApiErrorMessage,
  secureStorage: safeStorage,
  externalNavigation,
  localCloudWebUrl: process.env.VITE_DESKTOP_CLOUD_WEB_URL,
  getWindows: () => BrowserWindow.getAllWindows(),
  revealWindow: revealLastFocusedWindow,
});
const gitOperationCoordinator = createGitOperationCoordinator();
const gitAutoCommitHost = createGitAutoCommitHost({
  available: gitAutoCommitFeatureProfile.available,
  preferenceFilePath: path.join(app.getPath("userData"), "git-auto-commit", "preferences.v1.json"),
  gitOperationCoordinator,
  documentDurabilityCoordinator: documentSessionCloseCoordinator,
  workspaceMutationTracker,
  workspaceWatchService,
  gitMetadataWatchService,
});
const projectSessions = createProjectSessionHost({
  agentService,
  terminalService,
  getSender: (id) => webContents.fromId(id),
  closeProjectServices: async (owner, root) => {
    await editorSurfaceManager?.destroyForResource(owner, root);
    await Promise.all([
      appPreviewRuntime?.closeSessionsForWorkspaceRoot(owner, root),
      workspaceWatchService.stopForWorkspaceRoot(owner, root),
      gitMetadataWatchService.stopForWorkspaceRoot(owner, root),
      localFileCapabilities.revokeWorkspaceRoot(owner, root),
      itemDisplayManager?.closeProject(owner, root),
    ]);
  },
});
const windowWorkspaceCompositionService = createWindowWorkspaceCompositionService({
  canonicalizeWorkspacePath,
  cleanupDetachedWorkspace: (window, folder) => projectSessions.closeRoot(window.webContents.id, folder.path),
  openProject: (window, folder) => projectSessions.open(window.webContents.id, folder),
  getWindowState: getOrCreateWindowState,
  getWorkspaceWindow,
  indexWorkspacePath: (folderPath, window) => workspaceWindowByPath.set(folderPath, window),
  persistWorkspaceComposition: (workspaces, workbenchWorkspaceId) => (
    workspaces.length
      ? workspaceStateStore.rememberWorkspaceComposition(workspaces, { workbenchWorkspaceId })
      : workspaceStateStore.clearActiveWorkspaceComposition(workbenchWorkspaceId)
  ),
  revealWindow: revealWorkspaceWindow,
  unindexWorkspacePath: (folderPath, window) => {
    if (workspaceWindowByPath.get(folderPath) === window) workspaceWindowByPath.delete(folderPath);
  },
  workspaceFromPath,
});
const workspaceNavigation = createWindowWorkspaceOperationQueue({
  assertOpen: (ownerId) => {
    const sender = webContents.fromId(ownerId);
    if (!sender || sender.isDestroyed()) throw new Error("The window has closed.");
    projectSessions.assertWindowOpen(ownerId);
  },
});
const cloudPublishSecretVault = createCloudPublishSecretVault({
  baseDirectory: path.join(app.getPath("userData"), "cloud-publish-secrets-v1"),
  secureStorage: safeStorage,
});
const cloudGitOperationLease = createCloudGitOperationLease();
const cloudGitCredentialManager = createCloudPublishGitCredentialManager();
const cloudPublishCoordinator = createCloudPublishCoordinator({
  cloudAuthService,
  gitCredentialManager: cloudGitCredentialManager,
  gitOperationCoordinator,
  logger: console,
  operationLease: cloudGitOperationLease,
  secretVault: cloudPublishSecretVault,
});
const cloudGitConnectCoordinator = createCloudGitConnectCoordinator({
  cloudAuthService,
  gitCredentialManager: cloudGitCredentialManager,
  gitOperationCoordinator,
  operationLease: cloudGitOperationLease,
  secretVault: cloudPublishSecretVault,
});

async function createWindow(options = {}) {
  await localeService.refreshSystemLanguages();
  const initialWorkspacePaths = (Array.isArray(options.initialWorkspacePaths)
    ? options.initialWorkspacePaths
    : [options.initialWorkspacePath])
    .filter((folderPath) => typeof folderPath === "string" && folderPath.trim())
    .map((folderPath) => path.resolve(folderPath));
  const appIconPath = desktopPlatformHost.windowChrome.supportsDockIcon ? null : resolveAppIconPath();
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: DESKTOP_WINDOW_MIN_WIDTH,
    minHeight: DESKTOP_WINDOW_MIN_HEIGHT,
    center: true,
    show: false,
    title: appName,
    ...(appIconPath ? { icon: appIconPath } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors
      ? FALLBACK_SUB_THEME_FIRST_PAINT.dark.background
      : FALLBACK_SUB_THEME_FIRST_PAINT.light.background,
    ...desktopWindowChromeOptions,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
      additionalArguments: [
        ...viewerPackFeatureProfile.rendererArguments,
        ...gitAutoCommitFeatureProfile.rendererArguments,
      ],
    },
  });
  const webContentsId = window.webContents.id;
  documentSessionCloseCoordinator.attachWindow(window);
  attachMarkdownFormatShortcuts(window.webContents);
  installWindowNavigationSecurity({
    webContents: window.webContents,
    applicationUrl: rendererApplicationUrl,
    externalNavigation,
  });
  windowsById.set(webContentsId, window);
  window.webContents.once("destroyed", () => {
    // Fence admission even if the renderer disappears during initial loading.
    void projectSessions.closeWindow(webContentsId).catch((error) => console.error("Project shutdown after renderer destruction failed:", error));
  });
  windowStateById.set(webContentsId, new WindowWorkspaceState({
    initialWorkspaceId: options.initialWorkspaceId ?? null,
    initialWorkspacePaths,
  }));
  lastFocusedWindowId = webContentsId;

  window.on("focus", () => {
    reapplyNativeWindowChrome(window);
    lastFocusedWindowId = webContentsId;
    nativeMenuService.refresh();
    const state = windowStateById.get(webContentsId);
    state?.markFocused();
    gitAutoCommitHost.reconcileWindow(webContentsId);
    if (!window.webContents.isDestroyed()) {
      window.webContents.send("git-repository:window-focus", { focused: true });
    }
  });

  window.on("blur", () => {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send("git-repository:window-focus", { focused: false });
    }
  });

  const publishWindowChromeState = (fullScreen) => {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send("window-layout:chrome-state-changed", { fullScreen });
    }
  };
  window.on("enter-full-screen", () => {
    window.setTitle("");
    publishWindowChromeState(true);
  });
  window.on("leave-full-screen", () => {
    window.setTitle(resolveWindowTitle(window));
    publishWindowChromeState(false);
    reapplyNativeWindowChrome(window);
  });

  window.on("show", () => {
    reapplyNativeWindowChrome(window);
  });

  window.on("restore", () => {
    reapplyNativeWindowChrome(window);
  });

  window.once("ready-to-show", () => {
    revealWindow(window);
  });

  window.webContents.once("did-finish-load", () => {
    console.info("puppyone renderer finished loading:", window.webContents.getURL());
    revealWindow(window);
  });

  window.webContents.on("did-start-navigation", (details) => {
    if (details?.isMainFrame !== false && details?.isSameDocument !== true) {
      nativeSurfaceOcclusion.releaseOwner(webContentsId);
      nativeSurfacePointerPassthrough.releaseOwner(webContentsId);
    }
  });

  window.webContents.on("console-message", (details) => {
    console.log("puppyone renderer console:", {
      level: details.level,
      message: details.message,
      line: details.lineNumber,
      sourceId: details.sourceId,
    });
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("puppyone renderer failed to load:", {
      errorCode,
      errorDescription,
      validatedURL,
    });
    revealWindow(window);
  });

  window.webContents.on("preload-error", (_event, preloadPathWithError, error) => {
    console.error("puppyone preload failed:", {
      preloadPath: preloadPathWithError,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("puppyone renderer process gone:", details);
    nativeSurfaceOcclusion.releaseOwner(webContentsId);
    nativeSurfacePointerPassthrough.releaseOwner(webContentsId);
    viewerPackHost?.destroySessionsForOwner(webContentsId);
    void editorSurfaceManager?.destroyForOwner(webContentsId).catch((error) => console.error("Editor Surface retirement failed:", error));
    appPreviewRuntime?.closeSessionsForWindow(webContentsId);
  });

  try {
    if (devServerUrl) {
      await window.loadURL(devServerUrl);
      window.webContents.openDevTools({ mode: "detach" });
    } else {
      await window.loadFile(rendererDistPath);
    }
  } catch (error) {
    console.error("puppyone failed to open renderer:", error);
    revealWindow(window);
  }

  revealWindow(window);

  window.on("closed", () => {
    void projectSessions.closeWindow(webContentsId).then(({ closed }) => {
      if (closed) projectSessions.releaseWindow(webContentsId);
    }).catch((error) => console.error("Project shutdown failed:", error));
    releaseWindowWorkspaceById(webContentsId, window);
    viewerPackHost?.destroySessionsForOwner(webContentsId);
    void editorSurfaceManager?.destroyForOwner(webContentsId).catch((error) => console.error("Editor Surface retirement failed:", error));
    appPreviewRuntime?.closeSessionsForWindow(webContentsId);
    nativeSurfaceOcclusion.releaseOwner(webContentsId);
    nativeSurfacePointerPassthrough.releaseOwner(webContentsId);
    workspaceWatchService.stopForWindow(webContentsId);
    gitMetadataWatchService.stopForWindow(webContentsId);
    windowsById.delete(webContentsId);
    windowStateById.delete(webContentsId);
    if (lastFocusedWindowId === webContentsId) {
      lastFocusedWindowId = getLastFocusedWindow()?.webContents.id ?? null;
    }
    nativeMenuService.refresh();
  });

  return window;
}

function revealWindow(window) {
  if (!window || window.isDestroyed()) return;
  const wasVisible = window.isVisible();
  if (window.isMinimized()) {
    window.restore();
  }
  if (!wasVisible) {
    window.show();
    window.center();
  }
  window.focus();
  lastFocusedWindowId = window.webContents.id;
  const state = windowStateById.get(window.webContents.id);
  state?.markFocused();
  desktopPlatformHost.windowChrome.focusApplication(app);
}

function reapplyNativeWindowChrome(window) {
  if (!desktopPlatformHost.windowChrome.shouldReapplyProfile || !window || window.isDestroyed()) return;
  reapplyWindowChromeProfile(window);
  // AppKit can recreate the traffic-light views after emitting a window
  // lifecycle event. A second pass on the next main-loop turn keeps the
  // manifest-owned profile authoritative after that native work completes.
  setImmediate(() => {
    if (!window.isDestroyed()) reapplyWindowChromeProfile(window);
  });
}

function revealLastFocusedWindow() {
  void createOrRevealWindow().catch((error) => {
    console.error("Unable to reveal the last focused puppyone window:", error);
  });
}

async function createOrRevealWindow() {
  const window = getLastFocusedWindow();
  if (window) {
    revealWindow(window);
    return window;
  }
  return createWindow();
}

function getLastFocusedWindow() {
  const directWindow = lastFocusedWindowId ? windowsById.get(lastFocusedWindowId) : null;
  if (directWindow && !directWindow.isDestroyed()) return directWindow;

  let bestWindow = null;
  let bestFocusedAt = -1;
  for (const [id, window] of windowsById.entries()) {
    if (window.isDestroyed()) continue;
    const focusedAt = windowStateById.get(id)?.lastFocusedAt ?? 0;
    if (focusedAt > bestFocusedAt) {
      bestFocusedAt = focusedAt;
      bestWindow = window;
    }
  }
  return bestWindow;
}

function resolveAppIconPath() {
  return resolveRuntimeAppImage({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    projectRoot,
    channel: desktopBuildInfo.channel,
  });
}

app.on("second-instance", (_event, argv, workingDirectory, launchIntent) => {
  void handleSecondInstanceLaunch({
    launchIntent,
    argv,
    workingDirectory,
    isPackaged: app.isPackaged,
    openWorkspaceInNewWindow,
    revealOrCreateWindow: createOrRevealWindow,
    reportError: (message, error) => console.error(message, error),
  });
});

app.whenReady().then(async () => {
  await localeService.initialize();
  updateService = createUpdateService({
    app,
    buildInfo: desktopBuildInfo,
    ipcMain: trustedIpcMain,
    getWindows: () => BrowserWindow.getAllWindows(),
    getRestartBlockers: getUpdateRestartBlockers,
    confirmRestartWithBlockers: confirmUpdateRestartWithBlockers,
  });
  telemetryHost = createDesktopTelemetryHost({
    app,
    buildInfo: desktopBuildInfo,
    getWindows: () => BrowserWindow.getAllWindows(),
  });
  stopLocaleNativeRefresh = localeService.onDidChange((state) => {
    nativeMenuService.refresh();
    for (const entry of itemDisplayManager?.values() ?? []) {
      if (entry.view && !entry.view.webContents.isDestroyed()) entry.view.webContents.send("localization:changed", state);
    }
  });
  setDevelopmentDockIcon({
    app,
    supportsDockIcon: desktopPlatformHost.windowChrome.supportsDockIcon,
    iconPath: app.isPackaged ? null : resolveAppIconPath(),
  });
  nativeMenuService.refresh();

  registerLocalFileProtocol({
    protocol,
    readWorkspaceFile,
    openWorkspaceFileRangeStream,
    statWorkspaceFile,
    getMimeType,
    canonicalizeWorkspacePath,
    isOpenWorkspaceRoot,
    resolveCapability: localFileCapabilities.resolve,
    applicationUrl: rendererApplicationUrl,
  });
  registerProjectIconProtocol({
    protocol,
    store: projectAppearanceStore,
    applicationUrl: rendererApplicationUrl,
  });
  const editorSurfaceBrowserSession = electronSession.fromPartition(
    "persist:puppyone-pdf-viewer",
    { cache: false },
  );
  editorSurfaceBrowserSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  editorSurfaceBrowserSession.setPermissionCheckHandler(() => false);
  editorSurfaceManager = createEditorSurfaceSessionManager({
    WebContentsView,
    browserSession: editorSurfaceBrowserSession,
    getOwnerWindow: (ownerWebContentsId) => windowsById.get(ownerWebContentsId) ?? null,
    nativeSurfaceOcclusion,
    nativeSurfacePointerPassthrough,
    admitResource: createEditorSurfaceResourceAdmission({
      inspectLocalCapability: localFileCapabilities.inspect,
      statWorkspaceFile,
      resolveWorkspaceFilePath: resolveLocalWorkspaceFilePath,
      canonicalizeWorkspacePath,
      isOpenWorkspaceRoot,
    }),
  });
  const configuredItemSessions = new WeakSet();
  itemDisplayManager = createItemDisplayManager({
    WebContentsView, electronSession, MessageChannelMain,
    authority: itemRendererAuthority, budget: itemHostBudget,
    getOwnerWindow: (ownerId) => windowsById.get(ownerId) ?? null,
    projectSessions, terminalService, agentService, attachmentStore: agentAttachmentStore,
    applicationUrl: rendererApplicationUrl, preloadPath: path.join(__dirname, "item-preload.cjs"),
    nativeSurfaceOcclusion, nativeSurfacePointerPassthrough,
    configureSession: (session) => {
      if (configuredItemSessions.has(session)) return;
      configuredItemSessions.add(session);
      registerLocalFileProtocol({ protocol: session.protocol, readWorkspaceFile, openWorkspaceFileRangeStream,
        statWorkspaceFile, getMimeType, canonicalizeWorkspacePath, isOpenWorkspaceRoot,
        resolveCapability: localFileCapabilities.resolve, applicationUrl: rendererApplicationUrl });
      registerProjectIconProtocol({ protocol: session.protocol, store: projectAppearanceStore, applicationUrl: rendererApplicationUrl });
    },
  });
  const appPreviewProcessRuntime = createAppPreviewRuntime({
    app,
    dialog,
    externalNavigation,
    readWorkspaceTextFile,
    resolveWorkspacePath: resolveLocalWorkspacePath,
    t: (messageId, values) => localeService.t(messageId, values),
    onStateChange: (event) => {
      for (const ownerWebContentsId of event.ownerWebContentsIds) {
        const window = windowsById.get(ownerWebContentsId);
        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) continue;
        window.webContents.send("app-preview:runtime-state", {
          rootPath: event.rootPath,
          ...event.result,
        });
      }
    },
  });
  appPreviewRuntime = createAppPreviewService({ runtime: appPreviewProcessRuntime });
  if (viewerPackFeatureProfile.externalViewerPacks) {
    viewerPackRuntime = await loadViewerPackRuntime(true);
    viewerPackHost = viewerPackRuntime.createViewerPackHost({
      WebContentsView,
      sessionFromPartition: (partition, options) => electronSession.fromPartition(partition, options),
      getOwnerWindow: (ownerWebContentsId) => windowsById.get(ownerWebContentsId) ?? null,
      getMimeType,
      userDataPath: app.getPath("userData"),
      appVersion: desktopBuildInfo.version,
      isPackaged: app.isPackaged,
      allowTestKeys: !app.isPackaged && process.env.PUPPYONE_VIEWER_PACK_ALLOW_TEST_KEYS === "1",
      getThemeSnapshot: () => ({
        mode: nativeTheme.shouldUseDarkColors ? "dark" : "light",
        tokens: {},
      }),
      nativeSurfaceOcclusion,
      nativeSurfacePointerPassthrough,
    });
  }
  registerIpcHandlers();
  if (gitAutoCommitHost.available) {
    powerMonitor.on("resume", gitAutoCommitHost.reconcileAfterResume);
  }
  await telemetryHost.start();
  updateService.start();
  const initialWorkspaceComposition = initialLaunchIntent.workspacePath
    ? { workspaceId: null, paths: [initialLaunchIntent.workspacePath] }
    : await workspaceStateStore.readLastActiveWorkspaceComposition();
  await createWindow({
    initialWorkspaceId: initialWorkspaceComposition.workspaceId,
    initialWorkspacePaths: initialWorkspaceComposition.paths,
  });

  app.on("activate", () => {
    void localeService.refreshSystemLanguages().catch((error) => {
      console.warn("Unable to refresh the system language preference:", error);
    });
    if (windowsById.size > 0) {
      revealLastFocusedWindow();
      return;
    }
    void workspaceStateStore.readLastActiveWorkspaceComposition()
      .then((composition) => createWindow({
        initialWorkspaceId: composition.workspaceId,
        initialWorkspacePaths: composition.paths,
      }));
  });
}).catch((error) => {
  console.error("puppyone failed to start:", error);
});

app.on("window-all-closed", () => {
  // A prevented BrowserWindow close cancels Electron's original quit attempt.
  // Resume it after the asynchronous document drain closes the last window.
  applicationQuitIntent.resumeAfterLastWindowClosed();
});

// Keep persistence dependencies alive while BrowserWindow close handlers ask
// renderer Document Sessions to drain. `will-quit` runs only after every
// window accepted closing, so a failed flush can safely leave the app usable.
app.on("will-quit", () => {
  stopLocaleNativeRefresh?.();
  localeService.dispose();
  cloudAuthService.dispose();
  updateService?.dispose();
  telemetryHost?.dispose();
  void editorSurfaceManager?.destroyAll().catch((error) => console.error("Editor Surface retirement failed:", error));
  viewerPackHost?.destroyAllSessions();
  appPreviewRuntime?.closeAll();
  markdownWebEmbedService?.dispose();
  nativeSurfaceOcclusion.dispose();
  nativeSurfacePointerPassthrough.dispose();
  void terminalAgentActivityHost.dispose();
  terminalAgentLocator.dispose();
  localAgentInventory.dispose();
  if (gitAutoCommitHost.available) {
    powerMonitor.removeListener("resume", gitAutoCommitHost.reconcileAfterResume);
  }
  gitAutoCommitHost.closeAll();
  workspaceWatchService.closeAll();
  gitMetadataWatchService.closeAll();
});

app.on("before-quit", applicationQuitIntent.markRequested);

app.on("before-quit", createApplicationCloseCoordinator({
  app,
  getWindows: () => BrowserWindow.getAllWindows(),
  closeResources: async () => {
    await projectSessions.closeAllWindows();
    await itemDisplayManager?.closeAll();
    await Promise.all([agentService.closeAll(), terminalService.closeAll()]);
  },
  onFailure: async () => {
    applicationQuitIntent.cancel();
    await dialog.showMessageBox({ type: "warning", buttons: [localeService.t("native.appPreview.run.cancel")],
      message: localeService.t("native.projectClose.message"), detail: localeService.t("native.projectClose.quitDetail") });
  },
}));

function registerIpcHandlers() {
  registerItemHostIpc({ ipcMain, trustedIpcMain, authority: itemRendererAuthority, manager: itemDisplayManager, projectSessions });
  registerProjectSessionIpc({ ipcMain: trustedIpcMain, projectSessions });
  const resourceTransfer = registerResourceTransferIpcHandlers({
    ipcMain: trustedIpcMain,
    resolveWorkspaceResource,
    nativeDrag: desktopPlatformHost.platform === "macos" ? loadMacosResourceDrag() : null,
    getWindow: (sender) => BrowserWindow.fromWebContents(sender),
  });
  app.once("will-quit", () => resourceTransfer.dispose());
  registerEditorSurfaceIpcHandlers({
    trustedIpcMain,
    manager: editorSurfaceManager,
  });
  registerAppearanceIpcHandlers({
    ipcMain: trustedIpcMain,
    BrowserWindow,
    nativeTheme,
  });
  registerProjectAppearanceIpcHandlers({
    ipcMain: trustedIpcMain,
    service: projectAppearanceService,
    getWindows: () => BrowserWindow.getAllWindows(),
  });
  registerThemeIpcHandlers({
    ipcMain: trustedIpcMain,
    themeService,
    onSyncNativeMenu: (state) => nativeMenuService.setThemeState(state),
  });
  registerWindowLayoutIpcHandlers({
    ipcMain: trustedIpcMain,
    BrowserWindow,
    platform: desktopPlatformHost.platform,
  });
  registerNativeSurfaceOcclusionIpcHandlers({
    ipcMain: trustedIpcMain,
    coordinator: nativeSurfaceOcclusion,
  });
  registerNativeSurfacePointerPassthroughIpcHandlers({
    ipcMain: trustedIpcMain,
    coordinator: nativeSurfacePointerPassthrough,
  });
  registerPanePreviewIpcHandlers({
    ipcMain: trustedIpcMain,
    BrowserWindow,
  });
  registerBuildInfoIpcHandlers({
    ipcMain: trustedIpcMain,
    buildInfo: desktopBuildInfo,
  });
  registerPlatformIpcHandlers({
    ipcMain: trustedIpcMain,
    platformHost: desktopPlatformHost,
  });
  registerTelemetryIpcHandlers({
    ipcMain: trustedIpcMain,
    telemetryService: telemetryHost.service,
  });
  registerLocalizationIpcHandlers({
    ipcMain: trustedIpcMain,
    localeService,
  });
  registerMarkdownFormatIpcHandlers({
    ipcMain: trustedIpcMain,
    onActiveChange: () => nativeMenuService.refresh(),
  });
  registerWorkspaceNavigationIpcHandlers({
    ipcMain: trustedIpcMain,
    workspaceStateStore,
    getInitialWorkspaceResultForWindow,
    forgetCurrentWindowWorkspace,
    showHomepageForCurrentWindow,
    openWorkspaceInCurrentWindow,
    openWorkspaceInNewWindow,
    createProjectForCurrentWindow,
    cloneRepositoryForCurrentWindow,
    selectProjectLocationForCurrentWindow,
    selectWorkspaceForCurrentWindow,
    selectWorkspaceForCurrentComposition,
    selectWorkspaceForNewWindow,
    attachWorkspaceToCurrentWindow,
    detachWorkspaceFromCurrentWindow,
  });
  registerCloudIpcHandlers({ ipcMain: trustedIpcMain, cloudAuthService });
  registerCloudPublishIpcHandlers({
    ipcMain: trustedIpcMain,
    authorizeWorkspaceRoot,
    cloudGitConnectCoordinator,
    cloudPublishCoordinator,
  });
  registerSystemIpcHandlers({ ipcMain: trustedIpcMain, externalNavigation });
  registerFeedbackIpcHandlers({
    ipcMain: trustedIpcMain,
    appVersion: desktopBuildInfo.version,
  });
  markdownWebEmbedService = registerMarkdownWebEmbedIpcHandlers({
    ipcMain: trustedIpcMain,
    createMarkdownWebEmbedService,
    externalNavigation,
    getOwnerWindow: (webContentsId) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.webContents?.id === webContentsId) return window;
      }
      return null;
    },
    nativeSurfaceOcclusion,
    nativeSurfacePointerPassthrough,
  });
  registerWorkspaceFileIpcHandlers({
    app,
    ipcMain: trustedIpcMain,
    BrowserWindow,
    dialog,
    fs,
    shell,
    authorizeWorkspaceRoot,
    convertOfficeDocument: desktopPlatformHost.documents.convertOfficeDocumentToDocx,
    retireEditorSurfacesForResource: (owner, resource) => editorSurfaceManager?.destroyForResource(owner, resource),
    localFileCapabilities,
    workspaceWatchService,
    workspaceMutationTracker,
    gitMetadataWatchService,
    t: (messageId, values) => localeService.t(messageId, values),
  });

  registerAppPreviewIpcHandlers({
    ipcMain: trustedIpcMain,
    appPreviewRuntime,
    authorizeWorkspaceRoot,
  });
  registerWorkspaceWatchIpcHandlers({
    ipcMain: trustedIpcMain,
    workspaceWatchService,
    authorizeWorkspaceRoot,
  });
  registerGitMetadataWatchIpcHandlers({
    ipcMain: trustedIpcMain,
    gitMetadataWatchService,
    authorizeWorkspaceRoot,
  });

  registerWorkspaceGitIpcHandlers({
    ipcMain: trustedIpcMain,
    BrowserWindow,
    dialog,
    authorizeWorkspaceRoot,
    cloudGitCredentialManager,
    cloudGitOperationLease,
    gitOperationCoordinator,
    t: (messageId, values) => localeService.t(messageId, values),
  });
  gitAutoCommitHost.registerIpcHandlers({
    ipcMain: trustedIpcMain,
    authorizeWorkspaceRoot,
  });
  registerTerminalIpcHandlers({
    ipcMain: trustedIpcMain,
    terminalAgentLocator,
    terminalService,
    authorizeWorkspaceRoot,
    projectSessions,
  });
  registerAgentActivityIpcHandlers({
    ipcMain: trustedIpcMain,
    activityHost: terminalAgentActivityHost,
  });
  registerAgentIpcHandlers({
    ipcMain: trustedIpcMain,
    agentService,
    localAgentInventory,
    authorizeWorkspaceRoot,
    resolveWorkspaceResource,
    attachmentStore: agentAttachmentStore,
    dialog,
    getDialogOwnerWindow,
    projectSessions,
  });

  if (viewerPackHost && viewerPackRuntime) {
    // App authority (install/activate/bounds/destroy) is gated to the trusted
    // application frame.
    viewerPackRuntime.registerViewerPackAppIpcHandlers({
      ipcMain: trustedIpcMain,
      host: viewerPackHost,
      authorizeWorkspaceRoot,
      dialog,
      getDialogOwnerWindow,
      t: (messageId, values) => localeService.t(messageId, values),
    });
    // Plugin bridge (document/resource/ui/host) uses RAW ipcMain because the
    // sandboxed pack frame's URL is never the trusted application URL; each
    // handler validates sender → session before doing anything.
    viewerPackRuntime.registerViewerPackPluginIpcHandlers({ ipcMain, host: viewerPackHost });
  }
}

function getUpdateRestartBlockers() {
  const blockers = [];
  const terminalSessionCount = terminalService.getSessionCount();
  if (terminalSessionCount > 0) {
    blockers.push({
      id: "terminal-sessions",
      label: localeService.t("native.update.blocker.terminal.label", {
        count: terminalSessionCount,
      }),
      detail: localeService.t("native.update.blocker.terminal.detail", {
        count: terminalSessionCount,
      }),
    });
  }
  const agentSessionCount = agentService.getSessionCount();
  if (agentSessionCount > 0) {
    blockers.push({
      id: "agent-sessions",
      label: localeService.t("native.update.blocker.agent.label", {
        count: agentSessionCount,
      }),
      detail: localeService.t("native.update.blocker.agent.detail", {
        count: agentSessionCount,
      }),
    });
  }
  return blockers;
}

async function confirmUpdateRestartWithBlockers({
  availableVersion,
  blockers,
}) {
  const version = typeof availableVersion === "string" && availableVersion.trim()
    ? availableVersion.trim()
    : desktopBuildInfo.version;
  const blockerDetails = blockers
    .map((blocker) => blocker.detail ?? blocker.label)
    .filter(Boolean)
    .map((detail) => `• ${detail}`)
    .join("\n");
  const options = {
    type: "warning",
    buttons: [
      localeService.t("native.update.confirm.cancel"),
      localeService.t("native.update.confirm.proceed"),
    ],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: localeService.t("native.update.confirm.title"),
    message: localeService.t("native.update.confirm.message", { version }),
    detail: [
      localeService.t("native.update.confirm.detail"),
      blockerDetails,
    ].filter(Boolean).join("\n\n"),
  };
  const owner = getLastFocusedWindow();
  const result = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

async function getInitialWorkspaceResultForWindow(sender) {
  const window = BrowserWindow.fromWebContents(sender);
  if (!window || window.isDestroyed()) {
    return {
      workspaceId: null,
      path: null,
      workspace: null,
      workspaces: [],
      error: null,
    };
  }

  const state = windowStateById.get(window.webContents.id);
  if (state?.folders.length) {
    const workspaces = state.folders.map((folder) => folder.workspace);
    return {
      workspaceId: state.workspaceId,
      path: state.folderPaths[0] ?? null,
      workspace: workspaces[0] ?? null,
      workspaces,
      error: null,
    };
  }

  const initialPaths = state?.initialRestorePaths ?? [];
  if (initialPaths.length === 0) {
    return {
      workspaceId: state?.workspaceId ?? null,
      path: null,
      workspace: null,
      workspaces: [],
      error: null,
    };
  }

  try {
    const folders = [];
    for (const initialPath of initialPaths) {
      const workspace = await workspaceFromPath(initialPath);
      const canonicalPath = await canonicalizeWorkspacePath(workspace.path);
      const existingWindow = getWorkspaceWindow(canonicalPath);
      if (existingWindow && existingWindow !== window) {
        revealWorkspaceWindow(existingWindow, canonicalPath);
        throw new Error(`${workspace.name} is already open in another puppyone window.`);
      }
      folders.push({ path: canonicalPath, workspace });
    }

    const workspaces = folders.map((folder) => folder.workspace);
    const validationState = new WindowWorkspaceState();
    validationState.replaceFolders(folders);
    await workspaceStateStore.rememberWorkspaceComposition(workspaces, {
      workbenchWorkspaceId: state?.workspaceId,
    });
    assignWindowWorkspaceComposition(window, folders, { cleanupPrevious: false });
    return {
      workspaceId: state?.workspaceId ?? null,
      path: folders[0]?.path ?? null,
      workspace: workspaces[0] ?? null,
      workspaces,
      error: null,
    };
  } catch (error) {
    return {
      workspaceId: state?.workspaceId ?? null,
      path: initialPaths[0] ?? null,
      workspace: null,
      workspaces: [],
      error: `Unable to reopen workspace composition: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function selectWorkspaceForCurrentWindow(sender) {
  const result = await showWorkspaceOpenDialog(getDialogOwnerWindow(sender));

  if (result.canceled || result.filePaths.length === 0) return null;
  return openWorkspaceInCurrentWindow(sender, result.filePaths[0]);
}

async function selectWorkspaceForCurrentComposition(sender) {
  return runProjectEntryOperation(sender, async () => {
    const result = await showWorkspaceOpenDialog(getDialogOwnerWindow(sender));
    if (result.canceled || result.filePaths.length === 0) return null;
    return attachWorkspaceToCurrentWindow(sender, result.filePaths[0]);
  });
}

async function selectWorkspaceForNewWindow(sender = null) {
  const ownerWindow = sender ? getDialogOwnerWindow(sender) : getLastFocusedWindow() ?? undefined;
  const result = await showWorkspaceOpenDialog(ownerWindow);

  if (result.canceled || result.filePaths.length === 0) return null;
  return openWorkspaceInNewWindow(result.filePaths[0]);
}

async function showWorkspaceOpenDialog(ownerWindow) {
  const options = {
    title: localeService.t("native.workspace.open.title"),
    properties: ["openDirectory", "createDirectory"],
  };

  return ownerWindow && !ownerWindow.isDestroyed()
    ? dialog.showOpenDialog(ownerWindow, options)
    : dialog.showOpenDialog(options);
}

async function createProjectForCurrentWindow(sender, request) {
  const name = requireProjectName(request?.name);
  return runProjectEntryOperation(sender, async () => {
    const parentPath = projectLocationGrants.resolve(sender, request?.locationGrantId);
    const project = await projectEntryService.createProject({
      parentPath,
      name,
    });
    projectLocationGrants.revoke(sender, request.locationGrantId);
    return openWorkspaceInCurrentWindow(sender, project.path);
  });
}

async function selectProjectLocationForCurrentWindow(sender) {
  return runProjectEntryOperation(sender, async () => {
    const parentPath = await selectProjectParentDirectory(sender, "create");
    if (!parentPath) return null;
    const canonicalPath = await fs.promises.realpath(parentPath);
    return projectLocationGrants.issue(sender, canonicalPath);
  });
}

async function cloneRepositoryForCurrentWindow(sender, request) {
  const repository = requireGitRepository(request?.repositoryUrl);
  return runProjectEntryOperation(sender, async () => {
    const parentPath = await selectProjectParentDirectory(sender, "clone");
    if (!parentPath) return null;
    const project = await projectEntryService.cloneRepository({
      parentPath,
      repositoryUrl: repository.url,
    });
    return openWorkspaceInCurrentWindow(sender, project.path);
  });
}

async function selectProjectParentDirectory(sender, kind) {
  const ownerWindow = getDialogOwnerWindow(sender);
  const create = kind === "create";
  const options = {
    title: localeService.t(create
      ? "native.workspace.create.chooseParent"
      : "native.workspace.clone.chooseParent"),
    buttonLabel: localeService.t(create
      ? "native.workspace.create.chooseParentButton"
      : "native.workspace.clone.chooseParentButton"),
    defaultPath: app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"],
  };
  const result = ownerWindow && !ownerWindow.isDestroyed()
    ? await dialog.showOpenDialog(ownerWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}

async function runProjectEntryOperation(sender, operation) {
  const senderId = sender?.id;
  if (!Number.isInteger(senderId)) throw new Error("No active window is available for this project operation.");
  if (projectEntryOperationSenders.has(senderId)) {
    throw new Error("Another project operation is already in progress.");
  }
  projectEntryOperationSenders.add(senderId);
  try {
    return await operation();
  } finally {
    projectEntryOperationSenders.delete(senderId);
  }
}

async function openWorkspaceInCurrentWindow(sender, folderPath, options = {}) {
  return workspaceNavigation.run(sender.id, (assertOpen) => openWorkspaceInCurrentWindowNow(sender, folderPath, options, assertOpen));
}

async function openWorkspaceInCurrentWindowNow(sender, folderPath, options, assertOpen) {
  const window = BrowserWindow.fromWebContents(sender);
  if (!window || window.isDestroyed()) {
    throw new Error("No active window is available for this workspace.");
  }

  const workspace = await workspaceFromPath(folderPath);
  const canonicalPath = await canonicalizeWorkspacePath(workspace.path);
  assertOpen();
  const existingWindow = getWorkspaceWindow(canonicalPath);
  if (existingWindow && existingWindow !== window) {
    revealWorkspaceWindow(existingWindow, canonicalPath);
    const existingState = getOrCreateWindowState(existingWindow);
    if (options.remember !== false) {
      await workspaceStateStore.rememberWorkspaceComposition(
        existingState.folders.map((folder) => folder.workspace),
        { workbenchWorkspaceId: existingState.workspaceId },
      );
    }
    return {
      status: "focused-existing",
      workspaceId: existingState.workspaceId,
      path: canonicalPath,
      workspace,
    };
  }

  const state = getOrCreateWindowState(window);
  const folders = (state.compositionForPath(canonicalPath) ?? [{ workspace, path: canonicalPath }])
    .map((folder) => folder.path === canonicalPath ? { workspace, path: canonicalPath } : folder);
  const workspaceId = state.activationIdentity(folders);
  if (options.remember !== false) {
    await workspaceStateStore.rememberWorkspaceComposition(folders.map((folder) => folder.workspace), {
      workbenchWorkspaceId: workspaceId,
    });
  }
  assertOpen();
  state.beginNewWorkspace(workspaceId);
  assignWindowWorkspaceComposition(window, folders);
  return {
    status: "opened-current",
    workspaces: state.folders.map((folder) => folder.workspace),
    workspaceId: state.workspaceId,
    path: canonicalPath,
    workspace,
  };
}

async function openWorkspaceInNewWindow(folderPath, options = {}) {
  const workspace = await workspaceFromPath(folderPath);
  const canonicalPath = await canonicalizeWorkspacePath(workspace.path);
  const existingWindow = getWorkspaceWindow(canonicalPath);
  if (existingWindow) {
    revealWorkspaceWindow(existingWindow, canonicalPath);
    const existingState = getOrCreateWindowState(existingWindow);
    if (options.remember !== false) {
      await workspaceStateStore.rememberWorkspaceComposition(
        existingState.folders.map((folder) => folder.workspace),
        { workbenchWorkspaceId: existingState.workspaceId },
      );
    }
    return {
      status: "focused-existing",
      workspaceId: existingState.workspaceId,
      path: canonicalPath,
      workspace,
    };
  }

  const window = await createWindow({
    initialWorkspacePath: canonicalPath,
  });
  const state = assignWindowWorkspace(window, workspace, canonicalPath, { cleanupPrevious: false });
  if (options.remember !== false) {
    await workspaceStateStore.rememberWorkspaceComposition([workspace], {
      workbenchWorkspaceId: state.workspaceId,
    });
  }
  return {
    status: "opened-new-window",
    workspaceId: state.workspaceId,
    path: canonicalPath,
    workspace,
  };
}

async function attachWorkspaceToCurrentWindow(sender, folderPath) {
  return workspaceNavigation.run(sender.id, () => attachWorkspaceToCurrentWindowNow(sender, folderPath));
}

async function attachWorkspaceToCurrentWindowNow(sender, folderPath) {
  const window = BrowserWindow.fromWebContents(sender);
  if (!window || window.isDestroyed()) {
    throw new Error("No active window is available for this Workspace composition.");
  }
  return windowWorkspaceCompositionService.attach(window, folderPath);
}

async function detachWorkspaceFromCurrentWindow(sender, folderPath) {
  return workspaceNavigation.run(sender.id, () => detachWorkspaceFromCurrentWindowNow(sender, folderPath));
}

async function detachWorkspaceFromCurrentWindowNow(sender, folderPath) {
  const window = BrowserWindow.fromWebContents(sender);
  if (!window || window.isDestroyed()) {
    throw new Error("No active window is available for this Workspace composition.");
  }
  const result = await windowWorkspaceCompositionService.detach(window, folderPath);
  const primary = getOrCreateWindowState(window).folderPaths[0];
  if (primary) await gitAutoCommitHost.assignWorkspace(sender, primary);
  else gitAutoCommitHost.releaseWindow(sender.id);
  if (!window.isDestroyed()) {
    window.setTitle(window.isFullScreen() ? "" : resolveWindowTitle(window));
    window.setRepresentedFilename?.(primary ?? "");
  }
  return result;
}

function assignWindowWorkspace(window, workspace, canonicalPath, options = {}) {
  const state = getOrCreateWindowState(window);
  const folders = (state.compositionForPath(canonicalPath) ?? [{ workspace, path: canonicalPath }])
    .map((folder) => folder.path === canonicalPath ? { workspace, path: canonicalPath } : folder);
  state.activateFolders(folders);
  assignWindowWorkspaceComposition(window, folders, options);
  return state;
}

function assignWindowWorkspaceComposition(window, folders, options = {}) {
  if (!window || window.isDestroyed()) return;
  const webContentsId = window.webContents.id;
  const state = getOrCreateWindowState(window);
  const previousPaths = state.folderPaths;
  const nextPaths = folders.map((folder) => folder.path);
  const replacingComposition = previousPaths.length !== nextPaths.length
    || previousPaths.some((folderPath, index) => folderPath !== nextPaths[index]);

  if (replacingComposition && previousPaths.length > 0) {
    viewerPackHost?.destroySessionsForOwner(webContentsId);
    // Project sessions remain authorized while merely changing presentation.
    // Document input watches and project execution are retired by closeRoot /
    // closeWindow, never by navigation to another composition.
    if (options.cleanupPrevious !== false) gitMetadataWatchService.stopForWindow(webContentsId);
  }

  projectSessions.assertWindowOpen(webContentsId);
  for (const folder of folders) projectSessions.retainForPresentation(webContentsId, folder);
  state.replaceFolders(folders);
  for (const folder of folders) workspaceWindowByPath.set(folder.path, window);
  const primaryPath = folders[0]?.path ?? null;
  if (primaryPath) void gitAutoCommitHost.assignWorkspace(window.webContents, primaryPath).catch((error) => {
    console.warn("Unable to initialize Git Auto Commit for workspace:", error);
  });
  window.setTitle(window.isFullScreen() ? "" : resolveWindowTitle(window));
  if (typeof window.setRepresentedFilename === "function") {
    try {
      if (primaryPath) window.setRepresentedFilename(primaryPath);
    } catch {
      // setRepresentedFilename is macOS-only and best-effort.
    }
  }
}

function releaseWindowWorkspaceById(webContentsId, window = null) {
  gitAutoCommitHost.releaseWindow(webContentsId);
  viewerPackHost?.destroySessionsForOwner(webContentsId);
  void editorSurfaceManager?.destroyForOwner(webContentsId).catch((error) => console.error("Editor Surface retirement failed:", error));
  localFileCapabilities.revokeSender(webContentsId);
  const state = windowStateById.get(webContentsId);
  const workspacePaths = [...new Set([...(state?.folderPaths ?? []), ...projectSessions.snapshot(webContentsId).projects.map((project) => project.rootPath)])];
  for (const workspacePath of workspacePaths) {
    const existingWindow = workspaceWindowByPath.get(workspacePath);
    if (existingWindow === window || existingWindow?.isDestroyed()) {
      workspaceWindowByPath.delete(workspacePath);
    }
  }
  if (state) {
    state.releaseFolders();
  }
  if (window && !window.isDestroyed()) {
    window.setTitle(window.isFullScreen() ? "" : resolveWindowTitle(window));
  }
  return workspacePaths[0] ?? null;
}

async function forgetCurrentWindowWorkspace(sender) {
  return workspaceNavigation.run(sender.id, () => forgetCurrentWindowWorkspaceNow(sender));
}

async function forgetCurrentWindowWorkspaceNow(sender) {
  const window = BrowserWindow.fromWebContents(sender);
  if (!window || window.isDestroyed()) {
    await workspaceStateStore.forgetLastWorkspacePath();
    return;
  }

  const state = getOrCreateWindowState(window);
  const releasedPath = state.folderPaths[0] ?? null;
  for (const root of state.folderPaths) {
    await projectSessions.closeRoot(window.webContents.id, root);
    state.forgetFolder(root);
    if (workspaceWindowByPath.get(root) === window) workspaceWindowByPath.delete(root);
  }
  state.releaseFolders();
  if (releasedPath) await workspaceStateStore.removeRecentWorkspacePath(releasedPath);
}

function getOrCreateWindowState(window) {
  const webContentsId = window.webContents.id;
  let state = windowStateById.get(webContentsId);
  if (!state) {
    state = new WindowWorkspaceState();
    windowStateById.set(webContentsId, state);
  }
  return state;
}

function resolveWindowTitle(window) {
  const workspace = windowStateById.get(window.webContents.id)?.primaryWorkspace;
  return workspace ? `${appName} - ${workspace.name}` : appName;
}

function revealWorkspaceWindow(window, rootPath) {
  revealWindow(window);
  if (rootPath && !window.isDestroyed() && !getOrCreateWindowState(window).folderPaths.includes(rootPath)) {
    window.webContents.send("workspace:open-requested", { rootPath });
  }
}

function getWorkspaceWindow(canonicalPath) {
  const window = workspaceWindowByPath.get(canonicalPath);
  if (!window || window.isDestroyed()) {
    workspaceWindowByPath.delete(canonicalPath);
    return null;
  }
  return window;
}

function isOpenWorkspaceRoot(canonicalPath) {
  return Boolean(getWorkspaceWindow(canonicalPath));
}

function getWorkspaceRootsForSender(sender) {
  return projectSessions.roots(sender.id);
}

function getDialogOwnerWindow(sender) {
  const owner = windowsById.get(sender.id);
  if (owner && !owner.isDestroyed()) return owner;
  const window = BrowserWindow.fromWebContents(sender);
  if (window && !window.isDestroyed()) return window;
  return getLastFocusedWindow() ?? undefined;
}

async function canonicalizeWorkspacePath(folderPath) {
  const resolvedPath = path.resolve(folderPath);
  return fs.promises.realpath(resolvedPath).catch(() => resolvedPath);
}

async function showHomepageForCurrentWindow(sender) {
  return workspaceNavigation.run(sender.id, () => showHomepageForCurrentWindowNow(sender));
}

async function showHomepageForCurrentWindowNow(sender) {
  const window = BrowserWindow.fromWebContents(sender);
  if (!window || window.isDestroyed()) return;
  getOrCreateWindowState(window).releaseFolders();
  // The homepage hides views; explicit project/window close owns retirement.
  gitMetadataWatchService.stopForWindow(window.webContents.id);
}
