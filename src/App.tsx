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
  closeAllDocumentWorkingCopies,
  closeDocumentWorkingCopy,
  closeDocumentWorkingCopiesUnderResource,
  createWorkspaceResourceUri,
  flushActiveDocumentSessions,
  isDataResourceUri,
  isDocumentDataNode,
  qualifyDataResourcePath,
  type DataNode,
  type WorkspaceContentChange,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { DesktopCloudShell, type DesktopView } from "./components/DesktopCloudShell";
import { isSettingsSectionAvailable, type SettingsSection } from "./features/settings";
import { CLOUD_HUB_ENTRY_SECTION, type CloudWorkspaceSection } from "./features/cloud";
import {
  MinimalOnboarding,
} from "./components/MinimalOnboarding";
import { OnboardingProjectEntryDialog } from "./components/OnboardingProjectEntryDialog";
import { AssetLibraryHome } from "./components/AssetLibraryHome";
import {
  closeAgentChatWorkbenchItem,
  discardPreparedAgentChatWorkbenchItem,
  isDesktopAgentChatEnabled,
  loadAgentChatHistoryBrowser,
  loadAgentChatWorkbenchItem,
  prepareAgentChatWorkbenchItem,
  resolveAgentWorkspaceProviderPath,
} from "./features/desktop-agent/lazy";
import {
  isDesktopTerminalEnabled,
  RightTerminalPanel,
} from "./features/desktop-terminal";
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
import { createRepositoryRefreshReason } from "./features/source-control/repositoryRefreshPolicy";
import { shouldBlockWorkspaceCloudResolution } from "./features/cloud/workspace/workspaceCloudResolutionKey";
import { useCloudInitialization } from "./features/cloud/initialization/useCloudInitialization";
import {
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
  resolveProjectSwitcherRailWidth,
} from "./features/app-shell/ProjectSwitcherRail";
import { ProjectEntryLauncherDialog } from "./features/app-shell/ProjectEntryLauncherDialog";

const AgentChatWorkbenchItem = lazy(loadAgentChatWorkbenchItem);
const AgentChatHistoryBrowser = lazy(loadAgentChatHistoryBrowser);
const EMPTY_WORKSPACE_FOLDERS: readonly WorkspaceFolder[] = Object.freeze([]);
type ProjectDesktopView = Exclude<DesktopView, "settings">;

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
  const { setRightSidebarOpen } = preferences;
  const fontCatalog = useTypographyCatalog();
  const typography = useTypographyRuntime(
    preferences.typographyPreferences,
    fontCatalog,
    locale,
  );
  const projectSwitcherCompactWidth = resolveProjectSwitcherRailWidth();
  const projectSwitcherExpandedWidth = resolveProjectSwitcherRailWidth(
    true,
    preferences.projectSwitcherWidth,
  );
  const setProjectSwitcherCollapsed = useCallback(
    (collapsed: boolean) => preferences.setProjectSwitcherExpanded(!collapsed),
    [preferences.setProjectSwitcherExpanded],
  );
  const cloudAvailable = useFeatureFlag("cloudWorkspace");
  // The build flag only marks availability; PuppyOne Cloud stays hidden until
  // the user opts into the experiment in Settings.
  const cloudEnabled = cloudAvailable && preferences.experimentalSettings.enableCloudWorkspace;
  const assetLibraryHomeAvailable = useFeatureFlag("assetLibraryHome");
  const agentChatAvailable = useFeatureFlag("desktopAgentChat");
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
      ? createExplorerDataPort(workbenchDataService.dataPort, filesVisibilitySettings)
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
  );
  const activeDocumentPath = editorWorkbench.activePath;
  const handleResourceMoved = useCallback(async (previousPath: string, nextPath: string) => {
    if (documentStorageIdentity) {
      await closeDocumentWorkingCopiesUnderResource(documentStorageIdentity, previousPath);
    }
    editorWorkbench.rebaseResource(previousPath, nextPath);
  }, [documentStorageIdentity, editorWorkbench]);
  const handleResourceDeleted = useCallback(async (path: string) => {
    if (documentStorageIdentity) {
      await closeDocumentWorkingCopiesUnderResource(documentStorageIdentity, path);
    }
    editorWorkbench.closeUnderResource(path);
  }, [documentStorageIdentity, editorWorkbench]);
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
    try {
      await closeAllDocumentWorkingCopies("workspace-switch");
      setDocumentNavigationError(null);
      return true;
    } catch (error) {
      setDocumentNavigationError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, []);
  const switcherRef = useRef<HTMLDivElement>(null);
  const desktopTerminalEnabled = isDesktopTerminalEnabled({ terminalToolEnabled });
  const desktopAgentChatEnabled = isDesktopAgentChatEnabled({
    available: agentChatAvailable,
    optedIn: experimentalSettings.enableAgentChat,
  });
  const desktopRightSidebarEnabled = desktopTerminalEnabled || desktopAgentChatEnabled;

  useEffect(() => {
    if (!desktopRightSidebarEnabled) {
      if (rightSidebarOpen) setRightSidebarOpen(false);
      return;
    }
    // Legacy surface selection is retained only as a one-way migration key.
    // The unified Workbench owns Item selection from this point onward.
    if (rightSidebarSurface !== "terminal") setRightSidebarSurface("terminal");
  }, [
    desktopAgentChatEnabled,
    desktopRightSidebarEnabled,
    desktopTerminalEnabled,
    rightSidebarOpen,
    rightSidebarSurface,
    setRightSidebarOpen,
    setRightSidebarSurface,
  ]);
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
    gitViewActive: activeView === "git",
    onWorkspaceContentChanged: refreshWorkspaceContentFromGit,
    onEnterGitView: () => setActiveView("git"),
  });
  const invalidateGitStatus = git.invalidateGitStatus;
  const handleWorkspaceActivity = useCallback((folder: WorkspaceFolder) => {
    if (folder.workspace.path === focusedWorkspace?.path) {
      invalidateGitStatus("working-tree");
    }
  }, [focusedWorkspace?.path, invalidateGitStatus]);
  useWorkbenchWorkspaceContentWatch({
    folders: workbenchWorkspace?.folders ?? EMPTY_WORKSPACE_FOLDERS,
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
    gitIncomingCount,
    gitMainPanel,
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
    handleCheckoutGitBranch,
    handleCommitAndCheckoutBranch,
    handleCommitAndPushGit,
    handleCommitGit,
    handleDiscardAllGitChanges,
    handleDiscardGitPaths,
    handleInitializeGitRepository,
    handlePublishGitBranch,
    handlePullGit,
    handlePushGit,
    handleStageAllGitChanges,
    handleStageAndCommitGit,
    handleStageGitPaths,
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
    if (
      (!cloudEnabled && activeView === "cloud")
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
    const routesToData = (
      (view === "plugins" && !experimentalSettings.enableViewerPlugins)
      || (view === "cloud" && !cloudEnabled)
    );

    const commitNavigation = async () => {
      if (activeView === "data" && view !== "data" && !routesToData) {
        try {
          await flushActiveDocumentSessions("document-close");
        } catch (error) {
          if (requestId === desktopViewNavigationRequestRef.current) {
            setDocumentNavigationError(error instanceof Error ? error.message : String(error));
          }
          return;
        }
      }
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
        setActiveView("cloud");
        setActiveCloudSection(CLOUD_HUB_ENTRY_SECTION);
        setSidebarCollapsed(false);
        setSwitcherOpen(false);
        return;
      }

      setActiveView(view);
      setSidebarCollapsed(false);
      setSwitcherOpen(false);
    };

    void commitNavigation();
  }, [
    activeView,
    cloudEnabled,
    experimentalSettings.enableViewerPlugins,
    setSidebarCollapsed,
  ]);

  useEffect(() => {
    if (activeView !== "settings") lastProjectViewRef.current = activeView;
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
      if (activeView !== "data" || editorWorkbench.state.editors.length === 0) return;
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
      if (activeView === "settings") {
        setActiveSettingsSection("account");
        return;
      }
      setActiveView("cloud");
      setActiveCloudSection("initialize");
      setSidebarCollapsed(false);
      setSwitcherOpen(false);
    }
  }, [activeView, cloudEnabled, setSidebarCollapsed, updateCloudSession]);

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
    if (!await drainWorkspaceNavigation()) return;
    await forgetActiveWorkspace();
    setSwitcherOpen(false);
    setBranchSwitcherOpen(false);
    setRightSidebarOpen(false);
    resetDataNodeActions();
  }, [
    drainWorkspaceNavigation,
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
  const agentChatContribution = useMemo<AuxiliaryWorkbenchContribution | null>(() => {
    if (!desktopAgentChatEnabled) return null;
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
        commit: ({ item }) => closeAgentChatWorkbenchItem(item.rootId, item.id),
      }),
    });
  }, [
    agentPreferredModel,
    agentPreferredRoute,
    agentPreferredRuntime,
    agentChatRuntimeVisibility,
    desktopAgentChatEnabled,
    handleAgentOpenFile,
    localAgentsSettings,
    resolveAgentWorkspaceReference,
    setAgentPreferredModel,
    setAgentPreferredRoute,
    setAgentPreferredRuntime,
    setLocalAgentsSettings,
    t,
  ]);
  const auxiliaryWorkbenchContributions = useMemo(
    () => agentChatContribution ? [agentChatContribution] : [],
    [agentChatContribution],
  );

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
    terminalSidebarOpen: rightSidebarOpen && desktopRightSidebarEnabled,
    terminalToolEnabled: desktopRightSidebarEnabled,
    onUpdateNow: () => void desktopUpdates.updateNow(),
    onToggleTerminal: () => {
      setRightSidebarOpen(!rightSidebarOpen);
      setSwitcherOpen(false);
    },
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
  const settingsWorkspaceActive = projectSwitcherRailEnabled && activeView === "settings";
  const projectSwitcherRailVisible = projectSwitcherRailEnabled;
  const feedbackInNavigationToolbar = !projectSwitcherRailVisible
    && toolsInNavigationToolbar
    && sidebarNavigationPlacement === "top";
  const navigationToolbarActions = toolsInNavigationToolbar
    && (desktopRightSidebarEnabled || feedbackInNavigationToolbar) ? (
      <>
        {desktopRightSidebarEnabled && (
          <DesktopTitlebarActions
            {...chromeActionProps}
            placement="toolbar"
            visibleGroups={["right-sidebar"]}
          />
        )}
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
          leadingRail={projectSwitcherRailVisible ? (
            <ProjectSwitcherRail
              activeView={activeView}
              activeWorkspace={workspace}
              expanded={preferences.projectSwitcherExpanded}
              recentWorkspaces={recentWorkspaceItems}
              onCreateNew={() => setProjectEntryDialog("launcher")}
              onOpenSettings={() => navigateDesktopView("settings")}
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
          leadingRailCollapsedCssWidth="var(--desktop-chrome-height)"
          leadingRailCollapseThreshold={MIN_PROJECT_SWITCHER_EXPANDED_WIDTH / 2}
          resizableLeadingRail
          onLeadingRailCollapsedChange={setProjectSwitcherCollapsed}
          onLeadingRailWidthChange={preferences.setProjectSwitcherWidth}
          leftSidebarCollapsed={settingsWorkspaceActive ? false : sidebarCollapsed}
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
          rightSidebarOpen={!settingsWorkspaceActive && rightSidebarOpen && desktopRightSidebarEnabled}
          resizableRightSidebar
          rightSidebarWidth={rightSidebarWidth}
          onLeftSidebarExpand={() => setSidebarCollapsed(false)}
          onRightSidebarOpenChange={setRightSidebarOpen}
          onRightSidebarWidthChange={setRightSidebarWidth}
          rightSidebar={desktopRightSidebarEnabled ? (
            <div className="desktop-right-sidebar-stack">
              <div className="desktop-right-sidebar-surface is-active">
                <RightTerminalPanel
                  workspace={focusedWorkspace ?? workspace}
                  active={rightSidebarOpen}
                  terminalEnabled={desktopTerminalEnabled}
                  hiddenAgentIds={localAgentsSettings.hiddenTerminalAgentIds}
                  contributions={auxiliaryWorkbenchContributions}
                />
              </div>
            </div>
          ) : undefined}
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
              setActiveSettingsSection("git");
              navigateDesktopView("settings");
            },
            onSelectSection: setActiveCloudSection,
            onStartPuppyoneBackup: handleStartPuppyoneBackup,
          }}
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
          onNodeActionMenu={openNodeActionMenu}
          onOpenSettings={() => navigateDesktopView("settings")}
          onPuppyoneConfigChange={handlePuppyoneConfigChange}
          onSelectSettingsSection={setActiveSettingsSection}
          onUnlinkWorkspace={unlinkCurrentWorkspace}
          preferences={preferences}
          puppyoneConfig={puppyoneConfig}
          puppyoneConfigError={puppyoneConfigError}
          puppyoneConfigLoading={puppyoneConfigLoading}
          puppyoneConfigSaving={puppyoneConfigSaving}
          settingsSection={activeSettingsSection}
          settingsNavigationVisible={!projectSwitcherRailEnabled}
          workspaceNavigationVisible={!settingsWorkspaceActive}
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
