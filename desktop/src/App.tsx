import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AiEditRequest, type DataNode, type Workspace } from "@puppyone/shared-ui";
import { DesktopCloudShell, type DesktopView } from "./components/DesktopCloudShell";
import type { SettingsSection } from "./features/settings";
import type { CloudWorkspaceSection } from "./features/cloud";
import { MinimalOnboarding } from "./components/MinimalOnboarding";
import { RightTerminalPanel } from "./components/RightTerminalPanel";
import { useDesktopUpdates } from "./components/DesktopUpdateControls";
import {
  commitWorkspaceGit,
  configureWorkspaceCloudRemote,
  createLocalDataPort,
  createWorkspaceEntry,
  forgetLastWorkspace,
  getLatestAiEditReviewRequest,
  getLastWorkspace,
  getWorkspaceGitStatus,
  initializeWorkspaceGitRepository,
  loadFolderChildren,
  pushWorkspaceGit,
  rememberLastWorkspace,
  selectWorkspaceFolder,
  stageAllWorkspaceGitChanges,
  subscribeAiEditReviewUpdates,
} from "./lib/localFiles";
import {
  createCloudProject,
  getCloudRepoIdentity,
  type DesktopCloudSession,
} from "./lib/cloudApi";
import type { FilesVisibilitySettings } from "./preferences";
import type { PuppyoneWorkspaceConfig } from "./types/electron";
import { ChevronDown } from "lucide-react";
import { PuppyGitIcon } from "./features/app-shell/navigation";
import {
  MAX_RIGHT_SIDEBAR_WIDTH,
  MIN_RIGHT_SIDEBAR_WIDTH,
  TITLEBAR_BRANCH_LABEL_CHARS,
  TITLEBAR_WORKSPACE_LABEL_CHARS,
  mergePuppyoneWorkspaceConfig,
  shortenTitlebarLabel,
} from "./features/app-shell/preferences";
import { DesktopWorkspaceContent } from "./features/app-shell/DesktopWorkspaceContent";
import { DesktopTitlebarActions } from "./features/app-shell/DesktopTitlebarActions";
import { DesktopWorkspaceSwitcher } from "./features/app-shell/DesktopWorkspaceSwitcher";
import { RestoringWorkspaceScreen } from "./features/app-shell/RestoringWorkspaceScreen";
import { useDesktopPreferences } from "./features/app-shell/useDesktopPreferences";
import { usePuppyoneConfig } from "./features/app-shell/usePuppyoneConfig";
import { useDesktopCloudSession } from "./features/cloud/hooks/useDesktopCloudSession";
import {
  DesktopCreateEntryDialog,
  DesktopCreateEntryMenu,
  DesktopExplorerRowActions,
  DesktopNodeActionMenu,
  defaultCreateName,
  getCreateEntryInitialContent,
  getDesktopNodeExtension,
  getDesktopRenameDraft,
  formatDesktopExtensionLabel,
  normalizeCreateEntryName,
  normalizeDesktopExtension,
  normalizeDesktopRenameName,
  rectToCreateEntryAnchor,
  uniqueCreateEntryName,
  type DesktopCreateEntryDraft,
  type DesktopCreateEntryKind,
  type DesktopNodeActionMenuDraft,
} from "./features/data-workspace/nodeActions";
import {
  createExplorerDataPort,
  getDataParentPath,
  joinDataPath,
  remapActivePathAfterRename,
} from "./features/data-workspace/explorer";
import {
  BranchMenuGroup,
  BranchSwitchConflictDialog,
  GitOperationErrorDialog,
  createGitOperationErrorState,
} from "./features/source-control/operationDialogs";
import { useDesktopGitController } from "./features/source-control/useDesktopGitController";

type OpenWorkspaceOptions = {
  remember?: boolean;
};

export function App() {
  const desktopUpdates = useDesktopUpdates();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DesktopView>("data");
  const preferences = useDesktopPreferences();
  const {
    cloudSession,
    cloudSessionRestoring,
    handleCloudSessionChange: updateCloudSession,
  } = useDesktopCloudSession();
  const [activeCloudSection, setActiveCloudSection] = useState<CloudWorkspaceSection>("overview");
  const [pendingCloudBackupSetup, setPendingCloudBackupSetup] = useState(false);
  const [cloudBackupLoading, setCloudBackupLoading] = useState(false);
  const [cloudBackupError, setCloudBackupError] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const {
    aiEditAssistEnabled,
    explorerWidth,
    fileIconTheme,
    filesVisibilitySettings,
    gitDisplayMode,
    resolvedTheme,
    rightSidebarOpen,
    rightSidebarToolsSettings,
    rightSidebarWidth,
    sidebarCollapsed,
    sidebarNavigationLayout,
    sidebarNavigationOrientation,
    sidebarNavigationPlacement,
    terminalSidebarOpen,
    terminalToolEnabled,
    themeMode,
    setAiEditAssistEnabled,
    setExplorerWidth,
    setFileIconTheme,
    setFilesVisibilitySettings,
    setGitDisplayMode,
    setRightSidebarOpen,
    setRightSidebarToolsSettings,
    setRightSidebarWidth,
    setSidebarCollapsed,
    setSidebarNavigationLayout,
    setThemeMode,
  } = preferences;
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>("workspace");
  const [terminalResetToken, setTerminalResetToken] = useState(0);
  const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState(0);
  const [latestAiEditRequest, setLatestAiEditRequest] = useState<AiEditRequest | null>(null);
  const [activeDataPath, setActiveDataPath] = useState<string | null>(null);
  const [restoringWorkspace, setRestoringWorkspace] = useState(true);
  const [restoreWorkspaceError, setRestoreWorkspaceError] = useState<string | null>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  const workspacePathRef = useRef<string | null>(null);
  const [createEntryDraft, setCreateEntryDraft] = useState<DesktopCreateEntryDraft | null>(null);
  const [nodeActionMenu, setNodeActionMenu] = useState<DesktopNodeActionMenuDraft | null>(null);

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === activeWorkspaceId) ?? workspaces[0] ?? null,
    [activeWorkspaceId, workspaces],
  );
  const refreshWorkspaceContent = useCallback(() => {
    setWorkspaceRefreshToken((token) => token + 1);
  }, []);
  const git = useDesktopGitController({
    workspace,
    gitViewActive: activeView === "git",
    onWorkspaceContentChanged: refreshWorkspaceContent,
    onEnterGitView: () => setActiveView("git"),
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
    gitStatusLoading,
    gitWorkingFileDiff,
    gitWorkingFileDiffError,
    gitWorkingFileDiffLoading,
    localBranches,
    pendingBranchSwitch,
    remoteBranches,
    selectedGitCommitId,
    selectedGitWorkingFile,
    applyGitStatus,
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
    handleUnstageAllGitChanges,
    handleUnstageGitPaths,
    refreshGitStatus,
    refreshGitStatusWithFetch,
    selectGitCommit,
    selectGitMainPanel,
    selectGitWorkingFile,
    setBranchSwitcherOpen,
    setGitOperationError,
    setGitOperationLoading,
    setPendingBranchSwitch,
  } = git;
  const {
    puppyoneConfig,
    puppyoneConfigError,
    puppyoneConfigLoading,
    puppyoneConfigSaving,
    handlePuppyoneConfigChange: savePuppyoneConfig,
  } = usePuppyoneConfig(workspace?.path ?? null);
  const workspaceKey = useMemo(() => workspace?.path ?? "no-workspace", [workspace?.path]);
  const localDataPort = useMemo(
    () => (workspace ? createLocalDataPort(workspace.path) : null),
    [workspace],
  );
  const dataPort = useMemo(
    () => (localDataPort ? createExplorerDataPort(localDataPort, filesVisibilitySettings) : null),
    [filesVisibilitySettings, localDataPort],
  );
  const activeAiEditRequest = aiEditAssistEnabled ? latestAiEditRequest : null;
  const cloudWorkspaceAvailable = useMemo(() => Boolean(cloudSession), [cloudSession]);

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
    if (!switcherOpen && !branchSwitcherOpen) return undefined;

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && switcherRef.current?.contains(target)) return;
      if (target instanceof Node && branchSwitcherRef.current?.contains(target)) return;
      setSwitcherOpen(false);
      setBranchSwitcherOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSwitcherOpen(false);
        setBranchSwitcherOpen(false);
      }
    };

    window.addEventListener("pointerdown", closeOnPointerDown, true);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown, true);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [branchSwitcherOpen, switcherOpen]);

  useEffect(() => {
    workspacePathRef.current = workspace?.path ?? null;
    setGitOperationError(null);
    setGitOperationLoading(null);
    setPendingCloudBackupSetup(false);
    setCloudBackupLoading(false);
    setCloudBackupError(null);
    setActiveSettingsSection("workspace");
    setBranchSwitcherOpen(false);
    setLatestAiEditRequest(null);
    setActiveDataPath(null);
    setCreateEntryDraft(null);
    setNodeActionMenu(null);
  }, [workspace?.path]);

  const activateWorkspace = useCallback((nextWorkspace: Workspace, options: OpenWorkspaceOptions = {}) => {
    setWorkspaces((current) => {
      const withoutExisting = current.filter((item) => item.id !== nextWorkspace.id);
      return [nextWorkspace, ...withoutExisting];
    });
    setActiveWorkspaceId(nextWorkspace.id);
    setActiveView("data");
    setSwitcherOpen(false);
    setRestoreWorkspaceError(null);
    if (options.remember !== false) {
      void rememberLastWorkspace(nextWorkspace.path).catch((error) => {
        console.warn("Unable to remember puppyone workspace:", error);
      });
    }
  }, []);

  const openWorkspace = useCallback((nextWorkspace: Workspace, options: OpenWorkspaceOptions = {}) => {
    activateWorkspace(nextWorkspace, options);
  }, [activateWorkspace]);

  const navigateDesktopView = useCallback((view: DesktopView) => {
    if (view === "cloud") {
      if (cloudSessionRestoring && !cloudWorkspaceAvailable) {
        setActiveView("cloud");
        setSidebarCollapsed(false);
        setSwitcherOpen(false);
        return;
      }
    }

    setActiveView(view);
    setSidebarCollapsed(false);
    setSwitcherOpen(false);
  }, [cloudSessionRestoring, cloudWorkspaceAvailable]);

  const handleActiveDataPathChange = useCallback((path: string | null) => {
    setActiveDataPath(path);
  }, []);

  const handleFilesVisibilitySettingsChange = useCallback((nextSettings: FilesVisibilitySettings) => {
    setFilesVisibilitySettings(nextSettings);
    setWorkspaceRefreshToken((token) => token + 1);
  }, []);

  const handlePuppyoneConfigChange = useCallback(async (nextConfig: PuppyoneWorkspaceConfig) => {
    const savedConfig = await savePuppyoneConfig(nextConfig);
    if (savedConfig) setWorkspaceRefreshToken((token) => token + 1);
    return savedConfig;
  }, [savePuppyoneConfig]);

  useEffect(() => {
    let cancelled = false;

    getLastWorkspace()
      .then((result) => {
        if (cancelled) return;
        if (result.workspace) {
          openWorkspace(result.workspace, { remember: false });
          return;
        }
        if (result.error) setRestoreWorkspaceError(result.error);
      })
      .catch((error) => {
        if (!cancelled) {
          setRestoreWorkspaceError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setRestoringWorkspace(false);
      });

    return () => {
      cancelled = true;
    };
  }, [openWorkspace]);

  const openFolder = async () => {
    const nextWorkspace = await selectWorkspaceFolder();
    if (nextWorkspace) openWorkspace(nextWorkspace);
    setSwitcherOpen(false);
  };

  const handleCloudSessionChange = useCallback((session: DesktopCloudSession | null) => {
    updateCloudSession(session);
    if (!session) {
      setActiveView("cloud");
      setActiveCloudSection("overview");
      setSidebarCollapsed(false);
      setSwitcherOpen(false);
    }
  }, [updateCloudSession]);

  const handleConfigureCloudRemote = useCallback(async (remoteUrl: string) => {
    if (!workspace) return null;
    const nextStatus = await configureWorkspaceCloudRemote(workspace.path, remoteUrl, "puppyone");
    const branch = nextStatus.branch && nextStatus.branch !== "detached" ? nextStatus.branch : null;
    const nextConfig = mergePuppyoneWorkspaceConfig(puppyoneConfig, {
      sync: {
        sourceOfTruth: {
          service: "puppyone",
          remote: "puppyone",
          branch,
        },
      },
      backup: {
        enabled: true,
        service: "puppyone",
        remote: "puppyone",
        branch,
      },
      git: {
        primaryRemote: "puppyone",
        watchedBranch: branch,
      },
    });
    await handlePuppyoneConfigChange(nextConfig);
    applyGitStatus(nextStatus, workspace.path);
    refreshWorkspaceContent();
    return nextStatus;
  }, [applyGitStatus, handlePuppyoneConfigChange, puppyoneConfig, refreshWorkspaceContent, workspace]);

  const createPuppyoneCloudBackup = useCallback(async (session: DesktopCloudSession) => {
    if (!workspace) return false;

    setCloudBackupLoading(true);
    setCloudBackupError(null);
    setGitOperationLoading("cloud-backup");
    setGitOperationError(null);

    try {
      let nextStatus = activeGitStatus;
      if (!nextStatus) {
        nextStatus = await getWorkspaceGitStatus(workspace.path);
      }

      if (!nextStatus.isRepo) {
        nextStatus = await initializeWorkspaceGitRepository(workspace.path);
      }

      const localChangeCount =
        nextStatus.stagedEntries.length +
        nextStatus.unstagedEntries.length +
        nextStatus.untrackedEntries.length;

      if (localChangeCount > 0) {
        nextStatus = await stageAllWorkspaceGitChanges(workspace.path);
        if (nextStatus.stagedEntries.length > 0) {
          nextStatus = await commitWorkspaceGit(workspace.path, "");
        }
      }

      const project = await createCloudProject(session, workspace.name, handleCloudSessionChange);
      const identity = await getCloudRepoIdentity(session, project.id, handleCloudSessionChange);
      nextStatus = await configureWorkspaceCloudRemote(workspace.path, identity.url, "puppyone");
      const branch = nextStatus.branch && nextStatus.branch !== "detached" ? nextStatus.branch : null;
      const nextConfig = mergePuppyoneWorkspaceConfig(puppyoneConfig, {
        sync: {
          sourceOfTruth: {
            service: "puppyone",
            remote: "puppyone",
            branch,
          },
        },
        backup: {
          enabled: true,
          service: "puppyone",
          remote: "puppyone",
          branch,
        },
        git: {
          primaryRemote: "puppyone",
          watchedBranch: branch,
        },
        cloud: {
          projectId: project.id,
        },
      });
      await handlePuppyoneConfigChange(nextConfig);

      if (nextStatus.headCommitId) {
        nextStatus = await pushWorkspaceGit(workspace.path);
      }

      applyGitStatus(nextStatus, workspace.path);
      refreshWorkspaceContent();
      setPendingCloudBackupSetup(false);
      clearGitSelection();
      setActiveCloudSection("overview");
      setActiveView("cloud");
      setSidebarCollapsed(false);
      setSwitcherOpen(false);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCloudBackupError(message || "Unable to create PuppyOne Cloud backup.");
      setGitOperationError(createGitOperationErrorState(error, "cloud-backup", workspace.path));
      setPendingCloudBackupSetup(false);
      setActiveView("cloud");
      return false;
    } finally {
      setCloudBackupLoading(false);
      setGitOperationLoading(null);
    }
  }, [
    activeGitStatus,
    applyGitStatus,
    clearGitSelection,
    handleCloudSessionChange,
    handlePuppyoneConfigChange,
    puppyoneConfig,
    refreshWorkspaceContent,
    workspace,
  ]);

  const handleStartPuppyoneBackup = useCallback(() => {
    setPendingCloudBackupSetup(true);
    setCloudBackupError(null);
    setGitOperationError(null);

    if (!cloudSession) {
      setActiveView("cloud");
      setActiveCloudSection("overview");
      setSidebarCollapsed(false);
      setSwitcherOpen(false);
    }
  }, [cloudSession]);

  useEffect(() => {
    if (!pendingCloudBackupSetup || !cloudSession || cloudBackupLoading) return;
    void createPuppyoneCloudBackup(cloudSession);
  }, [cloudBackupLoading, cloudSession, createPuppyoneCloudBackup, pendingCloudBackupSetup]);

  useEffect(() => {
    if (!workspace || !window.puppyoneDesktop?.watchWorkspace) return undefined;

    return window.puppyoneDesktop.watchWorkspace(workspace.path, (event) => {
      if (!event.error) {
        setWorkspaceRefreshToken((token) => token + 1);
        void refreshGitStatus();
      }
    });
  }, [refreshGitStatus, workspace]);

  useEffect(() => {
    if (!workspace || !aiEditAssistEnabled) {
      setLatestAiEditRequest(null);
      return undefined;
    }

    const rootPath = workspace.path;
    let cancelled = false;
    setLatestAiEditRequest(null);

    void getLatestAiEditReviewRequest(rootPath)
      .then((request) => {
        if (!cancelled && workspacePathRef.current === rootPath) {
          setLatestAiEditRequest(request);
        }
      })
      .catch((error) => {
        console.warn("Unable to read latest AI edit request:", error);
      });

    const unsubscribe = subscribeAiEditReviewUpdates((event) => {
      if (event.rootPath !== rootPath || workspacePathRef.current !== rootPath) return;
      setLatestAiEditRequest(event.request);
      setWorkspaceRefreshToken((token) => token + 1);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [aiEditAssistEnabled, workspace]);

  const openCreateEntryMenu = useCallback((parentPath: string | null, anchorRect: DOMRect) => {
    setActiveView("data");
    setSidebarCollapsed(false);
    setSwitcherOpen(false);
    setBranchSwitcherOpen(false);
    setNodeActionMenu(null);
    setCreateEntryDraft({
      parentPath,
      anchor: rectToCreateEntryAnchor(anchorRect),
      error: null,
      creatingKind: null,
      selectedKind: null,
      name: "",
    });
  }, []);

  const openNodeActionMenu = useCallback((node: DataNode, anchorRect: DOMRect) => {
    const renameDraft = getDesktopRenameDraft(node);
    setActiveView("data");
    setSidebarCollapsed(false);
    setSwitcherOpen(false);
    setBranchSwitcherOpen(false);
    setCreateEntryDraft(null);
    setNodeActionMenu({
      node,
      anchor: rectToCreateEntryAnchor(anchorRect),
      mode: "actions",
      renameNameValue: renameDraft.nameValue,
      renameExtensionValue: renameDraft.extensionValue,
      renameFocus: "name",
      error: null,
      operation: null,
    });
  }, []);

  const unlinkCurrentWorkspace = useCallback(async () => {
    await forgetLastWorkspace();
    setWorkspaces([]);
    setActiveWorkspaceId(null);
    setActiveView("data");
    setSwitcherOpen(false);
    setBranchSwitcherOpen(false);
    setRightSidebarOpen(false);
    setCreateEntryDraft(null);
    setRestoreWorkspaceError(null);
    setRestoringWorkspace(false);
  }, []);

  const selectCreateEntryKind = useCallback((kind: DesktopCreateEntryKind) => {
    setCreateEntryDraft((current) => current ? {
      ...current,
      selectedKind: kind,
      name: defaultCreateName(kind),
      error: null,
    } : current);
  }, []);

  const createEntryFromMenu = useCallback(async () => {
    if (!workspace || !createEntryDraft || createEntryDraft.creatingKind || !createEntryDraft.selectedKind) return;

    const kind = createEntryDraft.selectedKind;
    let requestedName: string;
    try {
      requestedName = normalizeCreateEntryName(kind, createEntryDraft.name);
    } catch (error) {
      setCreateEntryDraft((current) => current ? {
        ...current,
        error: error instanceof Error ? error.message : String(error),
      } : current);
      return;
    }

    setCreateEntryDraft((current) => current ? { ...current, creatingKind: kind, error: null } : current);
    try {
      const existingChildren = await loadFolderChildren(workspace.path, createEntryDraft.parentPath).catch(() => []);
      const name = uniqueCreateEntryName(requestedName, new Set(existingChildren.map((node) => node.name)));
      const result = await createWorkspaceEntry(workspace.path, {
        parentPath: createEntryDraft.parentPath,
        name,
        kind: kind === "folder" ? "folder" : "file",
        content: getCreateEntryInitialContent(kind),
      });
      setCreateEntryDraft(null);
      setNodeActionMenu(null);
      setActiveView("data");
      setSidebarCollapsed(false);
      setActiveDataPath(result.path ?? joinDataPath(createEntryDraft.parentPath, name));
      setWorkspaceRefreshToken((token) => token + 1);
      void refreshGitStatus();
    } catch (error) {
      setCreateEntryDraft((current) => current ? {
        ...current,
        creatingKind: null,
        error: error instanceof Error ? error.message : String(error),
      } : current);
    }
  }, [createEntryDraft, refreshGitStatus, workspace]);

  const renameNodeFromMenu = useCallback(async () => {
    if (!dataPort?.renameNode || !nodeActionMenu || nodeActionMenu.operation) return;

    let nextName: string;
    try {
      nextName = normalizeDesktopRenameName(nodeActionMenu);
    } catch (error) {
      setNodeActionMenu((current) => current ? {
        ...current,
        error: error instanceof Error ? error.message : String(error),
      } : current);
      return;
    }

    if (nextName === nodeActionMenu.node.name) {
      setNodeActionMenu(null);
      return;
    }

    if (nodeActionMenu.node.type !== "folder") {
      const previousExtension = getDesktopNodeExtension(nodeActionMenu.node.name);
      const nextExtension = getDesktopNodeExtension(nextName);
      if (normalizeDesktopExtension(previousExtension) !== normalizeDesktopExtension(nextExtension)) {
        const confirmed = window.confirm(
          `Change file type from ${formatDesktopExtensionLabel(previousExtension)} to ${formatDesktopExtensionLabel(nextExtension)}? File content will stay unchanged.`,
        );
        if (!confirmed) return;
      }
    }

    setNodeActionMenu((current) => current ? { ...current, operation: "rename", error: null } : current);
    const previousPath = nodeActionMenu.node.path;
    const nextPath = joinDataPath(getDataParentPath(previousPath), nextName);

    try {
      await dataPort.renameNode(previousPath, nextName);
      setNodeActionMenu(null);
      setActiveDataPath((current) => remapActivePathAfterRename(current, previousPath, nextPath));
      setWorkspaceRefreshToken((token) => token + 1);
      void refreshGitStatus();
    } catch (error) {
      setNodeActionMenu((current) => current ? {
        ...current,
        operation: null,
        error: error instanceof Error ? error.message : String(error),
      } : current);
    }
  }, [dataPort, nodeActionMenu, refreshGitStatus]);

  const deleteNodeFromMenu = useCallback(async () => {
    if (!dataPort?.deleteNode || !nodeActionMenu || nodeActionMenu.operation) return;

    const { node } = nodeActionMenu;
    const confirmed = window.confirm(`Delete "${node.name}"? This cannot be undone.`);
    if (!confirmed) return;

    setNodeActionMenu((current) => current ? { ...current, operation: "delete", error: null } : current);
    try {
      await dataPort.deleteNode(node.path);
      setNodeActionMenu(null);
      setActiveDataPath((current) => (
        current === node.path || current?.startsWith(`${node.path}/`) ? null : current
      ));
      setWorkspaceRefreshToken((token) => token + 1);
      void refreshGitStatus();
    } catch (error) {
      setNodeActionMenu((current) => current ? {
        ...current,
        operation: null,
        error: error instanceof Error ? error.message : String(error),
      } : current);
    }
  }, [dataPort, nodeActionMenu, refreshGitStatus]);

  if (restoringWorkspace && !workspace) {
    return <RestoringWorkspaceScreen themeMode={themeMode} resolvedTheme={resolvedTheme} />;
  }

  if (!workspace) {
    return (
      <MinimalOnboarding
        onOpenWorkspace={openWorkspace}
        initialError={restoreWorkspaceError}
        themeMode={themeMode}
        resolvedTheme={resolvedTheme}
      />
    );
  }

  const workspaceTitlebarLabel = shortenTitlebarLabel(workspace.name, TITLEBAR_WORKSPACE_LABEL_CHARS);

  const workspaceSwitcher = (
    <DesktopWorkspaceSwitcher
      open={switcherOpen}
      refObject={switcherRef}
      titlebarLabel={workspaceTitlebarLabel}
      workspace={workspace}
      workspaces={workspaces}
      onOpenFolder={openFolder}
      onOpenWorkspace={openWorkspace}
      onToggle={() => {
        setBranchSwitcherOpen(false);
        setSwitcherOpen((open) => !open);
      }}
    />
  );

  const branchReady = activeGitStatus?.isRepo === true;
  const branchLabel = branchReady ? (activeGitStatus.branch ?? "detached") : gitStatusLoading ? "Loading" : "No Git";
  const branchTitlebarLabel = shortenTitlebarLabel(branchLabel, TITLEBAR_BRANCH_LABEL_CHARS);
  const branchButtonDisabled = gitStatusLoading && !activeGitStatus;

  const branchSwitcher = (
    <div className="desktop-titlebar-branch-wrap" ref={branchSwitcherRef}>
      <button
        className="desktop-titlebar-branch-button"
        type="button"
        aria-label={branchReady ? `Switch branch: ${branchLabel}` : "Open Source Control"}
        aria-expanded={branchReady ? branchSwitcherOpen : false}
        title={branchReady ? branchLabel : "Open Source Control"}
        disabled={branchButtonDisabled}
        onClick={() => {
          if (!branchReady) {
            setActiveView("git");
            setSidebarCollapsed(false);
            setSwitcherOpen(false);
            setBranchSwitcherOpen(false);
            return;
          }
          setSwitcherOpen(false);
          setBranchSwitcherOpen((open) => !open);
        }}
      >
        <PuppyGitIcon size={13} />
        <span>{branchTitlebarLabel}</span>
        {branchReady && <ChevronDown size={12} />}
      </button>

      {branchReady && branchSwitcherOpen && (
        <div className="desktop-branch-menu desktop-titlebar-menu">
          <BranchMenuGroup
            title="Local"
            branches={localBranches}
            operationLoading={gitOperationLoading}
            onCheckout={handleCheckoutGitBranch}
            onDone={() => setBranchSwitcherOpen(false)}
          />
          {remoteBranches.length > 0 && (
            <BranchMenuGroup
              title="Remote"
              branches={remoteBranches}
              operationLoading={gitOperationLoading}
              onCheckout={handleCheckoutGitBranch}
              onDone={() => setBranchSwitcherOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );

  const titlebarSlot = (
    <div className="desktop-titlebar-context">
      {workspaceSwitcher}
      {branchSwitcher}
    </div>
  );

  const titlebarActions = (
    <DesktopTitlebarActions
      desktopUpdates={desktopUpdates}
      terminalSidebarOpen={terminalSidebarOpen}
      terminalToolEnabled={terminalToolEnabled}
      onClearTerminal={() => {
        setTerminalResetToken((token) => token + 1);
        setSwitcherOpen(false);
      }}
      onToggleTerminal={() => {
        setRightSidebarOpen((open) => !open);
        setSwitcherOpen(false);
      }}
      onUpdateNow={() => {
        void desktopUpdates.updateNow();
        setSwitcherOpen(false);
      }}
    />
  );

  return (
    <div className={`app-shell cloud-runtime ${resolvedTheme === "dark" ? "dark" : ""}`} data-theme-mode={themeMode}>
      <DesktopCloudShell
        titlebarSlot={titlebarSlot}
        titlebarActions={titlebarActions}
        rightSidebarOpen={terminalSidebarOpen}
        resizableRightSidebar
        rightSidebarWidth={rightSidebarWidth}
        minRightSidebarWidth={MIN_RIGHT_SIDEBAR_WIDTH}
        maxRightSidebarWidth={MAX_RIGHT_SIDEBAR_WIDTH}
        onRightSidebarWidthChange={setRightSidebarWidth}
        rightSidebar={terminalToolEnabled ? (
          <RightTerminalPanel
            key={`${workspace.path}:${terminalResetToken}`}
            workspace={workspace}
            active={terminalSidebarOpen}
          />
        ) : undefined}
      >
        <DesktopWorkspaceContent
          activeAiEditRequest={activeAiEditRequest}
          activeDataPath={activeDataPath}
          activeView={activeView}
          cloud={{
            activeSection: activeCloudSection,
            backupError: cloudBackupError,
            backupLoading: cloudBackupLoading,
            cloudSession,
            sessionRestoring: cloudSessionRestoring,
            onCloudSessionChange: handleCloudSessionChange,
            onConfigureCloudRemote: handleConfigureCloudRemote,
            onOpenDetails: () => {
              setActiveView("cloud");
              setActiveCloudSection("overview");
              setSidebarCollapsed(false);
              setSwitcherOpen(false);
            },
            onOpenGitSettings: () => {
              setActiveSettingsSection("git");
              navigateDesktopView("settings");
            },
            onSelectSection: setActiveCloudSection,
            onStartPuppyoneBackup: handleStartPuppyoneBackup,
          }}
          dataPort={dataPort}
          desktopUpdates={desktopUpdates}
          git={git}
          onActiveDataPathChange={handleActiveDataPathChange}
          onCreateEntryMenu={openCreateEntryMenu}
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
          workspace={workspace}
          workspaceKey={workspaceKey}
          workspaceRefreshToken={workspaceRefreshToken}
        />
      </DesktopCloudShell>
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
      {gitOperationError && !pendingBranchSwitch && (
        <GitOperationErrorDialog
          error={gitOperationError}
          onClose={dismissGitOperationError}
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
            fileIconTheme={fileIconTheme}
            onCancel={() => setCreateEntryDraft(null)}
            onSelectKind={selectCreateEntryKind}
          />
        )
      )}
      {nodeActionMenu && (
        <DesktopNodeActionMenu
          draft={nodeActionMenu}
          onChange={setNodeActionMenu}
          onCancel={() => setNodeActionMenu(null)}
          onRename={renameNodeFromMenu}
          onDelete={deleteNodeFromMenu}
        />
      )}
    </div>
  );
}
