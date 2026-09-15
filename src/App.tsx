import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  closeDocumentWorkingCopy,
  withEditorDocumentOperations,
  closeDocumentWorkingCopiesUnderResource,
  createWorkspaceResourceUri,
  isDataResourceUri,
  isDocumentDataNode,
  qualifyDataResourcePath,
  type DataNode,
  type WorkspaceContentChange,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { DesktopCloudShell, type DesktopView } from "./components/DesktopCloudShell";
import {
  isSettingsSectionAvailable,
  SettingsDialog,
  type SettingsSection,
} from "./features/settings";
import { CLOUD_HUB_ENTRY_SECTION, type CloudWorkspaceSection } from "./features/cloud";
import {
  MinimalOnboarding,
} from "./components/MinimalOnboarding";
import { OnboardingProjectEntryDialog } from "./components/OnboardingProjectEntryDialog";
import { AssetLibraryHome } from "./components/AssetLibraryHome";
import {
  closeAgentChatWorkbenchItem,
  discardPreparedAgentChatWorkbenchItem,
  loadAgentChatHistoryBrowser,
  loadAgentChatWorkbenchItem,
  prepareAgentChatWorkbenchItem,
  resolveAgentWorkspaceProviderPath,
} from "./features/desktop-agent/lazy";
import {
  isDesktopTerminalEnabled,
} from "./features/desktop-terminal";
import { createTerminalWorkbenchContribution } from "./features/desktop-terminal/workbench/TerminalWorkbenchContribution";
import { readTerminalAppearance } from "./features/desktop-terminal/runtime/terminalAppearance";
import { AuxiliaryWorkbenchPanel } from "./features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { AuxiliaryWorkbenchLauncher } from "./features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchLauncher";
import { ProjectSessionManager } from "./features/app-shell/project-sessions/ProjectSessionManager";
import { getProjectSessionClient } from "./features/app-shell/project-sessions/projectSessionClient";
import { useProjectSession } from "./features/app-shell/project-sessions/useProjectSession";
import { useDesktopUpdates } from "./features/updates";
import {
  readPuppyoneWorkspaceConfig,
  removeWorkspaceGitRemote,
  showHomepage,
} from "./lib/localFiles";
import { openWorkspaceTarget } from "./lib/workspaceOpening";
import {
  getDesktopCloudApiBaseUrl,
  isCloudSessionForApiBase,
  type DesktopCloudSession,
} from "./lib/cloudApi";
import {
  resolveVisibleCreateNewMenuItems,
  type FilesVisibilitySettings,
} from "./preferences";
import type { PuppyoneWorkspaceConfig } from "./types/electron";
import {
  mergePuppyoneWorkspaceConfig,
} from "./features/app-shell/preferences";
import { DesktopTitlebarContext } from "./features/app-shell/DesktopTitlebarContext";
import { DesktopWorkspaceContent } from "./features/app-shell/DesktopWorkspaceContent";
import { DesktopTitlebarActions } from "./features/app-shell/DesktopTitlebarActions";
import {
  DesktopShellLocationBar,
  resolveDesktopShellLocationPath,
  resolveDesktopShellWorkspaceEntryPath,
} from "./features/app-shell/DesktopShellLocationBar";
import { DesktopOverlayPortal } from "./features/app-shell/DesktopOverlayPortal";
import { DesktopHelpLauncher } from "./features/app-shell/DesktopHelpLauncher";
import { RestoringWorkspaceScreen } from "./features/app-shell/RestoringWorkspaceScreen";
import { useDesktopPreferences } from "./features/app-shell/useDesktopPreferences";
import { isAssetLibraryHomeEnabled } from "./features/app-shell/homeFeatureGate";
import { useWorkspaceLifecycle } from "./features/app-shell/useWorkspaceLifecycle";
import { usePuppyoneConfig } from "./features/app-shell/usePuppyoneConfig";
import { useExternalFileOpen } from "./features/external-apps/useExternalFileOpen";
import { useDesktopCloudSession } from "./features/cloud/hooks/useDesktopCloudSession";
import {
  getResolvedCloudProjectId,
  resolveCloudHubSectionAfterContextChange,
  useCurrentRepositoryCloudContext,
} from "./features/cloud/project/context";
import { useFeatureFlag } from "./features/flags";
import {
  DesktopCreateEntryDialog,
  DesktopCreateEntryMenu,
  DesktopNodeActionMenu,
} from "./features/data-workspace/nodeActions";
import { createExplorerDataPort } from "./features/data-workspace/explorer";
import { createWorkbenchDataService } from "./features/data-workspace/workbenchDataPort";
import { useProjectExplorerSelection } from "./features/data-workspace/useProjectExplorerSession";
import { useDataNodeActions } from "./features/data-workspace/useDataNodeActions";
import { useAiEditReviewRequest } from "./features/data-workspace/useAiEditReviewRequest";
import { useWorkbenchWorkspaceContentWatch } from "./features/data-workspace/useWorkbenchWorkspaceContentWatch";
import { appendWorkbenchWorkspaceContentChange } from "./features/data-workspace/workbenchWorkspaceContentChange";
import {
  BranchSwitchConflictDialog,
  GitOperationErrorDialog,
} from "./features/source-control/operationDialogs";
import { useDesktopGitController } from "./features/source-control/useDesktopGitController";
import { GitChangesSidebar } from "./features/source-control/GitChangesSidebar";
import { GitHistorySidebar } from "./features/source-control/GitHistorySidebar";
import { createRepositoryRefreshReason } from "./features/source-control/repositoryRefreshPolicy";
import { getGitTitlebarStatus } from "./features/source-control/gitTitlebarStatus";
import { shouldBlockWorkspaceCloudResolution } from "./features/cloud/workspace/workspaceCloudResolutionKey";
import { useCloudInitialization } from "./features/cloud/initialization/useCloudInitialization";
import {
  TYPOGRAPHY_SCALE_METRICS,
  useTypographyCatalog,
  useTypographyRuntime,
} from "./features/typography";
import {
  resolveSurfaceAppearance,
  SurfaceAppearanceProvider,
} from "./features/appearance/AppearanceRuntime";
import { useDesktopEditorWorkbench } from "./features/editor-workbench/controller/useDesktopEditorWorkbench";
import type {
  AuxiliaryWorkbenchCloseAdapter,
  AuxiliaryWorkbenchContribution,
  AuxiliaryWorkbenchHistoryBrowserContext,
} from "./features/app-shell/auxiliary-workbench/types";
import {
  AGENT_CHAT_CREATION_RECIPES,
  localAgentIdForAgentChatRuntime,
} from "./features/app-shell/auxiliary-workbench/agentChatCreationRecipes";
import { useSubThemeCatalog, useSubThemeNativeMenu } from "./features/themes/useSubThemeCatalog";
import {
  MAX_PROJECT_SWITCHER_EXPANDED_WIDTH,
  MIN_PROJECT_SWITCHER_EXPANDED_WIDTH,
  ProjectSwitcherRail,
  resolveProjectSwitcherCompactWidth,
  resolveProjectSwitcherRailWidth,
} from "./features/app-shell/ProjectSwitcherRail";
import { ProjectEntryLauncherDialog } from "./features/app-shell/ProjectEntryLauncherDialog";

const AgentChatWorkbenchItem = lazy(loadAgentChatWorkbenchItem);
const AgentChatHistoryBrowser = lazy(loadAgentChatHistoryBrowser);
const EMPTY_WORKSPACE_FOLDERS: readonly WorkspaceFolder[] = Object.freeze([]);
type ProjectDesktopView = Exclude<DesktopView, "settings" | "cloud">;

export function App() {
  return <AppContent />;
}

function AppContent() {
  const { locale, t } = useLocalization();
  const desktopUpdates = useDesktopUpdates();
  const [activeView, setActiveView] = useState<DesktopView>("data");
  const lastProjectViewRef = useRef<ProjectDesktopView>("data");
  const subThemeCatalog = useSubThemeCatalog();
  const preferences = useDesktopPreferences(subThemeCatalog.snapshot);
  const multiRootWorkspacesEnabled = preferences.experimentalSettings.enableMultiRootWorkspaces;
  useSubThemeNativeMenu({
    snapshot: subThemeCatalog.snapshot,
    rootThemeId: preferences.interfaceStyle,
    colorMode: preferences.resolvedAppearance.effectiveColorMode,
    selectedSubThemeId: preferences.resolvedAppearance.subThemeId,
    onSubThemeChange: preferences.setSubThemeId,
  });
  const { setRightSidebarOpen, setProjectSwitcherExpanded } = preferences;
  const fontCatalog = useTypographyCatalog();
  const typography = useTypographyRuntime(
    preferences.typographyPreferences,
    fontCatalog,
    locale,
  );
  const projectSwitcherCompactWidth = resolveProjectSwitcherCompactWidth(
    TYPOGRAPHY_SCALE_METRICS[typography.scale].geometry.controlSize,
  );
  const projectSwitcherExpandedWidth = resolveProjectSwitcherRailWidth(
    true,
    preferences.projectSwitcherWidth,
  );
  const setProjectSwitcherCollapsed = useCallback(
    (collapsed: boolean) => setProjectSwitcherExpanded(!collapsed),
    [setProjectSwitcherExpanded],
  );
  const cloudAvailable = useFeatureFlag("cloudWorkspace");
  // The build flag only marks availability; PuppyOne Cloud stays hidden until
  // the user opts into the experiment in Settings.
  const cloudEnabled = cloudAvailable && preferences.experimentalSettings.enableCloudWorkspace;
  const assetLibraryHomeAvailable = useFeatureFlag("assetLibraryHome");
  const {
    cloudSession,
    cloudSessionRestoring,
    handleCloudSessionChange: updateCloudSession,
  } = useDesktopCloudSession(cloudEnabled);
  const [activeCloudSection, setActiveCloudSection] = useState<CloudWorkspaceSection>("initialize");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [projectEntryDialog, setProjectEntryDialog] = useState<"launcher" | "create" | "clone" | null>(null);
  const {
    addProject,
    addExistingProject,
    activeWorkspaceEntryKind,
    chooseProjectLocation,
    clearWorkspace,
    cloneRepository,
    createProject,
    forgetActiveWorkspace,
    handleWorkspaceOpenResult,
    openDroppedWorkspace,
    openFolder,
    openWorkspacePath,
    recentWorkspaceItems,
    removeWorkspaceFromRecents,
    removeProject,
    refreshRecentWorkspaceList,
    restoreWorkspaceError,
    restoringWorkspace,
    setRestoreWorkspaceError,
    setWorkspaces,
    workbenchWorkspace,
    workspace,
    workspaces,
  } = useWorkspaceLifecycle({
    multiRootWorkspacesEnabled,
    onWorkspaceActivated: useCallback(() => {
      setSwitcherOpen(false);
    }, []),
    onWorkspaceCleared: useCallback(() => {
      setActiveView("data");
      setSwitcherOpen(false);
    }, []),
    onWorkspaceOpenSettled: useCallback(() => {
      setSwitcherOpen(false);
    }, []),
  });
  const {
    aiEditAssistEnabled,
    createNewMenuSettings,
    explorerWidth,
    experimentalSettings,
    fileIconTheme,
    filesVisibilitySettings,
    interfaceStyle,
    resolvedAppearance,
    resolvedTheme,
    rightSidebarOpen,
    rightSidebarToolsSettings,
    rightSidebarWidth,
    rightSidebarSurface,
    agentPreferredRuntime,
    agentPreferredRoute,
    agentPreferredModel,
    localAgentsSettings,
    sidebarCollapsed,
    sidebarNavigationLayout,
    sidebarNavigationOrientation,
    sidebarNavigationPlacement,
    terminalToolEnabled,
    titlebarActionsSettings,
    darkThemePreset,
    diffMarkers,
    lightThemePreset,
    markdownPresentation,
    pointerCursors,
    setAiEditAssistEnabled,
    setExplorerWidth,
    setFileIconTheme,
    setFilesVisibilitySettings,
    setRightSidebarToolsSettings,
    setRightSidebarWidth,
    setRightSidebarSurface,
    setAgentPreferredRuntime,
    setAgentPreferredRoute,
    setAgentPreferredModel,
    setLocalAgentsSettings,
    setSidebarCollapsed,
    setSidebarNavigationLayout,
    setThemeMode,
  } = preferences;
  const surfaceAppearance = useMemo(() => resolveSurfaceAppearance({
    appearance: resolvedAppearance,
    typography,
    markdownPresentation,
    loadingAnimationPreset: preferences.loadingAnimationPreset,
    lightThemePreset,
    darkThemePreset,
    pointerCursors,
    diffMarkers,
  }), [
    darkThemePreset,
    diffMarkers,
    lightThemePreset,
    markdownPresentation,
    pointerCursors,
    preferences.loadingAnimationPreset,
    resolvedAppearance,
    typography,
  ]);
  const createNewItems = useMemo(
    () => resolveVisibleCreateNewMenuItems(createNewMenuSettings, experimentalSettings),
    [createNewMenuSettings, experimentalSettings],
  );
  const agentChatRuntimeVisibility = useMemo(() => {
    const hiddenLocalAgentIds = new Set(localAgentsSettings.hiddenTerminalAgentIds);
    const activeRecipes = AGENT_CHAT_CREATION_RECIPES.filter(
      (recipe) => !hiddenLocalAgentIds.has(localAgentIdForAgentChatRuntime(recipe.id)),
    );
    const hiddenRuntimeIds: string[] = AGENT_CHAT_CREATION_RECIPES.flatMap(
      (recipe) => hiddenLocalAgentIds.has(localAgentIdForAgentChatRuntime(recipe.id))
        ? [recipe.id]
        : [],
    );
    return Object.freeze({ activeRecipes, hiddenRuntimeIds });
  }, [localAgentsSettings.hiddenTerminalAgentIds]);
  const assetLibraryHomeEnabled = isAssetLibraryHomeEnabled({
    available: assetLibraryHomeAvailable,
    optedIn: experimentalSettings.enableAssetLibraryHome,
  });
  const Homepage = assetLibraryHomeEnabled ? AssetLibraryHome : MinimalOnboarding;
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>("general");
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [cloudDialogOpen, setCloudDialogOpen] = useState(false);
  const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState<WorkspaceContentChange>({
    sequence: 0,
    entries: [],
  });
  const [workspaceAtomicRefreshToken, setWorkspaceAtomicRefreshToken] = useState(0);
  const workbenchDataService = useMemo(
    () => (workbenchWorkspace ? createWorkbenchDataService(workbenchWorkspace) : null),
    [workbenchWorkspace],
  );
  const dataPort = useMemo(
    () => (workbenchDataService
      ? withEditorDocumentOperations(createExplorerDataPort(workbenchDataService.dataPort, filesVisibilitySettings))
      : null),
    [filesVisibilitySettings, workbenchDataService],
  );
  const documentStorageIdentity = dataPort?.documentPersistence?.storageIdentity ?? null;
  const resolveEditorResource = useCallback((path: string) => {
    if (!workbenchDataService) return null;
    const resolved = workbenchDataService.tryResolveResource(path);
    if (!resolved) return null;
    if (!resolved.providerPath) return null;
    return {
      rootUri: resolved.folder.uri,
      resourcePath: resolved.providerPath,
      hostPath: path,
    };
  }, [workbenchDataService]);
  const resolveWorkspaceResource = useCallback((path: string | null) => {
    if (!path || !workbenchDataService) return null;
    return workbenchDataService.tryResolveResource(path);
  }, [workbenchDataService]);
  const resolveAgentWorkspaceReference = useCallback(async (resource: string) => {
    if (!workbenchDataService || !isDataResourceUri(resource)) return null;
    try {
      const resolved = workbenchDataService.resolveResource(resource);
      const loadVisualPreview = resolved.providerPath
        && isPreviewableAgentImagePath(resolved.providerPath)
        && workbenchDataService.dataPort.getFileUrl
        ? async () => {
            const url = await workbenchDataService.dataPort.getFileUrl!(resource, { purpose: "file-preview" });
            return {
              url,
              release: () => {
                void Promise.resolve(workbenchDataService.dataPort.revokeFileUrl?.(url)).catch(() => undefined);
              },
            };
          }
        : undefined;
      return {
        workspaceRoot: resolved.folder.workspace.path,
        referencePath: resolved.providerPath ?? ".",
        ...(loadVisualPreview ? { loadVisualPreview } : {}),
      };
    } catch {
      return null;
    }
  }, [workbenchDataService]);
  const editorWorkbench = useDesktopEditorWorkbench(
    workspace,
    dataPort?.resolveNode ?? null,
    workbenchWorkspace?.folders[0]?.uri ?? null,
    resolveEditorResource,
    workbenchWorkspace?.id ?? null,
  );
  const activeDocumentPath = editorWorkbench.activePath;
  const handleResourceMoved = useCallback(async (previousPath: string, nextPath: string) => {
    editorWorkbench.rebaseResource(previousPath, nextPath);
  }, [editorWorkbench]);
  const handleResourceDeleted = useCallback(async (path: string) => {
    editorWorkbench.closeUnderResource(path);
  }, [editorWorkbench]);
  const [activeExplorerNode, setActiveExplorerNode] = useProjectExplorerSelection(workspace);
  const activeDocumentResource = resolveWorkspaceResource(activeDocumentPath);
  const currentActiveDocumentPath = activeDocumentResource ? activeDocumentPath : null;
  const focusedWorkspaceResource = resolveWorkspaceResource(
    currentActiveDocumentPath ?? activeExplorerNode?.path ?? null,
  );
  const focusedWorkspaceFolder = focusedWorkspaceResource?.folder
    ?? workbenchWorkspace?.folders[0]
    ?? null;
  const focusedWorkspace = focusedWorkspaceFolder?.workspace ?? workspace;
  const rightSidebarContentVisible = rightSidebarOpen;
  const gitHistorySidebarOpen = rightSidebarContentVisible
    && rightSidebarSurface === "history";
  const gitChangesSidebarOpen = rightSidebarContentVisible
    && rightSidebarSurface === "changes";
  const agentSidebarOpen = rightSidebarContentVisible
    && rightSidebarSurface === "chat";
  const handleRemoveProject = useCallback(async (folder: WorkspaceFolder) => {
    if (documentStorageIdentity) {
      await closeDocumentWorkingCopiesUnderResource(documentStorageIdentity, folder.uri);
    }
    editorWorkbench.closeUnderResource(folder.uri);
    if (activeExplorerNode?.workspaceFolderId === folder.id) setActiveExplorerNode(null);
    await removeProject(folder.workspace.path);
  }, [activeExplorerNode?.workspaceFolderId, documentStorageIdentity, editorWorkbench, removeProject, setActiveExplorerNode]);
  const activeExplorerPath = activeExplorerNode?.path ?? currentActiveDocumentPath;
  const activateDataNode = useCallback((node: DataNode) => {
    setActiveExplorerNode(node);
    if (isDocumentDataNode(node)) editorWorkbench.openDocument(node);
  }, [editorWorkbench, setActiveExplorerNode]);
  const [documentNavigationError, setDocumentNavigationError] = useState<string | null>(null);
  const documentNavigationRequestRef = useRef(0);
  const desktopViewNavigationRequestRef = useRef(0);
  const drainWorkspaceNavigation = useCallback(async (): Promise<boolean> => {
    // Navigation retains document models, outstanding saves, and root watches.
    setDocumentNavigationError(null);
    return true;
  }, []);
  const switcherRef = useRef<HTMLDivElement>(null);
  const desktopTerminalEnabled = isDesktopTerminalEnabled({ terminalToolEnabled });

  const refreshWorkspaceContent = useCallback((
    paths: readonly string[] | string | null = null,
    workspaceFolderId: string | null = null,
    presentation: "incremental" | "atomic" = "incremental",
  ) => {
    setWorkspaceRefreshToken((current) => appendWorkbenchWorkspaceContentChange(
      current,
      workbenchWorkspace,
      { paths, workspaceFolderId },
    ));
    if (presentation === "atomic") {
      setWorkspaceAtomicRefreshToken((current) => current + 1);
    }
  }, [workbenchWorkspace]);
  const refreshWorkspaceContentFromGit = useCallback((
    presentation: "incremental" | "atomic" = "incremental",
  ) => {
    refreshWorkspaceContent(null, null, presentation);
  }, [refreshWorkspaceContent]);
  const git = useDesktopGitController({
    workspace: focusedWorkspace,
    gitChangesActive: gitChangesSidebarOpen,
    gitHistoryActive: gitHistorySidebarOpen,
    onWorkspaceContentChanged: refreshWorkspaceContentFromGit,
  });
  const invalidateGitStatus = git.invalidateGitStatus;
  const handleWorkspaceActivity = useCallback((folder: WorkspaceFolder) => {
    if (folder.workspace.path === focusedWorkspace?.path) {
      invalidateGitStatus("working-tree");
    }
  }, [focusedWorkspace?.path, invalidateGitStatus]);
  useWorkbenchWorkspaceContentWatch({
    folders: workbenchWorkspace?.folders ?? EMPTY_WORKSPACE_FOLDERS,
    storageIdentity: documentStorageIdentity,
    onWorkspaceContentChanged: refreshWorkspaceContent,
    onWorkspaceActivity: handleWorkspaceActivity,
  });
  const {
    activeGitStatus,
    branchSwitcherOpen,
    branchSwitcherRef,
    gitCommitDetail,
    gitCommitDetailError,
    gitCommitDetailLoading,
    gitHistoryLoading,
    gitIncomingCount,
    gitOperationError,
    gitOperationLoading,
    gitStatusError,
    gitStatusLoading,
    gitStatusPath,
    gitWorkingFileDiff,
    gitWorkingFileDiffError,
    gitWorkingFileDiffLoading,
    localBranches,
    pendingBranchSwitch,
    remoteBranches,
    selectedGitCommitId,
    selectedGitWorkingFile,
    applyGitStatus,
    captureGitRepositoryContext,
    clearGitSelection,
    dismissGitOperationError,
    handleAbortGitOperation,
    handleCheckoutGitBranch,
    handleCommitAndCheckoutBranch,
    handleCommitAndPushGit,
    handleCommitGit,
    handleContinueGitOperation,
    handleDiscardAllGitChanges,
    handleDiscardGitPaths,
    handleInitializeGitRepository,
    handlePublishGitBranch,
    handlePullGit,
    handlePushGit,
    handleStageAllGitChanges,
    handleStageAndCommitGit,
    handleStageGitPaths,
    handleStashGitChanges,
    handleStashAndCheckoutBranch,
    handleUnstageGitPaths,
    isGitRepositoryContextCurrent,
    refreshGitStatus,
    refreshGitStatusWithFetch,
    selectGitCommit,
    selectGitWorkingFile,
    setBranchSwitcherOpen,
    setGitOperationError,
    setGitOperationLoading,
    setPendingBranchSwitch,
  } = git;
  const openSettingsDialog = useCallback((section?: SettingsSection) => {
    if (section) setActiveSettingsSection(section);
    setSettingsDialogOpen(true);
    setCloudDialogOpen(false);
    setSwitcherOpen(false);
    setBranchSwitcherOpen(false);
  }, [setBranchSwitcherOpen]);
  const closeSettingsDialog = useCallback(() => setSettingsDialogOpen(false), []);
  const openCloudDialog = useCallback(() => {
    if (!cloudEnabled) return;
    setActiveView("data");
    setActiveCloudSection(CLOUD_HUB_ENTRY_SECTION);
    setCloudDialogOpen(true);
    setSettingsDialogOpen(false);
    setSidebarCollapsed(false);
    setSwitcherOpen(false);
    setBranchSwitcherOpen(false);
  }, [cloudEnabled, setBranchSwitcherOpen, setSidebarCollapsed]);
  const closeCloudDialog = useCallback(() => setCloudDialogOpen(false), []);

  useEffect(() => {
    const handleSettingsShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== ",") return;
      event.preventDefault();
      openSettingsDialog();
    };
    window.addEventListener("keydown", handleSettingsShortcut);
    return () => window.removeEventListener("keydown", handleSettingsShortcut);
  }, [openSettingsDialog]);

  const handleWorkspaceStarterCreated = useCallback((path: string) => {
    refreshWorkspaceContent(path);
    void refreshGitStatus("first-project-starter");
  }, [refreshGitStatus, refreshWorkspaceContent]);
  const {
    puppyoneConfig,
    puppyoneConfigError,
    puppyoneConfigLoading,
    puppyoneConfigSaving,
    handlePuppyoneConfigChange: savePuppyoneConfig,
  } = usePuppyoneConfig(focusedWorkspace?.path ?? null);
  const workspaceKey = useMemo(
    () => workbenchWorkspace?.id ?? "no-workspace",
    [workbenchWorkspace?.id],
  );
  const desktopCloudApiBaseUrl = useMemo(() => getDesktopCloudApiBaseUrl(), []);
  const activeCloudSession = useMemo(
    () => isCloudSessionForApiBase(cloudSession, desktopCloudApiBaseUrl) ? cloudSession : null,
    [cloudSession, desktopCloudApiBaseUrl],
  );
  const latestAiEditRequest = useAiEditReviewRequest({
    aiEditAssistEnabled,
    onWorkspaceContentChanged: refreshWorkspaceContent,
    workspace: focusedWorkspace,
    workspaceRootUri: focusedWorkspaceFolder?.uri ?? null,
  });
  const activeAiEditRequest = aiEditAssistEnabled ? latestAiEditRequest : null;
  const enterDataView = useCallback(() => {
    setActiveView("data");
    setSidebarCollapsed(false);
    setSwitcherOpen(false);
    setBranchSwitcherOpen(false);
  }, [setBranchSwitcherOpen, setSidebarCollapsed]);
  const {
    createEntryDraft,
    nodeActionMenu,
    fileClipboardController,
    resetDataNodeActions,
    setCreateEntryDraft,
    setNodeActionMenu,
    openCreateEntryMenu,
    openNodeActionMenu,
    selectCreateEntryKind,
    createEntryFromMenu,
    renameNodeFromMenu,
    deleteNodeFromMenu,
    revealNodeInFinderFromMenu,
    openNodeInDefaultAppFromMenu,
  } = useDataNodeActions({
    dataPort,
    onEnterDataView: enterDataView,
    onLocalWorkspaceContentChanged: refreshGitStatus,
    onWorkspaceContentChanged: refreshWorkspaceContent,
    onResourceDeleted: handleResourceDeleted,
    onResourceMoved: handleResourceMoved,
    onActivateNode: activateDataNode,
    setActiveExplorerNode,
    workspace,
  });

  useEffect(() => {
    if (activeView === "cloud") {
      setActiveView("data");
      setCloudDialogOpen(cloudEnabled);
      if (!cloudEnabled) setActiveCloudSection("initialize");
      return;
    }
    if (!cloudEnabled) setCloudDialogOpen(false);
    if (
      activeView === "git"
      || (activeView === "plugins" && !experimentalSettings.enableViewerPlugins)
    ) {
      setActiveView("data");
      setActiveCloudSection("initialize");
    }
  }, [activeView, cloudEnabled, experimentalSettings.enableViewerPlugins]);

  useEffect(() => {
    if (!isSettingsSectionAvailable(activeSettingsSection, { cloudEnabled })) {
      setActiveSettingsSection("general");
    }
  }, [activeSettingsSection, cloudEnabled]);

  useEffect(() => {
    const preventFileDropNavigation = (event: DragEvent) => {
      event.preventDefault();
    };

    window.addEventListener("dragover", preventFileDropNavigation);
    window.addEventListener("drop", preventFileDropNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileDropNavigation);
      window.removeEventListener("drop", preventFileDropNavigation);
    };
  }, []);

  useEffect(() => {
    setGitOperationError(null);
    setGitOperationLoading(null);
    setBranchSwitcherOpen(false);
    resetDataNodeActions();
  }, [resetDataNodeActions, setBranchSwitcherOpen, setGitOperationError, setGitOperationLoading, workspace?.path]);

  const cloudResolutionInputsLoading = shouldBlockWorkspaceCloudResolution({
    gitStatusError,
    gitStatusPath,
    workspacePath: focusedWorkspace?.path ?? null,
  });

  const projectCloudContext = useCurrentRepositoryCloudContext({
    workspace: focusedWorkspace,
    activeGitStatus,
    activeCloudSession,
    cloudEnabled,
    desktopCloudApiBaseUrl,
    resolutionInputsLoading: cloudResolutionInputsLoading,
    updateCloudSession,
  });
  const resolvedCloudProjectId = getResolvedCloudProjectId(projectCloudContext);

  const workspacePath = focusedWorkspace?.path ?? null;
  const cloudHubWorkspaceIdentity = focusedWorkspace
    ? `${focusedWorkspace.id}:${focusedWorkspace.path}`
    : null;
  const previousCloudHubWorkspaceIdentityRef = useRef<string | null>(null);
  useEffect(() => {
    const workspaceChanged = previousCloudHubWorkspaceIdentityRef.current !== cloudHubWorkspaceIdentity;
    previousCloudHubWorkspaceIdentityRef.current = cloudHubWorkspaceIdentity;
    if (!workspacePath) return;
    setActiveCloudSection((currentSection) => resolveCloudHubSectionAfterContextChange({
      currentSection,
      hasProjectContext: Boolean(resolvedCloudProjectId),
      workspaceChanged,
    }));
  }, [resolvedCloudProjectId, cloudHubWorkspaceIdentity, workspacePath]);

  const goToHomepage = useCallback(async () => {
    try {
      if (!await drainWorkspaceNavigation()) return;
      await showHomepage();
      clearWorkspace();
      setSwitcherOpen(false);
      setBranchSwitcherOpen(false);
      setRightSidebarOpen(false);
      resetDataNodeActions();
      setRestoreWorkspaceError(null);
      await refreshRecentWorkspaceList();
    } catch (error) {
      setRestoreWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, [
    clearWorkspace,
    drainWorkspaceNavigation,
    refreshRecentWorkspaceList,
    resetDataNodeActions,
    setBranchSwitcherOpen,
    setRestoreWorkspaceError,
    setRightSidebarOpen,
  ]);

  const navigateDesktopView = useCallback((view: DesktopView) => {
    const requestId = ++desktopViewNavigationRequestRef.current;
    const commitNavigation = () => {
      if (requestId !== desktopViewNavigationRequestRef.current) return;
      setDocumentNavigationError(null);

      if (view === "plugins" && !experimentalSettings.enableViewerPlugins) {
        setActiveView("data");
        setSidebarCollapsed(false);
        setSwitcherOpen(false);
        return;
      }

      if (view === "cloud" && !cloudEnabled) {
        setActiveView("data");
        setSidebarCollapsed(false);
        setSwitcherOpen(false);
        return;
      }

      if (view === "cloud") {
        openCloudDialog();
        return;
      }

      setActiveView(view);
      setSidebarCollapsed(false);
      setSwitcherOpen(false);
    };

    void commitNavigation();
  }, [
    cloudEnabled,
    experimentalSettings.enableViewerPlugins,
    openCloudDialog,
    setSidebarCollapsed,
  ]);

  useEffect(() => {
    if (activeView !== "settings" && activeView !== "cloud") lastProjectViewRef.current = activeView;
  }, [activeView]);

  const switchProjectFromRail = useCallback(async (path: string) => {
    const projectView = lastProjectViewRef.current;
    if (path === workspace?.path) {
      navigateDesktopView(projectView);
      return;
    }
    try {
      if (!await drainWorkspaceNavigation()) return;
      await openWorkspacePath(path);
      navigateDesktopView(projectView);
    } catch (error) {
      setRestoreWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, [
    drainWorkspaceNavigation,
    navigateDesktopView,
    openWorkspacePath,
    setRestoreWorkspaceError,
    workspace?.path,
  ]);

  useEffect(() => window.puppyoneDesktop?.onWorkspaceOpenRequested?.(({ rootPath }) => {
    void switchProjectFromRail(rootPath);
  }), [switchProjectFromRail]);

  const handleActiveDataPathChange = useCallback(async (
    path: string | null,
    node: DataNode | null = null,
  ) => {
    const requestId = ++documentNavigationRequestRef.current;
    if (requestId !== documentNavigationRequestRef.current) return;
    setDocumentNavigationError(null);
    if (!path) {
      setActiveExplorerNode(null);
      return;
    }
    try {
      const resolvedNode = node ?? await dataPort?.resolveNode?.(path) ?? null;
      if (requestId !== documentNavigationRequestRef.current) return;
      if (!resolvedNode) {
        setDocumentNavigationError(`Unable to resolve workspace entry: ${path}`);
        return;
      }
      activateDataNode(resolvedNode);
      setActiveView("data");
    } catch (error) {
      if (requestId === documentNavigationRequestRef.current) {
        setDocumentNavigationError(error instanceof Error ? error.message : String(error));
      }
    }
  }, [activateDataNode, dataPort, setActiveExplorerNode]);
  const handleEditorClose = useCallback(async (editorId: string) => {
    try {
      const resourcePath = editorWorkbench.state.editors
        .find((editor) => editor.id === editorId)?.resource;
      if (!resourcePath) return;
      if (documentStorageIdentity) {
        await closeDocumentWorkingCopy({
          storageIdentity: documentStorageIdentity,
          resourcePath,
        });
      }
      editorWorkbench.close(editorId);
      setDocumentNavigationError(null);
    } catch (error) {
      setDocumentNavigationError(error instanceof Error ? error.message : String(error));
    }
  }, [documentStorageIdentity, editorWorkbench]);
  useEffect(() => {
    const handleEditorShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || activeView !== "data" || editorWorkbench.state.editors.length === 0) return;
      const platformModifier = event.metaKey || event.ctrlKey;
      if (platformModifier && !event.altKey && event.key.toLowerCase() === "w") {
        if (!editorWorkbench.activeEditorId) return;
        event.preventDefault();
        void handleEditorClose(editorWorkbench.activeEditorId);
        return;
      }
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
        event.preventDefault();
        const currentIndex = editorWorkbench.state.editors.findIndex(
          ({ id }) => id === editorWorkbench.activeEditorId,
        );
        const offset = event.shiftKey ? -1 : 1;
        const nextIndex = (currentIndex + offset + editorWorkbench.state.editors.length) % editorWorkbench.state.editors.length;
        editorWorkbench.activate(editorWorkbench.state.editors[nextIndex]!.id);
        return;
      }
    };
    window.addEventListener("keydown", handleEditorShortcut, true);
    return () => window.removeEventListener("keydown", handleEditorShortcut, true);
  }, [activeView, editorWorkbench, handleEditorClose]);
  const handleActiveDataNodeChange = useCallback((node: DataNode | null) => {
    setActiveExplorerNode((current) => (
      hasSameActiveDataNodeIdentity(current, node) ? current : node
    ));
  }, [setActiveExplorerNode]);

  const handleFilesVisibilitySettingsChange = useCallback((nextSettings: FilesVisibilitySettings) => {
    setFilesVisibilitySettings(nextSettings);
    refreshWorkspaceContent();
  }, [refreshWorkspaceContent, setFilesVisibilitySettings]);

  const handlePuppyoneConfigChange = useCallback(async (nextConfig: PuppyoneWorkspaceConfig) => {
    const savedConfig = await savePuppyoneConfig(nextConfig);
    if (savedConfig) {
      refreshWorkspaceContent();
      await refreshGitStatus("configuration");
    }
    return savedConfig;
  }, [refreshGitStatus, refreshWorkspaceContent, savePuppyoneConfig]);

  const [workspaceSurfaceError, setWorkspaceSurfaceError] = useState<string | null>(null);

  const closeSwitcher = useCallback(() => {
    setSwitcherOpen(false);
  }, []);
  const externalFileOpen = useExternalFileOpen({
    dataPort,
    onActionSettled: closeSwitcher,
    onError: setWorkspaceSurfaceError,
    workspace: focusedWorkspace,
  });

  const handleCloudSessionChange = useCallback((session: DesktopCloudSession | null) => {
    if (!cloudEnabled) return;

    updateCloudSession(session);
    if (!session) {
      if (settingsDialogOpen) {
        setActiveSettingsSection("account");
        return;
      }
      setActiveCloudSection("initialize");
      setActiveView("data");
      setCloudDialogOpen(true);
      setSidebarCollapsed(false);
      setSwitcherOpen(false);
    }
  }, [cloudEnabled, setSidebarCollapsed, settingsDialogOpen, updateCloudSession]);

  const handleRemoveCloudRemote = useCallback(async () => {
    if (!focusedWorkspace) return;
    const refreshedStatus = await removeWorkspaceGitRemote(focusedWorkspace.path, "puppyone");
    const currentConfig = puppyoneConfig
      ?? await readPuppyoneWorkspaceConfig(focusedWorkspace.path);
    const configReferencesPuppyone = currentConfig.sync.sourceOfTruth.service === "puppyone"
      || currentConfig.sync.sourceOfTruth.remote === "puppyone"
      || currentConfig.backup.service === "puppyone"
      || currentConfig.backup.remote === "puppyone"
      || currentConfig.git.primaryRemote === "puppyone";
    // Initialize and Push intentionally keeps Cloud identity in Git. If this
    // workspace never opted into legacy sync preferences, removing the remote
    // must not create a new `.puppyone/config.json` file as a side effect.
    if (configReferencesPuppyone) {
      const nextConfig = mergePuppyoneWorkspaceConfig(currentConfig, {
        sync: {
          sourceOfTruth: { service: "github", remote: null, branch: null },
        },
        backup: {
          enabled: false,
          service: "github",
          remote: null,
          branch: null,
        },
        git: {
          primaryRemote: null,
          watchedBranch: null,
        },
      });
      const savedConfig = await handlePuppyoneConfigChange(nextConfig);
      if (!savedConfig) {
        throw new Error("The PuppyOne Git remote was removed, but Desktop could not update the local sync settings.");
      }
    }
    const context = captureGitRepositoryContext(focusedWorkspace.path);
    if (context && applyGitStatus(
      refreshedStatus,
      context,
      createRepositoryRefreshReason("configure-remote", "mutation"),
    )) {
      refreshWorkspaceContent();
    }
    setActiveCloudSection("initialize");
  }, [
    applyGitStatus,
    captureGitRepositoryContext,
    handlePuppyoneConfigChange,
    puppyoneConfig,
    refreshWorkspaceContent,
    focusedWorkspace,
  ]);

  const {
    cloudInitializationLoading: cloudBackupLoading,
    cloudInitializationError: cloudPublishError,
    cloudInitializationNotice: cloudPublishNotice,
    cloudInitializationProgress: cloudPublishProgress,
    cloudInitializationState: cloudPublishState,
    cloudInitializationStateLoading: cloudPublishStateLoading,
    handleCleanupCloudInitialization: handleAbandonPuppyoneBackup,
    handleStartCloudInitialization: handleStartPuppyoneBackup,
    cloudInitializationPending: pendingCloudBackupSetup,
  } = useCloudInitialization({
    activeCloudSession,
    applyGitStatus,
    captureGitRepositoryContext,
    clearGitSelection,
    cloudEnabled,
    desktopCloudApiBaseUrl,
    isGitRepositoryContextCurrent,
    refreshWorkspaceContent,
    setActiveCloudSection,
    setActiveView,
    setSidebarCollapsed,
    setSwitcherOpen,
    workspace,
  });

  const unlinkCurrentWorkspace = useCallback(async () => {
    // Forgetting a project actually retires its authorization and editors.
    if (documentStorageIdentity && workbenchWorkspace) {
      for (const folder of workbenchWorkspace.folders) {
        await closeDocumentWorkingCopiesUnderResource(documentStorageIdentity, folder.uri);
      }
    }
    editorWorkbench.clear();
    await forgetActiveWorkspace();
    setSwitcherOpen(false);
    setBranchSwitcherOpen(false);
    setRightSidebarOpen(false);
    setSettingsDialogOpen(false);
    setCloudDialogOpen(false);
    resetDataNodeActions();
  }, [
    documentStorageIdentity,
    workbenchWorkspace,
    editorWorkbench,
    forgetActiveWorkspace,
    resetDataNodeActions,
    setBranchSwitcherOpen,
    setRightSidebarOpen,
  ]);

  const toggleWorkspaceSwitcher = useCallback(() => {
    const nextOpen = !switcherOpen;
    setSwitcherOpen(nextOpen);
    setBranchSwitcherOpen(false);
  }, [setBranchSwitcherOpen, switcherOpen]);

  const toggleBranchSwitcher = useCallback(() => {
    setBranchSwitcherOpen((open) => !open);
    setSwitcherOpen(false);
  }, [setBranchSwitcherOpen]);

  const closeBranchSwitcher = useCallback(() => {
    setBranchSwitcherOpen(false);
  }, [setBranchSwitcherOpen]);

  const closeWorkspaceSwitcher = useCallback(() => {
    setSwitcherOpen(false);
  }, []);

  const handleLocationBarNavigate = useCallback(async (displayPath: string) => {
    if (!workspace || !workbenchWorkspace) return;
    navigateDesktopView("data");
    if (!dataPort) return;
    const activeResource = resolveWorkspaceResource(activeDocumentPath ?? activeExplorerNode?.path ?? null);
    const folders = activeResource
      ? [activeResource.folder, ...workbenchWorkspace.folders.filter((folder) => folder.id !== activeResource.folder.id)]
      : [...workbenchWorkspace.folders];
    const target = folders
      .map((folder) => ({
        folder,
        entryPath: resolveDesktopShellWorkspaceEntryPath(displayPath, folder.workspace.path),
      }))
      .find((candidate) => candidate.entryPath !== undefined);
    if (!target) return;
    const targetEntryPath = target.entryPath;
    if (targetEntryPath === undefined) return;
    if (targetEntryPath === null && workbenchWorkspace.folders.length === 1) {
      setActiveExplorerNode(null);
      return;
    }

    try {
      const resourcePath = targetEntryPath === null
        ? target.folder.uri
        : createWorkspaceResourceUri(target.folder.uri, targetEntryPath);
      const node = await dataPort.resolveNode?.(resourcePath) ?? null;
      if (node) await handleActiveDataPathChange(node.path, node);
    } catch {
      // The workspace surface already owns filesystem error presentation. An
      // invalid address remains editable so the user can correct it in place.
    }
  }, [
    activeDocumentPath,
    activeExplorerNode?.path,
    dataPort,
    handleActiveDataPathChange,
    navigateDesktopView,
    resolveWorkspaceResource,
    setActiveExplorerNode,
    workbenchWorkspace,
    workspace,
  ]);

  const handleAgentOpenFile = useCallback((workspaceRootPath: string, path: string) => {
    const folder = workbenchWorkspace?.folders.find(
      (candidate) => candidate.workspace.path === workspaceRootPath,
    );
    if (!folder) return;
    const providerPath = isDataResourceUri(path)
      ? path
      : resolveAgentWorkspaceProviderPath(workspaceRootPath, path);
    if (!providerPath) return;
    const resource = qualifyDataResourcePath(folder.uri, providerPath);
    handleActiveDataPathChange(resource);
    navigateDesktopView("data");
  }, [handleActiveDataPathChange, navigateDesktopView, workbenchWorkspace?.folders]);
  const agentChatContribution = useMemo<AuxiliaryWorkbenchContribution>(() => {
    return Object.freeze({
      kind: "agent-chat",
      label: t("agent.panel.chat", { agent: t("agent.name") }),
      createLabel: t("agent.header.newChat"),
      initialSnapshot: Object.freeze({
        title: t("agent.header.newChat"),
        accessibleLabel: `${t("agent.header.newChat")} — ${t("agent.name")}`,
        detail: t("agent.name"),
        iconKey: null,
        status: "starting",
        running: false,
        resourceId: null,
      }),
      maximumItems: 8,
      minimumSize: Object.freeze({ width: 280, height: 260 }),
      creationRecipes: agentChatRuntimeVisibility.activeRecipes,
      history: Object.freeze({
        label: t("agent.history.title"),
        iconKey: null,
        renderBrowser: (context: AuxiliaryWorkbenchHistoryBrowserContext) => (
          <Suspense fallback={null}>
            <AgentChatHistoryBrowser
              {...context}
              historyDiscoveryEnabled={localAgentsSettings.chatHistoryDiscoveryEnabled}
              onHistoryDiscoveryEnabledChange={(enabled) => setLocalAgentsSettings({
                ...localAgentsSettings,
                chatHistoryDiscoveryEnabled: enabled,
              })}
            />
          </Suspense>
        ),
      }),
      prepare: prepareAgentChatWorkbenchItem,
      discardPreparedItem: discardPreparedAgentChatWorkbenchItem,
      renderItem: (context) => (
        <Suspense fallback={null}>
          <AgentChatWorkbenchItem
            {...context}
            hiddenRuntimeIds={agentChatRuntimeVisibility.hiddenRuntimeIds}
            preferredRuntimeId={agentPreferredRuntime
              && !agentChatRuntimeVisibility.hiddenRuntimeIds.includes(agentPreferredRuntime)
              ? agentPreferredRuntime
              : null}
            onPreferredRuntimeChange={setAgentPreferredRuntime}
            preferredRoute={agentPreferredRoute}
            onPreferredRouteChange={setAgentPreferredRoute}
            preferredModel={agentPreferredModel}
            onPreferredModelChange={setAgentPreferredModel}
            onOpenFile={(path) => handleAgentOpenFile(context.item.rootId, path)}
            resolveWorkspaceReference={resolveAgentWorkspaceReference}
          />
        </Suspense>
      ),
      close: Object.freeze<AuxiliaryWorkbenchCloseAdapter>({
        decide: ({ snapshot }) => snapshot.running
          ? Object.freeze({
              kind: "blocked" as const,
              dialog: Object.freeze({
                title: t("agent.closeDialog.activeTitle", { title: snapshot.title }),
                detail: t("agent.closeDialog.activeDetail"),
                actionLabel: t("agent.closeDialog.keepOpen"),
              }),
            })
          : Object.freeze({ kind: "close" as const }),
        commit: ({ item, project }) => closeAgentChatWorkbenchItem(project, item.id),
      }),
    });
  }, [
    agentPreferredModel,
    agentPreferredRoute,
    agentPreferredRuntime,
    agentChatRuntimeVisibility,
    handleAgentOpenFile,
    localAgentsSettings,
    resolveAgentWorkspaceReference,
    setAgentPreferredModel,
    setAgentPreferredRoute,
    setAgentPreferredRuntime,
    setLocalAgentsSettings,
    t,
  ]);
  const auxiliarySurfaceRef = useRef<HTMLDivElement>(null);
  const readAuxiliaryTerminalAppearance = useCallback(() => {
    const surface = auxiliarySurfaceRef.current;
    if (!surface) throw new Error("The auxiliary appearance surface is not mounted.");
    return readTerminalAppearance(surface);
  }, []);
  const auxiliaryWorkbenchContributions = useMemo(
    () => [
      ...(desktopTerminalEnabled
        ? [createTerminalWorkbenchContribution(t, readAuxiliaryTerminalAppearance)]
        : []),
      agentChatContribution,
    ],
    [
      agentChatContribution,
      desktopTerminalEnabled,
      readAuxiliaryTerminalAppearance,
      t,
    ],
  );
  const [projectSessions] = useState(() => new ProjectSessionManager());
  useEffect(() => {
    const client = getProjectSessionClient();
    return client ? projectSessions.connect(client) : undefined;
  }, [projectSessions]);
  const projectWorkbench = useProjectSession(
    projectSessions,
    (focusedWorkspace ?? workspace)?.path ?? null,
  );
  const handleToggleGitHistory = useCallback(() => {
    if (gitHistorySidebarOpen) {
      setRightSidebarOpen(false);
      return;
    }
    setRightSidebarSurface("history");
    setRightSidebarOpen(true);
    setSwitcherOpen(false);
  }, [
    gitHistorySidebarOpen,
    setRightSidebarOpen,
    setRightSidebarSurface,
  ]);
  const handleToggleGitChanges = useCallback(() => {
    if (gitChangesSidebarOpen) {
      setRightSidebarOpen(false);
      return;
    }
    setRightSidebarSurface("changes");
    setRightSidebarOpen(true);
    setSwitcherOpen(false);
  }, [
    gitChangesSidebarOpen,
    setRightSidebarOpen,
    setRightSidebarSurface,
  ]);
  const handleOpenGitWorkingFile = useCallback((path: string) => {
    const rootUri = focusedWorkspaceFolder?.uri;
    if (!rootUri) return;
    void handleActiveDataPathChange(qualifyDataResourcePath(rootUri, path));
  }, [focusedWorkspaceFolder?.uri, handleActiveDataPathChange]);
  const handleToggleAgentWorkbench = useCallback(() => {
    if (agentSidebarOpen) {
      setRightSidebarOpen(false);
      return;
    }
    setRightSidebarSurface("chat");
    setRightSidebarOpen(true);
    setSwitcherOpen(false);
  }, [
    agentSidebarOpen,
    setRightSidebarOpen,
    setRightSidebarSurface,
  ]);
  const themeRuntime = (content: ReactNode) => (
    <SurfaceAppearanceProvider value={surfaceAppearance}>
      <div
        className={`desktop-theme-bootstrap-surface ${resolvedTheme === "dark" ? "dark" : ""}`}
        {...surfaceAppearance.rootProps}
      >
        {content}
      </div>
    </SurfaceAppearanceProvider>
  );

  if (restoringWorkspace && !workspace) {
    return themeRuntime(
      <RestoringWorkspaceScreen
        appearance={surfaceAppearance}
      />,
    );
  }

  if (!workspace) {
    return themeRuntime(
      <Homepage
        onChooseWorkspace={openFolder}
        onChooseProjectLocation={chooseProjectLocation}
        onCreateProject={createProject}
        onCloneRepository={cloneRepository}
        onOpenDroppedWorkspace={openDroppedWorkspace}
        onOpenWorkspacePath={openWorkspacePath}
        onRemoveProject={removeWorkspaceFromRecents}
        recentWorkspaces={recentWorkspaceItems}
        initialError={restoreWorkspaceError}
        appearance={surfaceAppearance}
      />,
    );
  }

  const titlebarSidebarSlot = (
    <DesktopTitlebarContext
      activeGitStatus={activeGitStatus}
      branchSwitcherOpen={branchSwitcherOpen}
      branchSwitcherRef={branchSwitcherRef}
      cloudEnabled={cloudEnabled}
      cloudOpen={cloudDialogOpen}
      gitStatusLoading={gitStatusLoading}
      gitOperationLoading={gitOperationLoading}
      localBranches={localBranches}
      remoteBranches={remoteBranches}
      workspace={workspace}
      workspaceFolders={workbenchWorkspace?.folders ?? []}
      multiRootWorkspacesEnabled={multiRootWorkspacesEnabled}
      availableProjects={recentWorkspaceItems.map((item) => item.workspace)}
      workspaceSwitcherOpen={switcherOpen}
      workspaceSwitcherRef={switcherRef}
      onCheckoutBranch={handleCheckoutGitBranch}
      onOpenCloud={openCloudDialog}
      onAddProject={() => void addProject()}
      onAddExistingProject={(folderPath) => void addExistingProject(folderPath)}
      onGoHome={() => void goToHomepage()}
      onCloseWorkspaceSwitcher={closeWorkspaceSwitcher}
      onCloseBranchSwitcher={closeBranchSwitcher}
      onToggleBranchSwitcher={toggleBranchSwitcher}
      onToggleWorkspaceSwitcher={toggleWorkspaceSwitcher}
    />
  );

  const toolsInNavigationToolbar = resolvedAppearance.composition.navigation === "sidebar-top-toolbar";
  const locationBarVisible = resolvedAppearance.composition.locationBar === "workspace-path-v1";
  const locationResource = resolveWorkspaceResource(activeDocumentPath ?? activeExplorerNode?.path ?? null);
  const locationBarPath = resolveDesktopShellLocationPath({
    // The address bar describes the content surface. Keep the active editor
    // authoritative even if explorer selection state is briefly catching up.
    activePath: locationResource?.providerPath ?? null,
    dataViewActive: activeView === "data",
    workspacePath: locationResource?.folder.workspace.path ?? workspace.path,
  });
  const chromeActionProps = {
    desktopUpdateState: desktopUpdates.state,
    titlebarActionsSettings,
    terminalSidebarOpen: agentSidebarOpen,
    terminalToolEnabled: true,
    gitChangesAvailable: Boolean(focusedWorkspace),
    gitChangesOpen: gitChangesSidebarOpen,
    gitChangesStatus: getGitTitlebarStatus(activeGitStatus),
    gitHistoryAvailable: Boolean(focusedWorkspace),
    gitHistoryOpen: gitHistorySidebarOpen,
    onUpdateNow: () => void desktopUpdates.updateNow(),
    onToggleTerminal: handleToggleAgentWorkbench,
    onToggleGitChanges: handleToggleGitChanges,
    onToggleGitHistory: handleToggleGitHistory,
  };
  const titlebarActions = (
    <DesktopTitlebarActions
      {...chromeActionProps}
      visibleGroups={toolsInNavigationToolbar ? ["app-status", "header"] : undefined}
    />
  );
  const feedbackLauncher = (
    <DesktopHelpLauncher
      appearance={surfaceAppearance}
    />
  );
  const projectSwitcherRailEnabled = experimentalSettings.enableProjectSwitcherRail;
  const projectSwitcherRailVisible = projectSwitcherRailEnabled;
  const feedbackInNavigationToolbar = !projectSwitcherRailVisible
    && toolsInNavigationToolbar
    && sidebarNavigationPlacement === "top";
  const navigationToolbarActions = toolsInNavigationToolbar ? (
      <>
        <DesktopTitlebarActions
          {...chromeActionProps}
          placement="toolbar"
          visibleGroups={["right-sidebar"]}
        />
        {feedbackInNavigationToolbar && feedbackLauncher}
      </>
    ) : undefined;

  return (
    <SurfaceAppearanceProvider value={surfaceAppearance}>
      <div
        className={`app-shell cloud-runtime ${resolvedTheme === "dark" ? "dark" : ""}`}
        {...surfaceAppearance.rootProps}
      >
        <DesktopCloudShell
          renderLeadingRail={projectSwitcherRailVisible ? ({ expanded }) => (
            <ProjectSwitcherRail
              activeView={activeView}
              activeWorkspace={workspace}
              expanded={expanded}
              recentWorkspaces={recentWorkspaceItems}
              onCreateNew={() => setProjectEntryDialog("launcher")}
              settingsOpen={settingsDialogOpen}
              onOpenSettings={openSettingsDialog}
              onSelectProject={switchProjectFromRail}
              utilitySlot={(
                <DesktopHelpLauncher
                  appearance={surfaceAppearance}
                />
              )}
            />
          ) : undefined}
          leadingRailWidth={projectSwitcherExpandedWidth}
          leadingRailMinWidth={MIN_PROJECT_SWITCHER_EXPANDED_WIDTH}
          leadingRailMaxWidth={MAX_PROJECT_SWITCHER_EXPANDED_WIDTH}
          leadingRailCollapsed={!preferences.projectSwitcherExpanded}
          leadingRailCollapsedWidth={projectSwitcherCompactWidth}
          leadingRailCollapseThreshold={MIN_PROJECT_SWITCHER_EXPANDED_WIDTH / 2}
          resizableLeadingRail
          onLeadingRailCollapsedChange={setProjectSwitcherCollapsed}
          onLeadingRailWidthChange={preferences.setProjectSwitcherWidth}
          leftSidebarCollapsed={sidebarCollapsed}
          leftSidebarPresent={Boolean(dataPort)}
          leftSidebarWidth={explorerWidth}
          titlebarSidebarSlot={projectSwitcherRailEnabled
            ? undefined
            : titlebarSidebarSlot}
          titlebarActions={titlebarActions}
          navigationToolbarActions={navigationToolbarActions}
          locationBar={locationBarVisible ? (
            <DesktopShellLocationBar
              path={locationBarPath}
              onNavigate={handleLocationBarNavigate}
            />
          ) : undefined}
          rightSidebarOpen={rightSidebarOpen}
          resizableRightSidebar
          rightSidebarWidth={rightSidebarWidth}
          onLeftSidebarExpand={() => setSidebarCollapsed(false)}
          onRightSidebarOpenChange={setRightSidebarOpen}
          onRightSidebarWidthChange={setRightSidebarWidth}
          rightSidebar={(presentation) => (
            <div ref={auxiliarySurfaceRef} className="desktop-right-sidebar-stack">
              <div
                className={`desktop-right-sidebar-surface ${rightSidebarSurface === "chat" ? "is-active" : ""}`}
                aria-hidden={rightSidebarSurface !== "chat"}
              >
                {projectWorkbench && <AuxiliaryWorkbenchPanel
                  key={projectWorkbench.context.generation}
                  store={projectWorkbench}
                  active={presentation.contentVisible && rightSidebarSurface === "chat"}
                  contributions={auxiliaryWorkbenchContributions}
                  onRetryProjectClose={() => {
                    const folder = workbenchWorkspace?.folders.find((entry) => entry.workspace.path === projectWorkbench.context.rootPath);
                    if (folder) void handleRemoveProject(folder);
                  }}
                  renderLauncher={(context) => <AuxiliaryWorkbenchLauncher {...context} store={projectWorkbench} contributions={auxiliaryWorkbenchContributions} hiddenAgentIds={localAgentsSettings.hiddenTerminalAgentIds} />}
                />}
              </div>
              <div
                className={`desktop-right-sidebar-surface ${rightSidebarSurface === "changes" ? "is-active" : ""}`}
                aria-hidden={rightSidebarSurface !== "changes"}
              >
                <GitChangesSidebar
                  repository={{
                    status: activeGitStatus,
                    puppyoneConfig,
                    gitDisplayMode: preferences.gitDisplayMode,
                    gitSidebarLayout: preferences.gitSidebarLayout,
                    fileIconTheme,
                  }}
                  view={{
                    selectedWorkingFile: selectedGitWorkingFile,
                    operationLoading: gitOperationLoading,
                    operationError: null,
                    loading: gitStatusLoading,
                    error: gitStatusError,
                  }}
                  actions={{
                    initialize: handleInitializeGitRepository,
                    selectWorkingFile: selectGitWorkingFile,
                    stagePaths: handleStageGitPaths,
                    stageAll: handleStageAllGitChanges,
                    unstagePaths: handleUnstageGitPaths,
                    discardPaths: handleDiscardGitPaths,
                    discardAll: handleDiscardAllGitChanges,
                    stageAndCommit: handleStageAndCommitGit,
                    commit: handleCommitGit,
                    commitAndPush: handleCommitAndPushGit,
                    continueOperation: handleContinueGitOperation,
                    abortOperation: handleAbortGitOperation,
                    pull: handlePullGit,
                    push: handlePushGit,
                    publish: handlePublishGitBranch,
                    stash: handleStashGitChanges,
                  }}
                  workingFileDiff={gitWorkingFileDiff}
                  workingFileDiffLoading={gitWorkingFileDiffLoading}
                  workingFileDiffError={gitWorkingFileDiffError}
                  onOpenFile={handleOpenGitWorkingFile}
                  cloudBackup={{
                    loading: cloudBackupLoading || pendingCloudBackupSetup,
                    error: null,
                    enabled: cloudEnabled,
                    start: handleStartPuppyoneBackup,
                  }}
                />
              </div>
              <div
                className={`desktop-right-sidebar-surface ${rightSidebarSurface === "history" ? "is-active" : ""}`}
                aria-hidden={rightSidebarSurface !== "history"}
              >
                <GitHistorySidebar
                  status={activeGitStatus}
                  statusLoading={gitStatusLoading}
                  statusError={gitStatusError}
                  selectedCommitId={selectedGitCommitId}
                  commitDetail={gitCommitDetail}
                  commitDetailLoading={gitCommitDetailLoading}
                  commitDetailError={gitCommitDetailError}
                  historyLoading={gitHistoryLoading}
                  fileIconTheme={fileIconTheme}
                  onSelectCommit={selectGitCommit}
                />
              </div>
            </div>
          )}
        >
          <DesktopWorkspaceContent
            activeAiEditRequest={activeAiEditRequest}
            activeDocumentPath={activeDocumentPath}
            activeExplorerPath={activeExplorerPath}
            activeView={activeView}
            cloud={{
              activeSection: activeCloudSection,
              projectContext: projectCloudContext,
              backupLoading: cloudBackupLoading,
              backupPending: pendingCloudBackupSetup,
              publishError: cloudPublishError,
              publishNotice: cloudPublishNotice,
              publishProgress: cloudPublishProgress,
              publishState: cloudPublishState,
              publishStateLoading: cloudPublishStateLoading,
              cloudApiBaseUrl: desktopCloudApiBaseUrl,
              storedCloudSession: cloudSession,
              enabled: cloudEnabled,
              sessionRestoring: cloudSessionRestoring,
              onCloudSessionChange: handleCloudSessionChange,
              onAbandonPuppyoneBackup: handleAbandonPuppyoneBackup,
              onRemoveCloudRemote: handleRemoveCloudRemote,
              onOpenGitSettings: () => {
                openSettingsDialog("git");
              },
              onSelectSection: setActiveCloudSection,
              onStartPuppyoneBackup: handleStartPuppyoneBackup,
            }}
            cloudOpen={cloudDialogOpen}
            dataPort={dataPort}
            editorWorkbench={editorWorkbench}
            externalOpen={externalFileOpen}
            desktopUpdates={desktopUpdates}
            firstProjectStarterEligible={
              experimentalSettings.enableFirstProjectStarter
              && activeWorkspaceEntryKind === "created"
            }
            git={git}
            navigationComposition={resolvedAppearance.composition.navigation}
            onActiveDataNodeChange={handleActiveDataNodeChange}
            onActiveDataPathChange={handleActiveDataPathChange}
            onResourceMove={handleResourceMoved}
            onRemoveProject={handleRemoveProject}
            onCreateEntryMenu={openCreateEntryMenu}
            onDismissCreateEntryMenu={() => setCreateEntryDraft(null)}
            onWorkspaceStarterCreated={handleWorkspaceStarterCreated}
            fileClipboardController={fileClipboardController}
            onFilesVisibilitySettingsChange={handleFilesVisibilitySettingsChange}
            onNavigate={navigateDesktopView}
            onCloseCloud={closeCloudDialog}
            onOpenGitChanges={handleToggleGitChanges}
            onNodeActionMenu={openNodeActionMenu}
            onOpenSettings={openSettingsDialog}
            onPuppyoneConfigChange={handlePuppyoneConfigChange}
            onSelectSettingsSection={setActiveSettingsSection}
            onUnlinkWorkspace={unlinkCurrentWorkspace}
            preferences={preferences}
            puppyoneConfig={puppyoneConfig}
            puppyoneConfigError={puppyoneConfigError}
            puppyoneConfigLoading={puppyoneConfigLoading}
            puppyoneConfigSaving={puppyoneConfigSaving}
            settingsSection={activeSettingsSection}
            settingsOpen={settingsDialogOpen}
            settingsNavigationVisible={!projectSwitcherRailEnabled}
            workspaceNavigationVisible={!projectSwitcherRailEnabled}
            subThemeCatalog={subThemeCatalog}
            workspace={focusedWorkspace ?? workspace}
            workspaceFolders={workbenchWorkspace?.folders ?? []}
            resolveWorkspaceResource={resolveWorkspaceResource}
            workspaceSurfaceError={restoreWorkspaceError ?? documentNavigationError ?? workspaceSurfaceError}
            workspaceKey={workspaceKey}
            workspaceRefreshToken={workspaceRefreshToken}
            workspaceAtomicRefreshToken={workspaceAtomicRefreshToken}
            sidebarCreateMenuOpen={Boolean(
              createEntryDraft
              && !createEntryDraft.selectedKind
              && createEntryDraft.anchor.placement === "auto-end"
            )}
            sidebarUtility={projectSwitcherRailVisible || feedbackInNavigationToolbar
              ? undefined
              : feedbackLauncher}
          />
        </DesktopCloudShell>
        <DesktopOverlayPortal
          appearance={surfaceAppearance}
        >
          <>
          {settingsDialogOpen && (
            <SettingsDialog
              workspace={focusedWorkspace ?? workspace}
              activeSection={activeSettingsSection}
              onSelectSection={setActiveSettingsSection}
              preferences={preferences}
              subThemeCatalog={subThemeCatalog}
              onFilesVisibilitySettingsChange={handleFilesVisibilitySettingsChange}
              git={{
                status: activeGitStatus,
                loading: gitStatusLoading,
                error: gitStatusError,
                refresh: refreshGitStatus,
              }}
              cloud={{
                enabled: cloudEnabled,
                session: cloudSession,
                sessionRestoring: cloudSessionRestoring,
                apiBaseUrl: desktopCloudApiBaseUrl,
                onSessionChange: handleCloudSessionChange,
              }}
              workspaceConfig={{
                value: puppyoneConfig,
                loading: puppyoneConfigLoading,
                saving: puppyoneConfigSaving,
                error: puppyoneConfigError,
                change: handlePuppyoneConfigChange,
                unlink: unlinkCurrentWorkspace,
              }}
              updates={{
                state: desktopUpdates.state,
                check: desktopUpdates.checkForUpdates,
                install: desktopUpdates.updateNow,
              }}
              onClose={closeSettingsDialog}
            />
          )}
          {pendingBranchSwitch && (
            <BranchSwitchConflictDialog
              branchName={pendingBranchSwitch.branchName}
              changeCount={pendingBranchSwitch.changeCount}
              error={pendingBranchSwitch.error}
              loading={gitOperationLoading === "stash" || gitOperationLoading === "commit-switch"}
              operationLoading={gitOperationLoading}
              onCancel={() => setPendingBranchSwitch(null)}
              onStashAndSwitch={() => void handleStashAndCheckoutBranch()}
              onCommitAndSwitch={() => void handleCommitAndCheckoutBranch()}
            />
          )}
          {projectEntryDialog === "launcher" && (
            <ProjectEntryLauncherDialog
              canCreateProject
              canCloneRepository
              onClose={() => setProjectEntryDialog(null)}
              onOpenFolder={() => {
                setProjectEntryDialog(null);
                void openFolder();
              }}
              onCreateProject={() => setProjectEntryDialog("create")}
              onCloneRepository={() => setProjectEntryDialog("clone")}
            />
          )}
          {projectEntryDialog === "create" && (
            <OnboardingProjectEntryDialog
              kind="create"
              onClose={() => setProjectEntryDialog(null)}
              onChooseLocation={chooseProjectLocation}
              onSubmit={(value, locationGrantId) => createProject({
                name: value,
                locationGrantId: locationGrantId ?? "",
              })}
            />
          )}
          {projectEntryDialog === "clone" && (
            <OnboardingProjectEntryDialog
              kind="clone"
              onClose={() => setProjectEntryDialog(null)}
              onSubmit={(value) => cloneRepository({ repositoryUrl: value })}
            />
          )}
          {gitOperationError && !pendingBranchSwitch && (
            <GitOperationErrorDialog
              error={gitOperationError}
              onClose={dismissGitOperationError}
              onPull={() => {
                dismissGitOperationError();
                void handlePullGit();
              }}
            />
          )}
          {createEntryDraft && (
            createEntryDraft.selectedKind ? (
              <DesktopCreateEntryDialog
                draft={createEntryDraft}
                fileIconTheme={fileIconTheme}
                onChange={setCreateEntryDraft}
                onCancel={() => setCreateEntryDraft(null)}
                onCreate={createEntryFromMenu}
              />
            ) : (
              <DesktopCreateEntryMenu
                draft={createEntryDraft}
                mainEntries={createNewItems.main}
                submenuItemKinds={createNewItems.submenu}
                fileIconTheme={fileIconTheme}
                onCancel={() => setCreateEntryDraft(null)}
                onSelectKind={selectCreateEntryKind}
              />
            )
          )}
          {nodeActionMenu && (
            <DesktopNodeActionMenu
              draft={nodeActionMenu}
              experimentalSettings={preferences.experimentalSettings}
              showRevealInFinder
              showOpenInDefaultApp
              canPaste={nodeActionMenu.node.type === "folder" && fileClipboardController.canPasteInto(nodeActionMenu.node.path)}
              canCopy={fileClipboardController.canCopy}
              canCut={fileClipboardController.canCut}
              canDuplicate={fileClipboardController.canDuplicate}
              onChange={setNodeActionMenu}
              onCancel={() => setNodeActionMenu(null)}
              onCopy={() => {
                fileClipboardController.copyNodes(nodeActionMenu.nodes);
                setNodeActionMenu(null);
              }}
              onCut={() => {
                fileClipboardController.cutNodes(nodeActionMenu.nodes);
                setNodeActionMenu(null);
              }}
              onPaste={() => {
                setNodeActionMenu(null);
                void fileClipboardController.pasteNodes(nodeActionMenu.node.path);
              }}
              onDuplicate={() => {
                setNodeActionMenu(null);
                void fileClipboardController.duplicateNodes(nodeActionMenu.nodes);
              }}
              onCreateInside={() => openCreateEntryMenu(nodeActionMenu.node.path, nodeActionMenu.anchor)}
              onRename={renameNodeFromMenu}
              onDelete={deleteNodeFromMenu}
              onOpenInDefaultApp={openNodeInDefaultAppFromMenu}
              onRevealInFinder={revealNodeInFinderFromMenu}
            />
          )}
          </>
        </DesktopOverlayPortal>
      </div>
    </SurfaceAppearanceProvider>
  );
}

function isPreviewableAgentImagePath(path: string) {
  return /\.(?:png|jpe?g|gif|webp|avif)$/i.test(path);
}

function hasSameActiveDataNodeIdentity(left: DataNode | null, right: DataNode | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.id === right.id
    && left.path === right.path
    && left.name === right.name
    && left.type === right.type
    && left.mimeType === right.mimeType;
}
