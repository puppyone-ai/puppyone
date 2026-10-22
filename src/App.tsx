import { useWorkspaceEntryBootstrap } from "./features/app-shell/useWorkspaceEntryBootstrap";
import { useHeaderCoachmarks } from "./features/app-shell/headerCoachmarks";
import { useGitPresentation } from "./features/app-shell/useGitPresentation";
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
  type Workspace,
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
import { useAccountCloudWorkspace } from "./features/cloud/workbench/useAccountCloudWorkspace";
import { CloudWorkspaceHeaderTools } from "./features/cloud/workbench/CloudWorkspaceHeaderTools";
import { captureCloudWorkspaceShareResource } from "./features/cloud/share/cloudWorkspaceShareResource";
import { useCloudAgentWorkspace } from "./features/cloud/agent/useCloudAgentWorkspace";
import { CloudWorkspaceSidebar } from "./features/cloud/workbench/CloudWorkspaceSidebar";
import { useCloudWorkspaceSidebar } from "./features/cloud/workbench/useCloudWorkspaceSidebar";
import { useRepositoryCloudWorkspaceSwitch } from "./features/cloud/workbench/useRepositoryCloudWorkspaceSwitch";
import { CloudWorkspaceSwitchDialog } from "./features/cloud/workbench/CloudWorkspaceSwitchDialog";
import { RepositoryCloudSwitchGate } from "./features/cloud/workbench/RepositoryCloudSwitchGate";
import { MissingCloudProjectRecovery } from "./features/cloud/workbench/MissingCloudProjectRecovery";
import { CloudInitializationRoute } from "./features/cloud/initialization/CloudInitializationRoute";
import { useHomepageCloudProjects } from "./features/cloud/workbench/useHomepageCloudProjects";
import { HomepageCloudStatus } from "./features/cloud/workbench/HomepageCloudStatus";
import {
  AccountCloudWorkspaceSurface,
  useAccountCloudWorkspacePresentation,
} from "./features/cloud/workbench/AccountCloudWorkspaceSurface";
import { getCloudAuthSession, resolveCloudAuthState } from "./features/cloud/auth";
import { FirstRunSignInScreen } from "./features/cloud/auth/FirstRunSignInScreen";
import { useFirstRunSignIn } from "./features/cloud/auth/useFirstRunSignIn";
import { useNativeCloudWorkbench } from "./features/cloud/workbench/useNativeCloudWorkbench";
import {
  MinimalOnboarding,
} from "./components/MinimalOnboarding";
import { AssetLibraryHome } from "./components/AssetLibraryHome";
import {
  closeAgentChatWorkbenchItem,
  createAgentChatCloseAdapter,
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
  openCloudProjectInNewWindow,
  showHomepage,
} from "./lib/localFiles";
import { openWorkspaceTarget } from "./lib/workspaceOpening";
import {
  getDesktopCloudApiBaseUrl,
  type DesktopCloudSession,
} from "./lib/cloudApi";
import { resolveVisibleCreateNewMenuItems } from "./preferences";
import type { GitRemoteSummary, PuppyoneWorkspaceConfig } from "./types/electron";
import {
  mergePuppyoneWorkspaceConfig,
} from "./features/app-shell/preferences";
import { DesktopProjectLocationControls, type DesktopProjectLocation } from "./features/app-shell/DesktopProjectLocationSwitcher";
import { DesktopTitlebarContext } from "./features/app-shell/DesktopTitlebarContext";
import { DesktopWorkspaceContent } from "./features/app-shell/DesktopWorkspaceContent";
import { DesktopWorkspaceLocationSurface } from "./features/app-shell/DesktopWorkspaceLocationSurface";
import { CloudWorkspacePreparation } from "./features/cloud/workbench/CloudWorkspacePreparation";
import { DesktopTitlebarActions } from "./features/app-shell/DesktopTitlebarActions";
import {
  DesktopShellLocationBar,
  resolveDesktopShellLocationPath,
  resolveDesktopShellWorkspaceEntryPath,
} from "./features/app-shell/DesktopShellLocationBar";
import { DesktopOverlayPortal } from "./features/app-shell/DesktopOverlayPortal";
import { DesktopHelpLauncher } from "./features/app-shell/DesktopHelpLauncher";
import { RestoringWorkspaceScreen } from "./features/app-shell/RestoringWorkspaceScreen";
import { useDesktopPreference, useDesktopAppearance, useDesktopPreferenceEffects } from "./features/settings";
import { isAssetLibraryHomeEnabled } from "./features/app-shell/homeFeatureGate";
import { useWorkspaceLifecycle } from "./features/app-shell/useWorkspaceLifecycle";
import { usePuppyoneConfig } from "./features/app-shell/usePuppyoneConfig";
import { useExternalFileOpen } from "./features/external-apps/useExternalFileOpen";
import { useDesktopCloudSession } from "./features/cloud/hooks/useDesktopCloudSession";
import {
  getResolvedCloudProjectId,
  getProjectCloudLocationState,
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
import { EditorHeaderTabs } from "./features/editor-workbench/header/EditorHeaderTabs";
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
  CloudShareProvider,
  ProjectReachDialog,
  ReadersList,
  SHARE_TARGETS,
  ShareWizardDialog,
  resolveCloudShareStatus,
  shareTargetLabelKey,
  useProjectShareActivity,
  useProjectShareRevoke,
  type CloudShareActions,
  type ReachPreviewData,
  type ShareTargetId,
  type ShareWizardFolderEntry,
} from "./features/cloud/share";
import { useProjectReachExperience } from "./features/project-reach";
import {
  ProjectReachPeople,
  reachHeaderChangesStatus,
  resolveProjectReachState,
  type ProjectReachControlProps,
} from "./features/app-shell/project-reach";
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
  AuxiliaryWorkbenchContribution,
  AuxiliaryWorkbenchHistoryBrowserContext,
} from "./features/app-shell/auxiliary-workbench/types";
import {
  AGENT_CHAT_CREATION_RECIPES,
  resolveAgentChatRuntimeVisibility,
} from "./features/app-shell/auxiliary-workbench/agentChatCreationRecipes";
import { useSubThemeCatalog, useSubThemeNativeMenu } from "./features/themes/useSubThemeCatalog";
import {
  MAX_PROJECT_SWITCHER_EXPANDED_WIDTH,
  MIN_PROJECT_SWITCHER_EXPANDED_WIDTH,
  ProjectSwitcherRail,
  resolveProjectSwitcherCompactWidth,
  resolveProjectSwitcherRailWidth,
} from "./features/app-shell/ProjectSwitcherRail";
import {
  ProjectEntryFlow,
  useProjectEntryFlow,
} from "./features/app-shell/ProjectEntryFlow";

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
  useDesktopPreferenceEffects(subThemeCatalog.snapshot);
  const { resolvedAppearance, resolvedTheme, darkThemePreset, lightThemePreset } = useDesktopAppearance();
  const aiEditAssistEnabled = useDesktopPreference(s => s.aiEditAssistEnabled);
  const createNewMenuSettings = useDesktopPreference(s => s.createNewMenuSettings);
  const explorerWidth = useDesktopPreference(s => s.explorerWidth);
  const enableMultiRootWorkspaces = useDesktopPreference(s => s.experimentalSettings.enableMultiRootWorkspaces);
  const enableCloudWorkspace = useDesktopPreference(s => s.experimentalSettings.enableCloudWorkspace);
  const enableShareOnboarding = useDesktopPreference(s => s.experimentalSettings.enableShareOnboarding);
  const enableAssetLibraryHome = useDesktopPreference(s => s.experimentalSettings.enableAssetLibraryHome);
  const enableViewerPlugins = useDesktopPreference(s => s.experimentalSettings.enableViewerPlugins);
  const enableOtherAppImports = useDesktopPreference(s => s.experimentalSettings.enableOtherAppImports);
  const enableAlwaysShowOnboardingCoachmarks = useDesktopPreference(s => s.experimentalSettings.enableAlwaysShowOnboardingCoachmarks);
  const centerProjectInHeader = useDesktopPreference(s => s.experimentalSettings.enableCenteredProjectInHeader);
  const enableEditorTabsInHeader = useDesktopPreference(s => s.experimentalSettings.enableEditorTabsInHeader);
  const enableProjectSwitcherRail = useDesktopPreference(s => s.experimentalSettings.enableProjectSwitcherRail);
  const enableWorkbenchTabsInHeader = useDesktopPreference(s => s.experimentalSettings.enableWorkbenchTabsInHeader);
  const enablePuppyFlowFiles = useDesktopPreference(s => s.experimentalSettings.enablePuppyFlowFiles);
  const filesVisibilitySettings = useDesktopPreference(s => s.filesVisibilitySettings);
  const interfaceStyle = useDesktopPreference(s => s.interfaceStyle);
  const rightSidebarOpen = useDesktopPreference(s => s.rightSidebarOpen);
  const terminalToolEnabled = useDesktopPreference(s => s.rightSidebarToolsSettings.enabled.terminal);
  const rightSidebarWidth = useDesktopPreference(s => s.rightSidebarWidth);
  const rightSidebarSurface = useDesktopPreference(s => s.rightSidebarSurface);
  const hiddenTerminalAgentIds = useDesktopPreference(s => s.localAgentsSettings.hiddenTerminalAgentIds);
  const sidebarCollapsed = useDesktopPreference(s => s.sidebarCollapsed);
  const diffMarkers = useDesktopPreference(s => s.diffMarkers);
  const markdownPresentation = useDesktopPreference(s => s.markdownPresentation);
  const pointerCursors = useDesktopPreference(s => s.pointerCursors);
  const setRightSidebarWidth = useDesktopPreference(s => s.setRightSidebarWidth);
  const setRightSidebarSurface = useDesktopPreference(s => s.setRightSidebarSurface);
  const setSidebarCollapsed = useDesktopPreference(s => s.setSidebarCollapsed);
  const setRightSidebarOpen = useDesktopPreference(s => s.setRightSidebarOpen);
  const setProjectSwitcherExpanded = useDesktopPreference(s => s.setProjectSwitcherExpanded);
  const typographyPreferences = useDesktopPreference(s => s.typographyPreferences);
  const projectSwitcherWidth = useDesktopPreference(s => s.projectSwitcherWidth);
  const setSubThemeId = useDesktopPreference(s => s.setSubThemeId);
  const loadingAnimationPreset = useDesktopPreference(s => s.loadingAnimationPreset);
  const projectSwitcherExpanded = useDesktopPreference(s => s.projectSwitcherExpanded);
  const setProjectSwitcherWidth = useDesktopPreference(s => s.setProjectSwitcherWidth);
  const multiRootWorkspacesEnabled = enableMultiRootWorkspaces;
  useSubThemeNativeMenu({
    snapshot: subThemeCatalog.snapshot,
    rootThemeId: interfaceStyle,
    colorMode: resolvedAppearance.effectiveColorMode,
    selectedSubThemeId: resolvedAppearance.subThemeId,
    onSubThemeChange: setSubThemeId,
  });
  const fontCatalog = useTypographyCatalog();
  const typography = useTypographyRuntime(
    typographyPreferences,
    fontCatalog,
    locale,
  );
  const projectSwitcherCompactWidth = resolveProjectSwitcherCompactWidth(
    TYPOGRAPHY_SCALE_METRICS[typography.scale].geometry.controlSize,
  );
  const projectSwitcherExpandedWidth = resolveProjectSwitcherRailWidth(
    true,
    projectSwitcherWidth,
  );
  const setProjectSwitcherCollapsed = useCallback(
    (collapsed: boolean) => setProjectSwitcherExpanded(!collapsed),
    [setProjectSwitcherExpanded],
  );
  const cloudAvailable = useFeatureFlag("cloudWorkspace");
  // The build flag only marks availability; PuppyOne Cloud stays hidden until
  // the user opts into the experiment in Settings.
  const cloudEnabled = cloudAvailable && enableCloudWorkspace;
  // Share onboarding rides on top of Cloud: the Header cloud icon becomes the
  // project's Local/Cloud indicator and the only entry into sharing.
  const shareOnboardingEnabled = cloudEnabled && enableShareOnboarding;
  // The share entry's fork: one screen for inviting a person or connecting an
  // agent, or the existing step wizard. Declared in the project-reach contract.
  const projectReachEnabled = useProjectReachExperience();
  const assetLibraryHomeAvailable = useFeatureFlag("assetLibraryHome");
  const {
    cloudSession,
    cloudAuthStatus,
    cloudSessionRestoring,
    handleCloudSessionChange: updateCloudSession,
  } = useDesktopCloudSession();
  const desktopCloudApiBaseUrl = useMemo(() => getDesktopCloudApiBaseUrl(), []);
  const activeCloudSession = useMemo(() => getCloudAuthSession(resolveCloudAuthState({
    cloudSession: cloudAuthStatus === "authenticated" || cloudAuthStatus === "refreshing"
      || cloudAuthStatus === "offline-authenticated" ? cloudSession : null,
    sessionRestoring: cloudSessionRestoring,
    environment: { apiBaseUrl: desktopCloudApiBaseUrl, source: "default", cloudRemote: null },
  })), [cloudAuthStatus, cloudSession, cloudSessionRestoring, desktopCloudApiBaseUrl]);
  const accountCloud = useAccountCloudWorkspace({ enabled: cloudEnabled, session: activeCloudSession, apiBaseUrl: desktopCloudApiBaseUrl });
  const cloudWorkspaceActive = accountCloud.active;
  const { useLocal: returnToLocalWorkspace } = accountCloud;
  const [activeCloudSection, setActiveCloudSection] = useState<CloudWorkspaceSection>("initialize");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const projectEntryFlow = useProjectEntryFlow();
  const {
    addProject,
    addExistingProject,
    workspaceEntryIntent,
    consumeWorkspaceEntryIntent,
    chooseProjectLocation,
    clearWorkspace,
    importSource,
    connectImportSource,
    listImportResources,
    cancelImportSource,
    onImportSourceProgress,
    createProject,
    defaultProjectLocation,
    forgetActiveWorkspace,
    handleWorkspaceOpenResult,
    openDroppedWorkspace,
    openFolder,
    openWorkspacePath,
    recentWorkspaceItems,
    removeWorkspaceFromRecents,
    renameProject,
    removeProject,
    refreshRecentWorkspaceList,
    restoreWorkspaceError,
    restoringWorkspace,
    initialCloudProject,
    setRestoreWorkspaceError,
    setWorkspaces,
    workbenchWorkspace,
    workspace,
    workspaces,
  } = useWorkspaceLifecycle({
    multiRootWorkspacesEnabled,
    onWorkspaceActivated: useCallback(() => {
      returnToLocalWorkspace();
      setSwitcherOpen(false);
    }, [returnToLocalWorkspace]),
    onWorkspaceCleared: useCallback(() => {
      setActiveView("data");
      setSwitcherOpen(false);
    }, []),
    onWorkspaceOpenSettled: useCallback(() => {
      setSwitcherOpen(false);
    }, []),
  });
  const projectCatalog = useHomepageCloudProjects({
    visible: !restoringWorkspace,
    enabled: cloudEnabled, session: activeCloudSession, apiBaseUrl: desktopCloudApiBaseUrl,
    local: recentWorkspaceItems,
    activeLocalPath: !cloudWorkspaceActive ? workspace?.path : undefined,
    activeCloudProjectId: cloudWorkspaceActive && accountCloud.context.status === "resolved"
      ? accountCloud.context.projectId : undefined,
  });
  const initialCloudProjectOpened = useRef(false);
  useEffect(() => {
    if (initialCloudProjectOpened.current || restoringWorkspace || !initialCloudProject
      || !cloudEnabled || !activeCloudSession || activeCloudSession.user_id !== initialCloudProject.userId) return;
    initialCloudProjectOpened.current = true;
    void accountCloud.openTarget({ kind: "project_root", project_id: initialCloudProject.projectId });
  }, [accountCloud.openTarget, activeCloudSession, cloudEnabled, initialCloudProject, restoringWorkspace]);
  const surfaceAppearance = useMemo(() => resolveSurfaceAppearance({
    appearance: resolvedAppearance,
    typography,
    markdownPresentation,
    loadingAnimationPreset,
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
    loadingAnimationPreset,
    resolvedAppearance,
    typography,
  ]);
  const createNewItems = useMemo(
    () => resolveVisibleCreateNewMenuItems(createNewMenuSettings, { enablePuppyFlowFiles }),
    [createNewMenuSettings, enablePuppyFlowFiles],
  );
  const agentChatRuntimeVisibility = useMemo(() => {
    return resolveAgentChatRuntimeVisibility(AGENT_CHAT_CREATION_RECIPES, {
      hiddenLocalAgentIds: hiddenTerminalAgentIds,
    });
  }, [hiddenTerminalAgentIds]);
  const assetLibraryHomeEnabled = isAssetLibraryHomeEnabled({
    available: assetLibraryHomeAvailable,
    optedIn: enableAssetLibraryHome,
  });
  const Homepage = assetLibraryHomeEnabled ? AssetLibraryHome : MinimalOnboarding;
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>("general");
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [pluginsDialogOpen, setPluginsDialogOpen] = useState(false);
  const [cloudDialogOpen, setCloudDialogOpen] = useState(false);
  const [titlebarTabHost, setTitlebarTabHost] = useState<HTMLDivElement | null>(null);
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
  const auxiliarySurfaceRef = useRef<HTMLDivElement>(null);
  const blurAuxiliarySurfaceFocus = useCallback(() => {
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement
      && auxiliarySurfaceRef.current?.contains(activeElement)
    ) {
      activeElement.blur();
    }
  }, []);
  const closeProjectMenu = useCallback(() => setSwitcherOpen(false), []);
  const gitPresentation = useGitPresentation({
    workspaceScope: focusedWorkspace?.path ?? null,
    sidebarOpen: rightSidebarOpen,
    sidebarSurface: rightSidebarSurface,
    setSidebarOpen: setRightSidebarOpen,
    setSidebarSurface: setRightSidebarSurface,
    onReveal: closeProjectMenu,
    beforeOpenSidebar: blurAuxiliarySurfaceFocus,
  });
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
    gitChangesActive: gitPresentation.changesActive,
    gitHistoryActive: gitPresentation.historyActive,
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
    pendingBranchSwitch,
    selectedGitCommitId,
    selectedGitWorkingFile,
    applyGitStatus,
    captureGitRepositoryContext,
    clearGitSelection,
    dismissGitOperationError,
    handleAbortGitOperation,
    handleCommitAndCheckoutBranch,
    handleCommitAndPushGit,
    handleCommitGit,
    handleContinueGitOperation,
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
  const openSettingsDialog = useCallback((section?: SettingsSection) => {
    if (section) setActiveSettingsSection(section);
    setSettingsDialogOpen(true);
    setPluginsDialogOpen(false);
    setCloudDialogOpen(false);
    setSwitcherOpen(false);
    setBranchSwitcherOpen(false);
  }, [setBranchSwitcherOpen]);
  const closeSettingsDialog = useCallback(() => setSettingsDialogOpen(false), []);
  const openPluginsDialog = useCallback(() => {
    if (!enableViewerPlugins) return;
    setActiveView("data");
    setPluginsDialogOpen(true);
    setSettingsDialogOpen(false);
    setCloudDialogOpen(false);
    setSwitcherOpen(false);
    setBranchSwitcherOpen(false);
  }, [enableViewerPlugins, setBranchSwitcherOpen]);
  const closePluginsDialog = useCallback(() => setPluginsDialogOpen(false), []);
  const openCloudDialogAt = useCallback((section: CloudWorkspaceSection) => {
    if (!cloudEnabled) return;
    setActiveView("data");
    setActiveCloudSection(section);
    setCloudDialogOpen(true);
    setSettingsDialogOpen(false);
    setPluginsDialogOpen(false);
    setSidebarCollapsed(false);
    setSwitcherOpen(false);
    setBranchSwitcherOpen(false);
  }, [cloudEnabled, setBranchSwitcherOpen, setSidebarCollapsed]);
  const openCloudDialog = useCallback(
    () => openCloudDialogAt(CLOUD_HUB_ENTRY_SECTION),
    [openCloudDialogAt],
  );
  const openCloudShare = useCallback(
    () => openCloudDialogAt("share"),
    [openCloudDialogAt],
  );
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
    copyNodePathFromMenu,
    revealNodeInFinderFromMenu,
    openNodeInDefaultAppFromMenu,
  } = useDataNodeActions({
    dataPort,
    getPathForCopy: workbenchDataService?.getPathForCopy,
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
    if (!enableViewerPlugins) setPluginsDialogOpen(false);
  }, [enableViewerPlugins]);

  useEffect(() => {
    if (!isSettingsSectionAvailable(activeSettingsSection, {
      cloudEnabled,
      otherAppImportsEnabled: enableOtherAppImports,
    })) {
      setActiveSettingsSection("general");
    }
  }, [activeSettingsSection, cloudEnabled, enableOtherAppImports]);

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


  const [cloudResolutionRefreshKey, setCloudResolutionRefreshKey] = useState(0);
  const revalidateRepositoryContext = useCallback(() => setCloudResolutionRefreshKey((value) => value + 1), []);
  const projectCloudContext = useCurrentRepositoryCloudContext({
    workspace: focusedWorkspace,
    activeGitStatus,
    activeCloudSession,
    cloudEnabled,
    desktopCloudApiBaseUrl,
    resolutionInputsLoading: cloudResolutionInputsLoading,
    refreshKey: cloudResolutionRefreshKey,
    updateCloudSession,
  });
  const resolvedCloudProjectId = getResolvedCloudProjectId(projectCloudContext);
  const nativeCloudWorkbench = useNativeCloudWorkbench({
    context: accountCloud.context,
    session: activeCloudSession,
    apiBaseUrl: desktopCloudApiBaseUrl,
    active: cloudWorkspaceActive,
    filesVisibilitySettings,
  });
  const accountCloudPresentation = useAccountCloudWorkspacePresentation({
    workbench: nativeCloudWorkbench,
    onOpenSettings: openSettingsDialog, settingsOpen: settingsDialogOpen,
    showWorkspaceNavigation: !enableProjectSwitcherRail,
    sidebarUtility: enableProjectSwitcherRail ? undefined : <DesktopHelpLauncher appearance={surfaceAppearance} />,
  });
  const cloudAgent = useCloudAgentWorkspace({ context: accountCloud.context, session: activeCloudSession,
    apiBaseUrl: desktopCloudApiBaseUrl, active: cloudWorkspaceActive, onPublication: nativeCloudWorkbench.refresh });
  const cloudSidebar = useCloudWorkspaceSidebar({ context: accountCloud.context, session: activeCloudSession,
    apiBaseUrl: desktopCloudApiBaseUrl, active: cloudWorkspaceActive, agent: cloudAgent });
  const closeCloudSidebar = cloudSidebar.close;
  const closeWorkspaceSidebars = useCallback(() => {
    blurAuxiliarySurfaceFocus();
    setRightSidebarOpen(false);
    closeCloudSidebar();
  }, [blurAuxiliarySurfaceFocus, closeCloudSidebar, setRightSidebarOpen]);
  const repositoryCloudInitializationPending = cloudBackupLoading || cloudPublishStateLoading || Boolean(cloudPublishState);
  const repositoryCloudSwitch = useRepositoryCloudWorkspaceSwitch({
    enabled: cloudEnabled && Boolean(focusedWorkspace),
    scope: JSON.stringify([focusedWorkspace?.id, focusedWorkspace?.path]),
    context: projectCloudContext, session: activeCloudSession, apiBaseUrl: desktopCloudApiBaseUrl,
    onPrepared: accountCloud.activatePrepared,
    onRevalidate: revalidateRepositoryContext,
    initializationPending: repositoryCloudInitializationPending,
  });
  const requestCloudWorkspace = repositoryCloudSwitch.request;
  const cancelRepositoryCloudSwitch = repositoryCloudSwitch.cancel;
  const cancelAccountCloudOpen = accountCloud.cancel;
  const cancelCloudWorkspaceSwitch = useCallback(() => {
    closeWorkspaceSidebars();
    cancelRepositoryCloudSwitch(); cancelAccountCloudOpen();
  }, [cancelAccountCloudOpen, cancelRepositoryCloudSwitch, closeWorkspaceSidebars]);
  const openCloudWorkspace = useCallback(() => {
    if (!cloudEnabled) return;
    closeWorkspaceSidebars();
    cancelAccountCloudOpen();
    requestCloudWorkspace();
    setActiveCloudSection(CLOUD_HUB_ENTRY_SECTION);
    setCloudDialogOpen(false);
    setSettingsDialogOpen(false);
    setPluginsDialogOpen(false);
    setBranchSwitcherOpen(false);
  }, [cancelAccountCloudOpen, closeWorkspaceSidebars, cloudEnabled, requestCloudWorkspace, setBranchSwitcherOpen]);
  const openLocalWorkspace = useCallback(() => {
    closeWorkspaceSidebars();
    cancelRepositoryCloudSwitch();
    returnToLocalWorkspace();
    setCloudDialogOpen(false);
    setBranchSwitcherOpen(false);
  }, [cancelRepositoryCloudSwitch, closeWorkspaceSidebars, returnToLocalWorkspace, setBranchSwitcherOpen]);

  useEffect(() => {
    if (cloudWorkspaceActive) resetDataNodeActions();
  }, [cloudWorkspaceActive, resetDataNodeActions]);
  useEffect(() => {
    if (activeView === "cloud") {
      setActiveView("data");
      if (cloudEnabled) openCloudWorkspace();
      if (!cloudEnabled) setActiveCloudSection("initialize");
      return;
    }
    if (!cloudEnabled) setCloudDialogOpen(false);
    if (activeView === "git") {
      setActiveView("data");
      setActiveCloudSection("initialize");
    }
  }, [activeView, cloudEnabled, openCloudWorkspace]);


  const [shareWizard, setShareWizard] = useState<{
    targetId: ShareTargetId | null;
    path: string;
    /** Set when the Header asked for one of the two verbs by name. */
    intent?: "invite" | "connect";
  } | null>(null);
  const {
    shares: projectShares,
    pending: pendingShare,
    setPending: setPendingShare,
  } = useProjectShareActivity({
    session: activeCloudSession,
    apiBaseUrl: desktopCloudApiBaseUrl,
    projectId: resolvedCloudProjectId,
    enabled: shareOnboardingEnabled,
    onSessionChange: updateCloudSession,
  });
  const cloudSignedIn = activeCloudSession !== null;
  const projectCloudLocationState = getProjectCloudLocationState(projectCloudContext, cloudSignedIn);
  const prepareCloudInPlace = Boolean(activeCloudSession && !repositoryCloudInitializationPending && (projectCloudContext.status === "resolved"
    || projectCloudContext.status === "resolving" || repositoryCloudSwitch.error));
  const headerWorkspaceLocation = cloudWorkspaceActive ? "cloud"
    : (prepareCloudInPlace && repositoryCloudSwitch.requestedLocation) || "local";
  const cloudHeaderActive = headerWorkspaceLocation === "cloud";
  const localRightSidebarActive = !cloudWorkspaceActive && !repositoryCloudSwitch.pending;
  const rightSidebarContentVisible = rightSidebarOpen && localRightSidebarActive;
  const agentSidebarOpen = rightSidebarContentVisible && rightSidebarSurface === "chat";
  const handleLocalRightSidebarOpenChange = useCallback((open: boolean) => {
    if (!open || localRightSidebarActive) setRightSidebarOpen(open);
  }, [localRightSidebarActive, setRightSidebarOpen]);
  // Header selection follows intent immediately; the provider remains local
  // until authorization and root-file access complete.
  const projectLocation: DesktopProjectLocation | undefined = cloudEnabled
    ? { current: cloudWorkspaceActive ? "cloud" : "local", requested: repositoryCloudSwitch.requestedLocation,
      headerLocation: headerWorkspaceLocation,
      loading: repositoryCloudSwitch.pending && !repositoryCloudSwitch.error,
      localAvailable: true, cloudState: projectCloudLocationState }
    : undefined;
  // The wizard stacks above the Cloud dialog so the Homepage is still there when it closes.
  const openShareWizard = useCallback((
    targetId: ShareTargetId | null,
    path = "",
    intent?: "invite" | "connect",
  ) => {
    if (!shareOnboardingEnabled) return;
    setShareWizard({ targetId, path, intent });
    setSettingsDialogOpen(false);
    setPluginsDialogOpen(false);
    setSwitcherOpen(false);
    setBranchSwitcherOpen(false);
  }, [setBranchSwitcherOpen, shareOnboardingEnabled]);
  const closeShareWizard = useCallback(() => setShareWizard(null), []);
  useEffect(() => {
    if ((accountCloud.opening || repositoryCloudSwitch.pending) && (cloudDialogOpen || settingsDialogOpen || pluginsDialogOpen || shareWizard)) {
      cancelCloudWorkspaceSwitch();
    }
  }, [cancelCloudWorkspaceSwitch, cloudDialogOpen, accountCloud.opening, repositoryCloudSwitch.pending, pluginsDialogOpen, settingsDialogOpen, shareWizard]);
  useEffect(() => {
    if (shareOnboardingEnabled) return;
    setShareWizard(null);
    if (activeCloudSection === "share") setActiveCloudSection(CLOUD_HUB_ENTRY_SECTION);
  }, [activeCloudSection, shareOnboardingEnabled]);
  const cloudShareActions = useMemo<CloudShareActions | null>(() => (
    shareOnboardingEnabled
      ? { shares: projectShares, signedIn: cloudSignedIn, pending: pendingShare, openShare: openShareWizard }
      : null
  ), [cloudSignedIn, openShareWizard, pendingShare, projectShares, shareOnboardingEnabled]);
  // Who can reach this project, for the Header. The share domain owns the
  // status, the rows and stopping a reach; the Header only states them.
  const reachDestinations = useMemo(() => SHARE_TARGETS.map((target) => ({
    id: target.id,
    brand: target.brand,
    label: t(shareTargetLabelKey(target.id)),
  })), [t]);
  const projectReachShareStatus = resolveCloudShareStatus({
    context: projectCloudContext,
    shares: projectShares.shares,
    sharesLoaded: projectShares.loaded,
    signedIn: cloudSignedIn,
    pending: pendingShare,
  });
  const projectShareRevoke = useProjectShareRevoke({
    session: activeCloudSession,
    apiBaseUrl: desktopCloudApiBaseUrl,
    shares: projectShares,
    onSessionChange: updateCloudSession,
  });
  const projectReachState = resolveProjectReachState({
    share: projectReachShareStatus.kind,
    shares: projectReachShareStatus.readers,
    destinations: reachDestinations,
    deviceCopyAvailable: projectLocation?.localAvailable !== false,
    // Where the project is, taken from the surface the user is working on —
    // stated by the Header, never offered as a choice.
    place: (projectLocation?.headerLocation ?? projectLocation?.current) === "cloud" ? "cloud" : "this-device",
    waitingFor: pendingShare ? t(shareTargetLabelKey(pendingShare.targetId)) : null,
  });
  // Without Puppyone Cloud there is nobody to reach, so the Header states
  // nothing — exactly like the established control, which only exists while
  // Cloud does. Capability differences inside the entry never become a prompt.
  const projectReach = useMemo<ProjectReachControlProps | null>(() => (
    projectReachEnabled && shareOnboardingEnabled && cloudEnabled
      ? {
        state: projectReachState,
        // No rows when nobody is there: the Header already states "only you",
        // and an empty list would say the same thing a second time.
        readers: projectReachState.members.length > 0
          ? <ReadersList readers={projectReachShareStatus.readers} revoke={projectShareRevoke} />
          : undefined,
        onInvitePerson: () => openShareWizard("person", "", "invite"),
        onConnectAgent: () => openShareWizard(null, "", "connect"),
        onGetCopy: cloudEnabled ? openCloudWorkspace : undefined,
      }
      : null
  ), [cloudEnabled, openCloudWorkspace, openShareWizard, projectReachEnabled, projectReachShareStatus,
    projectReachState, projectShareRevoke, shareOnboardingEnabled]);
  const listShareFolders = useCallback(async (): Promise<ShareWizardFolderEntry[]> => {
    if (!dataPort) return [];
    const children = await dataPort.listChildren(focusedWorkspaceFolder?.uri ?? null);
    return children
      .filter((node) => node.type === "folder")
      .map((node) => ({
        name: node.name,
        path: resolveWorkspaceResource(node.path)?.providerPath ?? node.name,
      }))
      .filter((entry) => entry.path.length > 0);
  }, [dataPort, focusedWorkspaceFolder?.uri, resolveWorkspaceResource]);
  // What is inside the folder a share would cover, for the share screen's
  // preview: the entries, and one file shown open beside them. The Cloud
  // workspace share screen illustrates a share exactly this way, so the two
  // screens show one thing rather than two ideas of a preview.
  const listSharePreview = useCallback(async (path: string): Promise<ReachPreviewData> => {
    if (!dataPort) return { entries: [] };
    const root = await dataPort.listChildren(focusedWorkspaceFolder?.uri ?? null);
    const chosen = path
      ? root.find((node) => (resolveWorkspaceResource(node.path)?.providerPath ?? node.name) === path)
      : null;
    if (path && !chosen) return { entries: [] };
    const nodes = chosen ? await dataPort.listChildren(chosen.path) : root;
    const entries = nodes.map((node) => ({ name: node.name, type: node.type }));
    const opened = pickSharePreviewFile(nodes);
    if (!opened) return { entries };
    try {
      const content = await dataPort.readFile?.(opened.path);
      return { entries, file: { name: opened.name, type: opened.type, content: content ?? undefined } };
    } catch {
      return { entries, file: { name: opened.name, type: opened.type } };
    }
  }, [dataPort, focusedWorkspaceFolder?.uri, resolveWorkspaceResource]);

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
      cancelCloudWorkspaceSwitch();
      returnToLocalWorkspace();
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
    cancelCloudWorkspaceSwitch,
    returnToLocalWorkspace,
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

      if (view === "cloud" && !cloudEnabled) {
        setActiveView("data");
        setSidebarCollapsed(false);
        setSwitcherOpen(false);
        return;
      }

      if (view === "cloud") {
        openCloudWorkspace();
        return;
      }

      setActiveView(view);
      setSidebarCollapsed(false);
      setSwitcherOpen(false);
    };

    void commitNavigation();
  }, [
    cloudEnabled,
    openCloudWorkspace,
    setSidebarCollapsed,
  ]);

  useEffect(() => {
    if (activeView !== "settings" && activeView !== "cloud") lastProjectViewRef.current = activeView;
  }, [activeView]);

  const openProjectFromHeader = useCallback(async (path: string) => {
    setSwitcherOpen(false);
    try {
      await openWorkspaceTarget({ kind: "local", path, placement: "dedicated-window" });
      await refreshRecentWorkspaceList();
    } catch (error) {
      setRestoreWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, [refreshRecentWorkspaceList, setRestoreWorkspaceError]);

  const openCloudProjectFromHeader = useCallback(async (projectId: string) => {
    if (!activeCloudSession) return;
    setSwitcherOpen(false);
    try {
      await openCloudProjectInNewWindow({ projectId, userId: activeCloudSession.user_id });
    } catch (error) {
      setRestoreWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }, [activeCloudSession, setRestoreWorkspaceError]);

  const switchProjectFromRail = useCallback(async (path: string) => {
    const projectView = lastProjectViewRef.current;
    if (path === workspace?.path) {
      navigateDesktopView(projectView);
      return;
    }
    try {
      if (!await drainWorkspaceNavigation()) return;
      await openWorkspacePath(path, "switched");
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
  const handleEditorTabActivate = useCallback((editorId: string) => {
    editorWorkbench.activate(editorId);
    setActiveView("data");
    setDocumentNavigationError(null);
  }, [editorWorkbench]);
  useEffect(() => {
    const handleEditorShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || cloudWorkspaceActive || activeView !== "data" || editorWorkbench.state.editors.length === 0) return;
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
  }, [activeView, cloudWorkspaceActive, editorWorkbench, handleEditorClose]);
  const handleActiveDataNodeChange = useCallback((node: DataNode | null) => {
    setActiveExplorerNode((current) => (
      hasSameActiveDataNodeIdentity(current, node) ? current : node
    ));
  }, [setActiveExplorerNode]);

  const handlePuppyoneConfigChange = useCallback(async (nextConfig: PuppyoneWorkspaceConfig) => {
    const savedConfig = await savePuppyoneConfig(nextConfig);
    if (savedConfig) {
      refreshWorkspaceContent();
      await refreshGitStatus("configuration");
    }
    return savedConfig;
  }, [refreshGitStatus, refreshWorkspaceContent, savePuppyoneConfig]);

  const [workspaceSurfaceError, setWorkspaceSurfaceError] = useState<string | null>(null);

  useWorkspaceEntryBootstrap({
    intent: dataPort ? workspaceEntryIntent : null,
    dataPort,
    editorHydrated: editorWorkbench.hydrated,
    hasOpenEditors: editorWorkbench.state.editors.length > 0,
    folders: workbenchWorkspace?.folders ?? EMPTY_WORKSPACE_FOLDERS,
    openDocument: handleActiveDataPathChange,
    consume: consumeWorkspaceEntryIntent,
    onError: setWorkspaceSurfaceError,
  });

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
      setSidebarCollapsed(false);
      setSwitcherOpen(false);
    }
  }, [cloudEnabled, setSidebarCollapsed, settingsDialogOpen, updateCloudSession]);

  const handleRemoveCloudRemote = useCallback(async (expectedRemotes?: readonly GitRemoteSummary[]) => {
    if (!focusedWorkspace) return;
    const context = captureGitRepositoryContext(focusedWorkspace.path);
    if (!context) throw new Error("The current repository is unavailable.");
    const refreshedStatus = await removeWorkspaceGitRemote(focusedWorkspace.path, "puppyone", expectedRemotes);
    if (!isGitRepositoryContextCurrent(context)) return;
    const currentConfig = puppyoneConfig
      ?? await readPuppyoneWorkspaceConfig(focusedWorkspace.path);
    if (!isGitRepositoryContextCurrent(context)) return;
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
    isGitRepositoryContextCurrent,
    handlePuppyoneConfigChange,
    puppyoneConfig,
    refreshWorkspaceContent,
    focusedWorkspace,
  ]);


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
    setPluginsDialogOpen(false);
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

  const unlinkProjectFromRail = useCallback(async (folderPath: string) => {
    if (workspace?.path === folderPath) {
      await unlinkCurrentWorkspace();
      return;
    }
    await removeWorkspaceFromRecents(folderPath);
  }, [removeWorkspaceFromRecents, unlinkCurrentWorkspace, workspace?.path]);

  const toggleWorkspaceSwitcher = useCallback(() => {
    const nextOpen = !switcherOpen;
    setSwitcherOpen(nextOpen);
    setBranchSwitcherOpen(false);
  }, [setBranchSwitcherOpen, switcherOpen]);

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
            onOpenFile={(path) => handleAgentOpenFile(context.item.rootId, path)}
            onOpenAccount={() => openSettingsDialog("account")}
            onOpenModelConnections={() => openSettingsDialog("model-connections")}
            resolveWorkspaceReference={resolveAgentWorkspaceReference}
          />
        </Suspense>
      ),
      close: createAgentChatCloseAdapter(t, ({ item, project }) => closeAgentChatWorkbenchItem(project, item.id)),
    });
  }, [
    agentChatRuntimeVisibility,
    handleAgentOpenFile,
    openSettingsDialog,
    resolveAgentWorkspaceReference,
    t,
  ]);
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
  const handleOpenGitHistory = gitPresentation.openHistory;
  const handleBackToGitChanges = gitPresentation.backToChanges;
  const gitTitlebarStatus = getGitTitlebarStatus(activeGitStatus);
  const headerCoachmarks = useHeaderCoachmarks({
    agentOpen: agentSidebarOpen,
    alwaysShow: enableAlwaysShowOnboardingCoachmarks,
    changesOpen: gitPresentation.open,
    localChangeCount: activeGitStatus?.isRepo ? gitTitlebarStatus.localChanges : null,
    workspaceEntryId: workspaceEntryIntent?.id ?? null,
    workspaceScopeId: focusedWorkspace?.id ?? null,
  });
  const handleToggleGitChanges = gitPresentation.toggle;
  const handleOpenGitWorkingFile = useCallback((path: string) => {
    const rootUri = focusedWorkspaceFolder?.uri;
    if (!rootUri) return;
    void handleActiveDataPathChange(qualifyDataResourcePath(rootUri, path));
  }, [focusedWorkspaceFolder?.uri, handleActiveDataPathChange]);
  const handleToggleAgentWorkbench = useCallback(() => {
    if (!localRightSidebarActive) return;
    if (agentSidebarOpen) {
      setRightSidebarOpen(false);
      return;
    }
    setRightSidebarSurface("chat");
    setRightSidebarOpen(true);
    setSwitcherOpen(false);
  }, [
    agentSidebarOpen,
    localRightSidebarActive,
    setRightSidebarOpen,
    setRightSidebarSurface,
  ]);
  const projectRailLayout = {
    leadingRailWidth: projectSwitcherExpandedWidth,
    leadingRailMinWidth: MIN_PROJECT_SWITCHER_EXPANDED_WIDTH,
    leadingRailMaxWidth: MAX_PROJECT_SWITCHER_EXPANDED_WIDTH,
    leadingRailCollapsed: !projectSwitcherExpanded,
    leadingRailCollapsedWidth: projectSwitcherCompactWidth,
    leadingRailCollapseThreshold: MIN_PROJECT_SWITCHER_EXPANDED_WIDTH / 2,
    resizableLeadingRail: true,
    onLeadingRailCollapsedChange: setProjectSwitcherCollapsed,
    onLeadingRailWidthChange: setProjectSwitcherWidth,
  };
  const renderProjectRail = (activeWorkspace: Workspace, expanded: boolean, activeCloudProjectId?: string | null) => (
    <ProjectSwitcherRail
      activeView={activeView}
      activeWorkspace={activeWorkspace}
      activeCloudProjectId={activeCloudProjectId}
      expanded={expanded}
      recentWorkspaces={recentWorkspaceItems}
      projectItems={projectCatalog.items}
      onHome={() => void goToHomepage()}
      onAddProject={workspace && multiRootWorkspacesEnabled ? () => void addProject() : undefined}
      onCreateNew={projectEntryFlow.openLauncher}
      pluginsOpen={pluginsDialogOpen}
      onOpenPlugins={enableViewerPlugins ? openPluginsDialog : undefined}
      settingsOpen={settingsDialogOpen}
      onOpenSettings={openSettingsDialog}
      onRenameProject={renameProject}
      onSelectProject={openProjectFromHeader}
      onSelectCloudProject={openCloudProjectFromHeader}
      onUnlinkProject={unlinkProjectFromRail}
      utilitySlot={<DesktopHelpLauncher appearance={surfaceAppearance} />}
    />
  );
  const hostedWorkspace = nativeCloudWorkbench.service?.workspace;
  const accountCloudSurface = !workspace ? <AccountCloudWorkspaceSurface workbench={nativeCloudWorkbench}
    agent={cloudAgent} sidebar={cloudSidebar}
    presentation={accountCloudPresentation} active={cloudWorkspaceActive}
    context={accountCloud.context} session={activeCloudSession} apiBaseUrl={desktopCloudApiBaseUrl} onSessionChange={updateCloudSession}
    appearance={surfaceAppearance} onLocal={openLocalWorkspace} onHome={() => void goToHomepage()}
    projectItems={projectCatalog.items} onSelectProject={openProjectFromHeader} onSelectCloudProject={openCloudProjectFromHeader}
    projectRail={enableProjectSwitcherRail && hostedWorkspace ? { ...projectRailLayout,
      renderLeadingRail: ({ expanded }) => renderProjectRail(hostedWorkspace, expanded) } : undefined}
    onCreateProject={projectEntryFlow.openCreate} /> : null;
  const repositoryCloudDialog = <CloudWorkspaceSwitchDialog controller={repositoryCloudSwitch}
    projectName={workspace?.name}
    preparingInPlace={prepareCloudInPlace}
    authenticationRequired={!activeCloudSession}
    gate={<RepositoryCloudSwitchGate context={projectCloudContext} apiBaseUrl={desktopCloudApiBaseUrl}
      authState={resolveCloudAuthState({ cloudSession: activeCloudSession, sessionRestoring: cloudSessionRestoring,
        environment: { apiBaseUrl: desktopCloudApiBaseUrl, source: "default", cloudRemote: null } })}
      onRetry={() => { setCloudResolutionRefreshKey((value) => value + 1); repositoryCloudSwitch.retry(); }}
      initializationPending={repositoryCloudInitializationPending}
      missingProjectRecovery={workspace && activeCloudSession && focusedWorkspace?.path === workspace.path
        && projectCloudContext.status === "not-found" ? <MissingCloudProjectRecovery
          key={JSON.stringify([workspace.path, desktopCloudApiBaseUrl, activeCloudSession.user_id,
            activeCloudSession.session_generation, projectCloudContext.projectId])}
          context={projectCloudContext} status={activeGitStatus} session={activeCloudSession}
          apiBaseUrl={desktopCloudApiBaseUrl} onRemoveCloudRemote={handleRemoveCloudRemote}
          onRetry={() => { setCloudResolutionRefreshKey(value => value + 1); repositoryCloudSwitch.retry(); }} /> : undefined}
      publishEntry={workspace && activeCloudSession && focusedWorkspace?.path === workspace.path ? <CloudInitializationRoute
        activeSection="contents" workspace={workspace} status={activeGitStatus}
        session={activeCloudSession} apiBaseUrl={desktopCloudApiBaseUrl} accountEmail={activeCloudSession.user_email}
        loading={gitStatusLoading} error={gitStatusError} cloudActionNotice={null}
        cloudBackupLoading={cloudBackupLoading} cloudBackupPending={pendingCloudBackupSetup}
        cloudPublishError={cloudPublishError} cloudPublishNotice={cloudPublishNotice}
        cloudPublishProgress={cloudPublishProgress} cloudPublishState={cloudPublishState}
        cloudPublishStateLoading={cloudPublishStateLoading} onSessionChange={updateCloudSession}
        onAbandonPublish={handleAbandonPuppyoneBackup} onRefresh={() => void refreshGitStatus("configuration")}
        onPublishWorkspace={(organizationId) => void handleStartPuppyoneBackup(organizationId, { navigateToCloud: false })}
      /> : undefined}
      onPublishLocal={workspace ? () => { cancelRepositoryCloudSwitch(); openCloudDialogAt("initialize"); } : undefined} />} />;
  const settingsWorkspace = focusedWorkspace ?? workspace ?? null;
  const firstRunSignIn = useFirstRunSignIn({
    available: cloudAvailable && Boolean(desktopCloudApiBaseUrl),
    restoring: cloudSessionRestoring || restoringWorkspace,
    signedIn: Boolean(activeCloudSession),
    hasProjects: Boolean(workspace || initialCloudProject || recentWorkspaceItems.length || workspaces.length),
  });
  const settingsOverlay = <DesktopOverlayPortal appearance={surfaceAppearance}>
    {settingsDialogOpen && (
      <SettingsDialog
        workspace={settingsWorkspace}
        activeSection={activeSettingsSection}
        onSelectSection={setActiveSettingsSection}
        onOpenImport={() => {
          setSettingsDialogOpen(false);
          projectEntryFlow.openImport();
        }}
        subThemeCatalog={subThemeCatalog}
        onFilesVisibilityChange={refreshWorkspaceContent}
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
          automaticDownloadPreferenceAvailable:
            desktopUpdates.automaticDownloadPreferenceAvailable,
          automaticDownloadPreferenceSaving:
            desktopUpdates.automaticDownloadPreferenceSaving,
          automaticDownloadPreferenceError:
            desktopUpdates.automaticDownloadPreferenceError,
          setAutomaticallyDownloadUpdates:
            desktopUpdates.setAutomaticallyDownloadUpdates,
        }}
        onClose={closeSettingsDialog}
      />
    )}
  </DesktopOverlayPortal>;
  const themeRuntime = (content: ReactNode) => (
    <SurfaceAppearanceProvider value={surfaceAppearance}>
      <div
        className={`desktop-theme-bootstrap-surface ${resolvedTheme === "dark" ? "dark" : ""}`}
        {...surfaceAppearance.rootProps}
      >
        <div hidden={cloudWorkspaceActive} style={{ display: cloudWorkspaceActive ? "none" : "contents" }}>
          {content}
        </div>
        {accountCloudSurface}
        {settingsOverlay}
      </div>
    </SurfaceAppearanceProvider>
  );

  if (!workspace && (restoringWorkspace || firstRunSignIn.pending)) {
    return themeRuntime(
      <RestoringWorkspaceScreen
        appearance={surfaceAppearance}
      />,
    );
  }

  if (!workspace) {
    if (firstRunSignIn.required) return themeRuntime(
      <FirstRunSignInScreen appearance={surfaceAppearance} apiBaseUrl={desktopCloudApiBaseUrl}
        onContinueLocally={firstRunSignIn.complete} />,
    );
    return themeRuntime(
      <Homepage
        onChooseWorkspace={openFolder}
        onChooseProjectLocation={chooseProjectLocation}
        onDefaultProjectLocation={defaultProjectLocation}
        onCreateProject={createProject}
        onImportSource={importSource}
        onConnectImportSource={connectImportSource}
        onListImportResources={listImportResources}
        onCancelImportSource={cancelImportSource}
        onImportSourceProgress={onImportSourceProgress}
        onOpenDroppedWorkspace={openDroppedWorkspace}
        onOpenWorkspacePath={openWorkspacePath}
        onRemoveProject={removeWorkspaceFromRecents}
        projectItems={projectCatalog.items}
        onOpenCloudProject={(projectId) => { cancelRepositoryCloudSwitch(); void accountCloud.openTarget({ kind: "project_root", project_id: projectId }); }}
        cloudOpening={accountCloud.opening}
        onCancelCloudOpening={accountCloud.cancel}
        cloudAccountStatus={cloudAvailable ? <HomepageCloudStatus status={projectCatalog.status} restoring={cloudSessionRestoring} empty={cloudEnabled && projectCatalog.items.length === 0}
          session={activeCloudSession} onOpenAccount={() => openSettingsDialog("account")}
          apiBaseUrl={desktopCloudApiBaseUrl} controller={accountCloud} onRetry={projectCatalog.refresh} /> : undefined}
        initialError={restoreWorkspaceError}
        appearance={surfaceAppearance}
      />,
    );
  }

  const gitChangesView = (
    <GitChangesSidebar
      repository={{
        status: activeGitStatus,
        puppyoneConfig,
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
        stageAndCommit: handleStageAndCommitGit,
        commit: handleCommitGit,
        commitAndPush: handleCommitAndPushGit,
        continueOperation: handleContinueGitOperation,
        abortOperation: handleAbortGitOperation,
        pull: handlePullGit,
        push: handlePushGit,
        publish: handlePublishGitBranch,
      }}
      workingFileDiff={gitWorkingFileDiff}
      workingFileDiffLoading={gitWorkingFileDiffLoading}
      workingFileDiffError={gitWorkingFileDiffError}
      onOpenFile={handleOpenGitWorkingFile}
      onOpenHistory={handleOpenGitHistory}
      cloudBackup={{
        loading: cloudBackupLoading || pendingCloudBackupSetup,
        error: null,
        enabled: cloudEnabled,
        start: handleStartPuppyoneBackup,
      }}
    />
  );
  const gitHistoryView = (
    <GitHistorySidebar
      status={activeGitStatus}
      statusLoading={gitStatusLoading}
      statusError={gitStatusError}
      selectedCommitId={selectedGitCommitId}
      commitDetail={gitCommitDetail}
      commitDetailLoading={gitCommitDetailLoading}
      commitDetailError={gitCommitDetailError}
      historyLoading={gitHistoryLoading}
      initializing={gitOperationLoading === "init"}
      onInitialize={handleInitializeGitRepository}
      onSelectCommit={selectGitCommit}
      onBack={handleBackToGitChanges}
    />
  );
  const chromeActionProps = {
    desktopUpdateState: desktopUpdates.state,
    terminalSidebarOpen: agentSidebarOpen,
    terminalToolEnabled: !cloudHeaderActive,
    gitChangesAvailable: Boolean(focusedWorkspace) && !cloudHeaderActive,
    gitChangesOpen: gitPresentation.open,
    // The Header states this device's own work; the receipt for changes made
    // elsewhere belongs to the sidebar on the project reach path.
    gitChangesStatus: projectReachEnabled ? reachHeaderChangesStatus(gitTitlebarStatus) : gitTitlebarStatus,
    activeCoachmark: headerCoachmarks.active,
    onAcknowledgeCoachmark: headerCoachmarks.acknowledge,
    onUpdateNow: () => void desktopUpdates.updateNow(),
    onToggleTerminal: handleToggleAgentWorkbench,
    onToggleGitChanges: handleToggleGitChanges,
    cloudEnabled,
    shareEnabled: shareOnboardingEnabled,
    onShare: openCloudShare,
  };
  const titlebarContext = (
    <DesktopTitlebarContext
      titlebarLabel={workspace.name}
      projectMenuEnabled={!enableProjectSwitcherRail}
      menuAlignment={centerProjectInHeader ? "center" : "start"}
      projectLocation={projectLocation}
      projectReach={projectReach}
      cloudProject={focusedWorkspace?.path === workspace.path && projectCloudContext.status === "resolved"
        ? { id: projectCloudContext.projectId, name: projectCloudContext.projectName } : undefined}
      workspace={workspace}
      workspaceFolders={workbenchWorkspace?.folders ?? []}
      multiRootWorkspacesEnabled={multiRootWorkspacesEnabled}
      availableProjects={recentWorkspaceItems.map((item) => item.workspace)}
      projectItems={projectCatalog.items}
      open={switcherOpen}
      refObject={switcherRef}
      onOpenFolder={() => void addProject()}
      onAddExistingProject={(folderPath) => void addExistingProject(folderPath)}
      onViewLocal={openLocalWorkspace}
      onViewCloud={cloudEnabled ? openCloudWorkspace : undefined}
      onClose={closeWorkspaceSwitcher}
      onToggle={toggleWorkspaceSwitcher}
      onHome={() => void goToHomepage()}
      onCreateProject={projectEntryFlow.openCreate}
      onSelectProject={openProjectFromHeader}
      onSelectCloudProject={openCloudProjectFromHeader}
    />
  );

  const locationBarVisible = resolvedAppearance.composition.locationBar === "workspace-path-v1";
  const locationResource = resolveWorkspaceResource(activeDocumentPath ?? activeExplorerNode?.path ?? null);
  const locationBarPath = resolveDesktopShellLocationPath({
    // The address bar describes the content surface. Keep the active editor
    // authoritative even if explorer selection state is briefly catching up.
    activePath: locationResource?.providerPath ?? null,
    dataViewActive: activeView === "data",
    workspacePath: locationResource?.folder.workspace.path ?? workspace.path,
  });
  const titlebarActions = (
    <>
      {cloudHeaderActive && <CloudWorkspaceHeaderTools context={cloudWorkspaceActive ? accountCloud.context : null}
        getShareResource={() => captureCloudWorkspaceShareResource(nativeCloudWorkbench)}
        session={activeCloudSession} apiBaseUrl={desktopCloudApiBaseUrl} onSessionChange={updateCloudSession}
        historyOpen={cloudSidebar.historyOpen} onToggleHistory={cloudSidebar.toggleHistory}
        agentOpen={cloudAgent.open} onToggleAgent={cloudWorkspaceActive ? cloudSidebar.toggleAgent : undefined} />}
      {/* Who can reach the project sits where every application puts the
          people in a document: the right of the Header, ahead of the tools.
          It opens the same panel as the place control, so it is one entry
          seen from both halves of the subject rather than a second one. */}
      {projectReach && !cloudHeaderActive && <ProjectReachPeople {...projectReach} />}
      {/* On the project reach path the Header's project control is the only
          Cloud entry, so the right side adds no second share action. */}
      <DesktopTitlebarActions {...chromeActionProps}
        shareEnabled={!cloudHeaderActive && shareOnboardingEnabled && !projectReachEnabled} />
    </>
  );
  const renderCloudSidebar = (active: boolean) => <CloudWorkspaceSidebar sidebar={cloudSidebar}
    agent={cloudAgent} context={accountCloud.context} session={activeCloudSession} apiBaseUrl={desktopCloudApiBaseUrl}
    active={active} title={nativeCloudWorkbench.service?.workspace.name ?? ""}
    revisionKey={String(nativeCloudWorkbench.refreshToken.sequence)} onSessionChange={updateCloudSession} />;
  const editorTabsInHeaderEnabled = enableEditorTabsInHeader;
  const titlebarEditorTabs = editorTabsInHeaderEnabled ? (
    <EditorHeaderTabs
      activeEditorId={editorWorkbench.activeEditorId}
      editors={editorWorkbench.state.editors}
      storageIdentity={documentStorageIdentity}
      onActivate={handleEditorTabActivate}
      onClose={handleEditorClose}
      onCreate={(anchor) => openCreateEntryMenu(null, anchor)}
      onMove={editorWorkbench.moveTab}
    />
  ) : undefined;
  const feedbackLauncher = (
    <DesktopHelpLauncher
      appearance={surfaceAppearance}
    />
  );
  const projectSwitcherRailEnabled = enableProjectSwitcherRail;
  const projectSwitcherRailVisible = projectSwitcherRailEnabled;
  return (
    <SurfaceAppearanceProvider value={surfaceAppearance}>
      <CloudShareProvider value={cloudShareActions}>
      <div
        className={`app-shell cloud-runtime ${resolvedTheme === "dark" ? "dark" : ""}`}
        {...surfaceAppearance.rootProps}
      >
        <DesktopCloudShell
          active
          workspaceLocation={projectLocation?.current ?? "local"}
          requestedWorkspaceLocation={headerWorkspaceLocation}
          renderLeadingRail={enableProjectSwitcherRail ? ({ expanded }) => renderProjectRail(workspace, expanded,
            cloudWorkspaceActive && accountCloud.context.status === "resolved" ? accountCloud.context.projectId : undefined) : undefined}
          {...projectRailLayout}
          leftSidebarCollapsed={sidebarCollapsed}
          leftSidebarPresent={Boolean(dataPort)}
          leftSidebarWidth={explorerWidth}
          titlebarSidebarSlot={centerProjectInHeader ? undefined : titlebarContext}
          titlebarCenteredSlot={centerProjectInHeader ? titlebarContext : undefined}
          titlebarActions={titlebarActions}
          titlebarTabs={cloudWorkspaceActive
            ? editorTabsInHeaderEnabled && accountCloudPresentation.titlebarTabs
            : titlebarEditorTabs}
          alignTitlebarTabsToExplorer={editorTabsInHeaderEnabled}
          titlebarTabsHostRef={enableWorkbenchTabsInHeader && !editorTabsInHeaderEnabled
            ? setTitlebarTabHost
            : undefined}
          locationBar={cloudWorkspaceActive ? accountCloudPresentation.locationBar : locationBarVisible && (
            <DesktopShellLocationBar
              path={locationBarPath}
              onNavigate={handleLocationBarNavigate}
            />
          )}
          rightSidebarOpen={cloudWorkspaceActive ? cloudSidebar.open : rightSidebarContentVisible}
          resizableRightSidebar
          rightSidebarWidth={rightSidebarWidth}
          onLeftSidebarExpand={() => setSidebarCollapsed(false)}
          onRightSidebarOpenChange={cloudWorkspaceActive ? cloudSidebar.setOpen : handleLocalRightSidebarOpenChange}
          onRightSidebarWidthChange={setRightSidebarWidth}
          rightSidebar={(presentation) => (
            <div ref={auxiliarySurfaceRef} className="desktop-right-sidebar-stack">
              <div className={`desktop-right-sidebar-surface ${cloudWorkspaceActive ? "is-active" : ""}`}
                aria-hidden={!cloudWorkspaceActive}>
                {renderCloudSidebar(presentation.contentVisible && cloudWorkspaceActive)}
              </div>
              <div
                className={`desktop-right-sidebar-surface ${localRightSidebarActive && rightSidebarSurface === "chat" ? "is-active" : ""}`}
                aria-hidden={!localRightSidebarActive || rightSidebarSurface !== "chat"}
              >
                {projectWorkbench && <AuxiliaryWorkbenchPanel
                  key={projectWorkbench.context.generation}
                  store={projectWorkbench}
                  active={presentation.contentVisible && localRightSidebarActive && rightSidebarSurface === "chat"}
                  titlebarTabHost={enableWorkbenchTabsInHeader && !editorTabsInHeaderEnabled
                    ? titlebarTabHost
                    : null}
                  onReveal={() => {
                    if (!localRightSidebarActive) return;
                    setRightSidebarSurface("chat");
                    setRightSidebarOpen(true);
                  }}
                  contributions={auxiliaryWorkbenchContributions}
                  onRetryProjectClose={() => {
                    const folder = workbenchWorkspace?.folders.find((entry) => entry.workspace.path === projectWorkbench.context.rootPath);
                    if (folder) void handleRemoveProject(folder);
                  }}
                  renderLauncher={(context) => <AuxiliaryWorkbenchLauncher {...context} store={projectWorkbench} contributions={auxiliaryWorkbenchContributions} />}
                />}
              </div>
              <div
                className={`desktop-right-sidebar-surface ${localRightSidebarActive && rightSidebarSurface === "changes" ? "is-active" : ""}`}
                aria-hidden={!localRightSidebarActive || rightSidebarSurface !== "changes"}
              >
                {gitChangesView}
              </div>
              <div
                className={`desktop-right-sidebar-surface ${localRightSidebarActive && rightSidebarSurface === "history" ? "is-active" : ""}`}
                aria-hidden={!localRightSidebarActive || rightSidebarSurface !== "history"}
              >
                {gitHistoryView}
              </div>
            </div>
          )}
        >
          <DesktopWorkspaceLocationSurface location={projectLocation?.current ?? "local"}
            preparation={repositoryCloudSwitch.pending && prepareCloudInPlace
              ? <CloudWorkspacePreparation controller={repositoryCloudSwitch} /> : undefined}
            local={<>
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
              onCreateCloudVersion: (organizationId) => handleStartPuppyoneBackup(organizationId, { navigateToCloud: false }),
            }}
            cloudOpen={cloudDialogOpen}
            cloudLocationControls={focusedWorkspace?.path === workspace.path && !projectReachEnabled ? (
              <DesktopProjectLocationControls
                projectLocation={projectLocation}
                onViewLocal={openLocalWorkspace}
                onViewCloud={openCloudWorkspace}
              />
            ) : undefined}
            dataPort={dataPort}
            editorWorkbench={editorWorkbench}
            externalOpen={externalFileOpen}
            desktopUpdates={desktopUpdates}
            git={git}
            onActiveDataNodeChange={handleActiveDataNodeChange}
            onActiveDataPathChange={handleActiveDataPathChange}
            onResourceMove={handleResourceMoved}
            onRemoveProject={handleRemoveProject}
            openCreateEntryParentPath={createEntryDraft && !createEntryDraft.selectedKind
              && createEntryDraft.anchor.placement !== "auto-end"
              ? createEntryDraft.parentPath
              : undefined}
            openNodeActionPath={nodeActionMenu?.mode === "actions"
              ? nodeActionMenu.launcherPath ?? nodeActionMenu.node.path
              : null}
            onCreateEntryMenu={openCreateEntryMenu}
            onDismissCreateEntryMenu={() => setCreateEntryDraft(null)}
            fileClipboardController={fileClipboardController}
            onFilesVisibilityChange={refreshWorkspaceContent}
            onNavigate={navigateDesktopView}
            onCloseCloud={closeCloudDialog}
            onClosePlugins={closePluginsDialog}
            onOpenGitChanges={handleToggleGitChanges}
            onOpenImport={projectEntryFlow.openImport}
            onOpenPlugins={openPluginsDialog}
            onNodeActionMenu={openNodeActionMenu}
            onOpenSettings={openSettingsDialog}
            onPuppyoneConfigChange={handlePuppyoneConfigChange}
            onSelectSettingsSection={setActiveSettingsSection}
            onUnlinkWorkspace={unlinkCurrentWorkspace}
            puppyoneConfig={puppyoneConfig}
            puppyoneConfigError={puppyoneConfigError}
            puppyoneConfigLoading={puppyoneConfigLoading}
            puppyoneConfigSaving={puppyoneConfigSaving}
            settingsSection={activeSettingsSection}
            pluginsOpen={pluginsDialogOpen}
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
            sidebarUtility={projectSwitcherRailVisible
              ? undefined
              : feedbackLauncher}
          />
            </>}
            cloud={accountCloudPresentation.content}
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
          <ProjectEntryFlow
            controller={projectEntryFlow}
            onDefaultLocation={defaultProjectLocation}
            onChooseLocation={chooseProjectLocation}
            onCreateProject={createProject}
            onImportSource={importSource}
            onConnectSource={connectImportSource}
            onListResources={listImportResources}
            onCancelImport={cancelImportSource}
            onImportProgress={onImportSourceProgress}
            onOpenFolder={() => void openFolder()}
          />
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
                onChange={setCreateEntryDraft}
                onCancel={() => setCreateEntryDraft(null)}
                onCreate={createEntryFromMenu}
              />
            ) : (
              <DesktopCreateEntryMenu
                draft={createEntryDraft}
                mainEntries={createNewItems.main}
                submenuItemKinds={createNewItems.submenu}
                onCancel={() => setCreateEntryDraft(null)}
                onSelectKind={selectCreateEntryKind}
              />
            )
          )}
          {nodeActionMenu && (
            <DesktopNodeActionMenu
              draft={nodeActionMenu}
              showRevealInFinder
              showOpenInDefaultApp
              canPaste={nodeActionMenu.node.type === "folder" && fileClipboardController.canPasteInto(nodeActionMenu.node.path)}
              canCopy={fileClipboardController.canCopy}
              canCut={fileClipboardController.canCut}
              canDuplicate={fileClipboardController.canDuplicate}
              onChange={setNodeActionMenu}
              onCancel={() => setNodeActionMenu(null)}
              onCopyPath={copyNodePathFromMenu}
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
              onShare={shareOnboardingEnabled
                ? () => {
                  const sharedPath = resolveWorkspaceResource(nodeActionMenu.node.path)?.providerPath ?? "";
                  setNodeActionMenu(null);
                  openShareWizard(null, sharedPath);
                }
                : undefined}
            />
          )}
          {shareWizard && shareOnboardingEnabled && (projectReachEnabled ? (
            <ProjectReachDialog
              workspaceName={(focusedWorkspace ?? workspace).name}
              workspacePath={(focusedWorkspace ?? workspace).path}
              initialTargetId={shareWizard.targetId}
              initialIntent={shareWizard.intent}
              initialPath={shareWizard.path}
              session={activeCloudSession}
              apiBaseUrl={desktopCloudApiBaseUrl}
              projectContext={projectCloudContext}
              publish={{
                loading: cloudBackupLoading,
                progress: cloudPublishProgress,
                error: cloudPublishError,
                start: handleStartPuppyoneBackup,
              }}
              shares={projectShares}
              listTopLevelFolders={listShareFolders}
              listPreview={listSharePreview}
              onSessionChange={updateCloudSession}
              onIssued={setPendingShare}
              onOpenCloud={() => {
                closeShareWizard();
                openCloudDialog();
              }}
              onClose={closeShareWizard}
            />
          ) : (
            <ShareWizardDialog
              workspaceName={(focusedWorkspace ?? workspace).name}
              initialTargetId={shareWizard.targetId}
              initialPath={shareWizard.path}
              session={activeCloudSession}
              apiBaseUrl={desktopCloudApiBaseUrl}
              projectContext={projectCloudContext}
              publish={{
                loading: cloudBackupLoading,
                progress: cloudPublishProgress,
                error: cloudPublishError,
                start: handleStartPuppyoneBackup,
              }}
              shares={projectShares}
              listTopLevelFolders={listShareFolders}
              onSessionChange={updateCloudSession}
              onIssued={setPendingShare}
              onOpenCloud={() => {
                closeShareWizard();
                openCloudDialog();
              }}
              onClose={closeShareWizard}
            />
          ))}
          </>
        </DesktopOverlayPortal>
      </div>
      {settingsOverlay}
      </CloudShareProvider>
      {accountCloudSurface}
      <DesktopOverlayPortal appearance={surfaceAppearance}>{repositoryCloudDialog}</DesktopOverlayPortal>
    </SurfaceAppearanceProvider>
  );
}

function isPreviewableAgentImagePath(path: string) {
  return /\.(?:png|jpe?g|gif|webp|avif)$/i.test(path);
}

/**
 * Which file to show open in a share preview: the one a person opens first
 * when they want to know what a folder is. A readme is that file when there
 * is one; otherwise the first document in the folder stands for it.
 */
function pickSharePreviewFile(nodes: readonly DataNode[]): DataNode | null {
  const documents = nodes.filter((node) => node.type !== "folder" && !node.name.startsWith("."));
  const readme = documents.find((node) => /^readme\b/i.test(node.name));
  return readme ?? documents[0] ?? null;
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
