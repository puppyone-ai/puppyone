import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataWorkspace, isFileIconThemeId, type DataNode, type DataPort, type FileIconThemeId, type Workspace } from "@puppyone/shared-ui";
import { DesktopCloudShell, type DesktopView } from "./components/DesktopCloudShell";
import {
  CloudServiceMainView,
  CloudServicePanel,
  CloudServiceSidebar,
  GitSidebar,
  GitStatusView,
  SettingsSidebar,
  SettingsView,
  type GitMainPanel,
  type GitWorkingSelection,
  type SettingsSection,
} from "./components/DesktopUtilityViews";
import { MinimalOnboarding } from "./components/MinimalOnboarding";
import { RightTerminalPanel } from "./components/RightTerminalPanel";
import {
  checkoutWorkspaceGitBranch,
  commitAndCheckoutWorkspaceGitBranch,
  commitWorkspaceGit,
  createLocalDataPort,
  createWorkspaceEntry,
  discardWorkspaceGitPaths,
  forgetLastWorkspace,
  getLastWorkspace,
  getWorkspaceGitCommitDetail,
  getWorkspaceGitFileDiff,
  getWorkspaceGitStatus,
  initializeWorkspaceGitRepository,
  loadFolderChildren,
  rememberLastWorkspace,
  selectWorkspaceFolder,
  stageWorkspaceGitPaths,
  stashAndCheckoutWorkspaceGitBranch,
  unstageWorkspaceGitPaths,
} from "./lib/localFiles";
import {
  DEFAULT_SIDEBAR_NAVIGATION_LAYOUT,
  DEFAULT_THEME_MODE,
  FILES_VISIBILITY_STORAGE_KEY,
  FILE_ICON_THEME_STORAGE_KEY,
  RIGHT_SIDEBAR_TOOLS_STORAGE_KEY,
  SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  getSidebarNavigationOrientation,
  getSidebarNavigationPlacement,
  parseFilesVisibilitySettings,
  parseRightSidebarToolsSettings,
  parseSidebarNavigationLayout,
  parseThemeMode,
  type FilesVisibilitySettings,
  type RightSidebarToolsSettings,
  type SidebarNavigationLayout,
  type SidebarNavigationOrientation,
  type ThemeMode,
} from "./preferences";
import type { GitCommitDetail, GitStatusSnapshot } from "./types/electron";
import type { GitBranchSummary } from "./types/electron";
import { AlertTriangle, ChevronDown, Cloud, Eraser, FileText, Folder, GitBranch, MoreVertical, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Settings, SquareTerminal, Trash2, X } from "lucide-react";

const puppyoneLogoUrl = new URL("../public/puppyone-logo.svg", import.meta.url).href;
type OpenWorkspaceOptions = {
  remember?: boolean;
};
type DesktopCreateEntryKind = "folder" | "markdown";
type DesktopCreateEntryAnchor = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};
type DesktopCreateEntryDraft = {
  parentPath: string | null;
  anchor: DesktopCreateEntryAnchor;
  error: string | null;
  creatingKind: DesktopCreateEntryKind | null;
  selectedKind: DesktopCreateEntryKind | null;
  name: string;
};
type DesktopNodeActionMenuDraft = {
  node: DataNode;
  anchor: DesktopCreateEntryAnchor;
  mode: "actions" | "rename";
  renameValue: string;
  error: string | null;
  operation: "rename" | "delete" | null;
};
type PendingBranchSwitch = {
  branchName: string;
  remote: boolean;
  changeCount: number;
  error: string | null;
};

const EXPLORER_WIDTH_STORAGE_KEY = "puppyone.desktop.explorerWidth";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "puppyone.desktop.sidebarCollapsed";
const RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = "puppyone.desktop.rightSidebarWidth";
const DEFAULT_EXPLORER_WIDTH = 320;
const MIN_EXPLORER_WIDTH = 240;
const MAX_EXPLORER_WIDTH = 520;
const COLLAPSED_EXPLORER_WIDTH = 0;
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 560;
const MIN_RIGHT_SIDEBAR_WIDTH = 420;
const MAX_RIGHT_SIDEBAR_WIDTH = 760;
const CREATE_ENTRY_PICKER_MENU_WIDTH = 168;
const CREATE_ENTRY_NAME_MENU_WIDTH = 260;
const CREATE_ENTRY_MENU_ESTIMATED_HEIGHT = 154;
const CREATE_ENTRY_MENU_MARGIN = 12;
const NODE_ACTION_MENU_WIDTH = 160;
const NODE_ACTION_MENU_ESTIMATED_HEIGHT = 112;
const TITLEBAR_WORKSPACE_LABEL_CHARS = 12;
const TITLEBAR_BRANCH_LABEL_CHARS = 24;
const CLOUD_ACCOUNT_EMAIL_STORAGE_KEY = "puppyone.desktop.cloudAccountEmail";

function hasPuppyoneCloudRemote(status: GitStatusSnapshot | null) {
  return Boolean(status?.remotes.some((remote) => isPuppyoneCloudRemoteUrl(remote.fetchUrl ?? remote.pushUrl)));
}

function isPuppyoneCloudRemoteUrl(rawUrl: string | null) {
  if (!rawUrl) return false;

  try {
    const url = new URL(rawUrl);
    return /^\/git\/ap\/[^/]+\.git$/.test(url.pathname) || /^\/git\/[^/]+\.git$/.test(url.pathname);
  } catch {
    return false;
  }
}

function readStoredCloudAccountEmail() {
  try {
    const value = window.localStorage.getItem(CLOUD_ACCOUNT_EMAIL_STORAGE_KEY);
    return value && value.includes("@") ? value : null;
  } catch {
    return null;
  }
}

function RestoringWorkspaceScreen() {
  return (
    <main className="onboarding-shell">
      <div className="onboarding-panel">
        <img src={puppyoneLogoUrl} alt="" className="onboarding-logo" />
        <h1>Opening last workspace</h1>
        <p className="onboarding-copy">Restoring your local puppyone workspace...</p>
      </div>
    </main>
  );
}

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DesktopView>("data");
  const [cloudPanelOpen, setCloudPanelOpen] = useState(false);
  const [cloudAccountEmail, setCloudAccountEmail] = useState<string | null>(() => readStoredCloudAccountEmail());
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatusSnapshot | null>(null);
  const [gitStatusPath, setGitStatusPath] = useState<string | null>(null);
  const [gitStatusLoading, setGitStatusLoading] = useState(false);
  const [gitStatusError, setGitStatusError] = useState<string | null>(null);
  const [selectedGitCommitId, setSelectedGitCommitId] = useState<string | null>(null);
  const [selectedGitWorkingFile, setSelectedGitWorkingFile] = useState<GitWorkingSelection | null>(null);
  const [gitMainPanel, setGitMainPanel] = useState<GitMainPanel>("changes");
  const [gitCommitDetail, setGitCommitDetail] = useState<GitCommitDetail | null>(null);
  const [gitCommitDetailLoading, setGitCommitDetailLoading] = useState(false);
  const [gitCommitDetailError, setGitCommitDetailError] = useState<string | null>(null);
  const [gitWorkingFileDiff, setGitWorkingFileDiff] = useState<GitCommitDetail | null>(null);
  const [gitWorkingFileDiffLoading, setGitWorkingFileDiffLoading] = useState(false);
  const [gitWorkingFileDiffError, setGitWorkingFileDiffError] = useState<string | null>(null);
  const [gitOperationLoading, setGitOperationLoading] = useState<string | null>(null);
  const [gitOperationError, setGitOperationError] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readInitialThemeMode());
  const [fileIconTheme, setFileIconTheme] = useState<FileIconThemeId>(() => readInitialFileIconTheme());
  const [sidebarNavigationLayout, setSidebarNavigationLayout] = useState<SidebarNavigationLayout>(() => readInitialSidebarNavigationLayout());
  const [filesVisibilitySettings, setFilesVisibilitySettings] = useState<FilesVisibilitySettings>(() => readInitialFilesVisibilitySettings());
  const [rightSidebarToolsSettings, setRightSidebarToolsSettings] = useState<RightSidebarToolsSettings>(() => readInitialRightSidebarToolsSettings());
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>("workspace");
  const [explorerWidth, setExplorerWidth] = useState(() => readInitialExplorerWidth());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readInitialSidebarCollapsed());
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => readInitialRightSidebarWidth());
  const [terminalResetToken, setTerminalResetToken] = useState(0);
  const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState(0);
  const [activeDataPath, setActiveDataPath] = useState<string | null>(null);
  const [restoringWorkspace, setRestoringWorkspace] = useState(true);
  const [restoreWorkspaceError, setRestoreWorkspaceError] = useState<string | null>(null);
  const [systemDark, setSystemDark] = useState(() => readSystemDarkMode());
  const switcherRef = useRef<HTMLDivElement>(null);
  const branchSwitcherRef = useRef<HTMLDivElement>(null);
  const workspacePathRef = useRef<string | null>(null);
  const [branchSwitcherOpen, setBranchSwitcherOpen] = useState(false);
  const [pendingBranchSwitch, setPendingBranchSwitch] = useState<PendingBranchSwitch | null>(null);
  const [createEntryDraft, setCreateEntryDraft] = useState<DesktopCreateEntryDraft | null>(null);
  const [nodeActionMenu, setNodeActionMenu] = useState<DesktopNodeActionMenuDraft | null>(null);

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === activeWorkspaceId) ?? workspaces[0] ?? null,
    [activeWorkspaceId, workspaces],
  );
  const workspaceKey = useMemo(() => workspace?.path ?? "no-workspace", [workspace?.path]);
  const localDataPort = useMemo(
    () => (workspace ? createLocalDataPort(workspace.path) : null),
    [workspace],
  );
  const dataPort = useMemo(
    () => (localDataPort ? createExplorerDataPort(localDataPort, filesVisibilitySettings) : null),
    [filesVisibilitySettings, localDataPort],
  );
  const resolvedTheme = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;
  const activeGitStatus = gitStatusPath === workspace?.path ? gitStatus : null;
  const cloudWorkspaceAvailable = useMemo(
    () => Boolean(cloudAccountEmail) || hasPuppyoneCloudRemote(activeGitStatus),
    [activeGitStatus, cloudAccountEmail],
  );
  const sidebarNavigationPlacement = getSidebarNavigationPlacement(sidebarNavigationLayout);
  const sidebarNavigationOrientation = getSidebarNavigationOrientation(sidebarNavigationLayout);
  const terminalToolEnabled = rightSidebarToolsSettings.enabled.terminal;
  const terminalSidebarOpen = terminalToolEnabled && rightSidebarOpen;

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    window.localStorage.setItem(FILE_ICON_THEME_STORAGE_KEY, fileIconTheme);
  }, [fileIconTheme]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY, sidebarNavigationLayout);
  }, [sidebarNavigationLayout]);

  useEffect(() => {
    window.localStorage.setItem(FILES_VISIBILITY_STORAGE_KEY, JSON.stringify(filesVisibilitySettings));
  }, [filesVisibilitySettings]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_SIDEBAR_TOOLS_STORAGE_KEY, JSON.stringify(rightSidebarToolsSettings));
  }, [rightSidebarToolsSettings]);

  useEffect(() => {
    if (!terminalToolEnabled && rightSidebarOpen) setRightSidebarOpen(false);
  }, [rightSidebarOpen, terminalToolEnabled]);

  useEffect(() => {
    window.localStorage.setItem(EXPLORER_WIDTH_STORAGE_KEY, String(explorerWidth));
  }, [explorerWidth]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? "true" : "false");
  }, [sidebarCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY, String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

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
    setGitStatus(null);
    setGitStatusPath(null);
    setGitStatusError(null);
    setSelectedGitCommitId(null);
    setSelectedGitWorkingFile(null);
    setGitCommitDetail(null);
    setGitCommitDetailError(null);
    setGitCommitDetailLoading(false);
    setGitWorkingFileDiff(null);
    setGitWorkingFileDiffError(null);
    setGitWorkingFileDiffLoading(false);
    setGitOperationError(null);
    setGitOperationLoading(null);
    setActiveSettingsSection("workspace");
    setBranchSwitcherOpen(false);
    setCloudPanelOpen(false);
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
    setCloudPanelOpen(false);
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
    if (view === "cloud" && !cloudWorkspaceAvailable) {
      setCloudPanelOpen(true);
      setSwitcherOpen(false);
      return;
    }

    setActiveView(view);
    setCloudPanelOpen(false);
    setSidebarCollapsed(false);
    setSwitcherOpen(false);
  }, [cloudWorkspaceAvailable]);

  const handleActiveDataPathChange = useCallback((path: string | null) => {
    setActiveDataPath(path);
  }, []);

  const handleFilesVisibilitySettingsChange = useCallback((nextSettings: FilesVisibilitySettings) => {
    setFilesVisibilitySettings(nextSettings);
    setWorkspaceRefreshToken((token) => token + 1);
  }, []);

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

  const refreshGitStatus = useCallback(async () => {
    if (!workspace) return;
    const rootPath = workspace.path;
    setGitStatusLoading(true);
    setGitStatusError(null);
    try {
      const nextStatus = await getWorkspaceGitStatus(rootPath);
      if (workspacePathRef.current !== rootPath) return;
      setGitStatus(nextStatus);
      setGitStatusPath(rootPath);
    } catch (error) {
      if (workspacePathRef.current !== rootPath) return;
      setGitStatus(null);
      setGitStatusPath(null);
      setGitStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      if (workspacePathRef.current === rootPath) setGitStatusLoading(false);
    }
  }, [workspace]);

  const handleCloudSignedIn = useCallback((email: string) => {
    setCloudAccountEmail(email);
    try {
      window.localStorage.setItem(CLOUD_ACCOUNT_EMAIL_STORAGE_KEY, email);
    } catch {
      // Local storage is best-effort; the current session still unlocks Cloud.
    }
    setCloudPanelOpen(false);
    setActiveView("cloud");
    setSidebarCollapsed(false);
    setSwitcherOpen(false);
    void refreshGitStatus();
  }, [refreshGitStatus]);

  const enterCloudView = useCallback(() => {
    setCloudPanelOpen(false);
    setActiveView("cloud");
    setSidebarCollapsed(false);
    setSwitcherOpen(false);
  }, []);

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
    void refreshGitStatus();
  }, [refreshGitStatus]);

  useEffect(() => {
    if (activeView !== "git" || !activeGitStatus?.isRepo) return;

    const historyCommits = activeGitStatus.allCommits ?? activeGitStatus.commits;
    const selectedCommitExists = selectedGitCommitId
      ? historyCommits.some((commit) => commit.commit_id === selectedGitCommitId)
      : false;

    if (gitMainPanel === "history") {
      if (!selectedGitCommitId || !selectedCommitExists) {
        setSelectedGitCommitId(historyCommits[0]?.commit_id ?? null);
      }
    } else if (selectedGitCommitId && !selectedCommitExists) {
      setSelectedGitCommitId(null);
    }

    if (selectedGitWorkingFile) {
      const source = selectedGitWorkingFile.staged ? activeGitStatus.stagedEntries : [
        ...activeGitStatus.unstagedEntries,
        ...activeGitStatus.untrackedEntries,
      ];
      if (!source.some((entry) => entry.path === selectedGitWorkingFile.path)) {
        setSelectedGitWorkingFile(null);
      }
    }

  }, [activeGitStatus, activeView, gitMainPanel, selectedGitCommitId, selectedGitWorkingFile]);

  useEffect(() => {
    if (activeView !== "git" || !workspace || !selectedGitCommitId) {
      setGitCommitDetail(null);
      setGitCommitDetailError(null);
      setGitCommitDetailLoading(false);
      return undefined;
    }

    let cancelled = false;
    setGitCommitDetailLoading(true);
    setGitCommitDetailError(null);
    getWorkspaceGitCommitDetail(workspace.path, selectedGitCommitId)
      .then((detail) => {
        if (!cancelled) setGitCommitDetail(detail);
      })
      .catch((error) => {
        if (!cancelled) {
          setGitCommitDetail(null);
          setGitCommitDetailError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setGitCommitDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeView, selectedGitCommitId, workspace]);

  useEffect(() => {
    if (activeView !== "git" || !workspace || !selectedGitWorkingFile) {
      setGitWorkingFileDiff(null);
      setGitWorkingFileDiffError(null);
      setGitWorkingFileDiffLoading(false);
      return undefined;
    }

    let cancelled = false;
    const scope = selectedGitWorkingFile.staged
      ? "staged"
      : selectedGitWorkingFile.status === "untracked"
        ? "untracked"
        : "unstaged";

    setGitWorkingFileDiffLoading(true);
    setGitWorkingFileDiffError(null);
    getWorkspaceGitFileDiff(workspace.path, selectedGitWorkingFile.path, scope)
      .then((detail) => {
        if (!cancelled) setGitWorkingFileDiff(detail);
      })
      .catch((error) => {
        if (!cancelled) {
          setGitWorkingFileDiff(null);
          setGitWorkingFileDiffError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setGitWorkingFileDiffLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeView, selectedGitWorkingFile, workspace]);

  const runGitOperation = useCallback(async (
    label: string,
    operation: (rootPath: string) => Promise<GitStatusSnapshot>,
  ) => {
    if (!workspace) return false;

    setGitOperationLoading(label);
    setGitOperationError(null);
    try {
      const nextStatus = await operation(workspace.path);
      setGitStatus(nextStatus);
      setWorkspaceRefreshToken((token) => token + 1);
      return true;
    } catch (error) {
      setGitOperationError(formatGitOperationError(error, label));
      return false;
    } finally {
      setGitOperationLoading(null);
    }
  }, [workspace]);

  const selectGitCommit = useCallback((commitId: string) => {
    setGitMainPanel("history");
    setSelectedGitCommitId(commitId);
    setSelectedGitWorkingFile(null);
    setGitOperationError(null);
  }, []);

  const selectGitWorkingFile = useCallback((selection: GitWorkingSelection | null) => {
    if (selection) setGitMainPanel("changes");
    setSelectedGitWorkingFile(selection);
    setSelectedGitCommitId(null);
    setGitOperationError(null);
  }, []);

  const selectGitMainPanel = useCallback((panel: GitMainPanel) => {
    setGitMainPanel(panel);
    setGitOperationError(null);
    if (panel === "changes") {
      setSelectedGitCommitId(null);
    } else {
      const historyCommits = activeGitStatus?.allCommits ?? activeGitStatus?.commits ?? [];
      setSelectedGitWorkingFile(null);
      setSelectedGitCommitId((current) => current ?? historyCommits[0]?.commit_id ?? null);
    }
  }, [activeGitStatus]);

  const handleStageGitPaths = useCallback((paths: string[]) => {
    return runGitOperation("stage", (rootPath) => stageWorkspaceGitPaths(rootPath, paths));
  }, [runGitOperation]);

  const handleUnstageGitPaths = useCallback((paths: string[]) => {
    return runGitOperation("unstage", (rootPath) => unstageWorkspaceGitPaths(rootPath, paths));
  }, [runGitOperation]);

  const handleDiscardGitPaths = useCallback((paths: string[]) => {
    const label = paths.length === 1 ? paths[0] : `${paths.length} files`;
    if (!window.confirm(`Discard local changes in ${label}? This cannot be undone.`)) {
      return Promise.resolve(false);
    }
    return runGitOperation("discard", (rootPath) => discardWorkspaceGitPaths(rootPath, paths));
  }, [runGitOperation]);

  const handleCommitGit = useCallback(async (message: string) => {
    const committed = await runGitOperation("commit", (rootPath) => commitWorkspaceGit(rootPath, message));
    if (committed) {
      setSelectedGitWorkingFile(null);
      setSelectedGitCommitId(null);
    }
    return committed;
  }, [runGitOperation]);

  const handleCheckoutGitBranch = useCallback(async (branchName: string, remote: boolean) => {
    if (!workspace || gitStatusPath !== workspace.path || !activeGitStatus?.isRepo) {
      setGitOperationError("Current workspace is not a Git repository.");
      return false;
    }

    setGitOperationLoading("checkout");
    setGitOperationError(null);
    setPendingBranchSwitch(null);
    try {
      const nextStatus = await checkoutWorkspaceGitBranch(workspace.path, branchName, remote);
      setGitStatus(nextStatus);
      setWorkspaceRefreshToken((token) => token + 1);
      setSelectedGitCommitId(null);
      setSelectedGitWorkingFile(null);
      setGitMainPanel("changes");
      return true;
    } catch (error) {
      const formatted = formatGitOperationError(error, "checkout");
      if (isBranchOverwriteError(formatted)) {
        setPendingBranchSwitch({
          branchName,
          remote,
          changeCount: getGitChangeCount(activeGitStatus),
          error: null,
        });
        setBranchSwitcherOpen(false);
      } else {
        setGitOperationError(formatted);
      }
      return false;
    } finally {
      setGitOperationLoading(null);
    }
  }, [activeGitStatus, gitStatusPath, workspace]);

  const handleStashAndCheckoutBranch = useCallback(async () => {
    if (!workspace || !pendingBranchSwitch) return false;

    setGitOperationLoading("stash");
    setGitOperationError(null);
    try {
      const nextStatus = await stashAndCheckoutWorkspaceGitBranch(
        workspace.path,
        pendingBranchSwitch.branchName,
        pendingBranchSwitch.remote,
      );
      setGitStatus(nextStatus);
      setWorkspaceRefreshToken((token) => token + 1);
      setSelectedGitCommitId(null);
      setSelectedGitWorkingFile(null);
      setGitMainPanel("changes");
      setPendingBranchSwitch(null);
      return true;
    } catch (error) {
      const formatted = formatGitOperationError(error, "checkout");
      setGitOperationError(formatted);
      setPendingBranchSwitch((current) => current ? { ...current, error: "Could not stash changes. Review changes and try again." } : current);
      return false;
    } finally {
      setGitOperationLoading(null);
    }
  }, [pendingBranchSwitch, workspace]);

  const handleCommitAndCheckoutBranch = useCallback(async () => {
    if (!workspace || !pendingBranchSwitch) return false;

    setGitOperationLoading("commit-switch");
    setGitOperationError(null);
    try {
      const nextStatus = await commitAndCheckoutWorkspaceGitBranch(
        workspace.path,
        pendingBranchSwitch.branchName,
        pendingBranchSwitch.remote,
      );
      setGitStatus(nextStatus);
      setWorkspaceRefreshToken((token) => token + 1);
      setSelectedGitCommitId(null);
      setSelectedGitWorkingFile(null);
      setGitMainPanel("changes");
      setPendingBranchSwitch(null);
      return true;
    } catch (error) {
      const formatted = formatGitOperationError(error, "commit-switch");
      setGitOperationError(formatted);
      setPendingBranchSwitch((current) => current ? { ...current, error: formatted || "Could not commit changes." } : current);
      return false;
    } finally {
      setGitOperationLoading(null);
    }
  }, [pendingBranchSwitch, workspace]);

  const handleInitializeGitRepository = useCallback(async () => {
    const initialized = await runGitOperation("init", (rootPath) => initializeWorkspaceGitRepository(rootPath));
    if (initialized) {
      setActiveView("git");
      setGitMainPanel("changes");
      setSelectedGitCommitId(null);
      setSelectedGitWorkingFile(null);
    }
    return initialized;
  }, [runGitOperation]);

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
    setActiveView("data");
    setSidebarCollapsed(false);
    setSwitcherOpen(false);
    setBranchSwitcherOpen(false);
    setCreateEntryDraft(null);
    setNodeActionMenu({
      node,
      anchor: rectToCreateEntryAnchor(anchorRect),
      mode: "actions",
      renameValue: node.name,
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
        content: "",
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

    const nextName = nodeActionMenu.renameValue.trim();
    if (!nextName) {
      setNodeActionMenu((current) => current ? { ...current, error: "Name is required." } : current);
      return;
    }
    if (nextName === nodeActionMenu.node.name) {
      setNodeActionMenu(null);
      return;
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
    return <RestoringWorkspaceScreen />;
  }

  if (!workspace) {
    return <MinimalOnboarding onOpenWorkspace={openWorkspace} initialError={restoreWorkspaceError} />;
  }

  const localBranches = activeGitStatus?.branches.filter((branch) => !branch.remote) ?? [];
  const remoteBranches = activeGitStatus?.branches.filter((branch) => branch.remote) ?? [];
  const workspaceTitlebarLabel = shortenTitlebarLabel(workspace.name, TITLEBAR_WORKSPACE_LABEL_CHARS);

  const workspaceSwitcher = (
    <div className="desktop-titlebar-workspace-wrap" ref={switcherRef}>
      <button
        className="desktop-titlebar-workspace-button"
        type="button"
        aria-label={`Switch workspace: ${workspace.name}`}
        aria-expanded={switcherOpen}
        title={workspace.name}
        onClick={() => {
          setBranchSwitcherOpen(false);
          setSwitcherOpen((open) => !open);
        }}
      >
        <span className="desktop-titlebar-workspace-mark">{workspace.name[0]?.toUpperCase() ?? "P"}</span>
        <span className="desktop-titlebar-workspace-name">{workspaceTitlebarLabel}</span>
        <ChevronDown size={12} />
      </button>

      {switcherOpen && (
        <div className="desktop-project-menu desktop-titlebar-menu">
          {workspaces.map((item) => (
            <button
              key={item.id}
              className={`desktop-project-option ${item.id === workspace.id ? "active" : ""}`}
              type="button"
              title={`${item.name} - ${item.path}`}
              onClick={() => {
                openWorkspace(item);
              }}
            >
              <span className="desktop-project-mark">{item.name[0]?.toUpperCase() ?? "P"}</span>
              <span className="desktop-project-option-text">
                <strong>{item.name}</strong>
                <small>{item.path}</small>
              </span>
            </button>
          ))}
          <button className="desktop-project-add" type="button" onClick={openFolder}>
            <Plus size={14} />
            <span>Open local folder</span>
          </button>
        </div>
      )}
    </div>
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
            setGitOperationError(null);
            return;
          }
          setSwitcherOpen(false);
          setGitOperationError(null);
          setBranchSwitcherOpen((open) => !open);
        }}
      >
        <GitBranch size={13} />
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
          {gitOperationError && (
            <div className="desktop-branch-menu-error" role="status">
              <span>{gitOperationError}</span>
              <button
                className="desktop-branch-menu-action"
                type="button"
                onClick={() => {
                  setActiveView("git");
                  setSidebarCollapsed(false);
                  setBranchSwitcherOpen(false);
                }}
              >
                View Changes
              </button>
            </div>
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

  const titlebarActions = terminalToolEnabled ? (
    <>
      {terminalSidebarOpen && (
        <button
          className="desktop-titlebar-action"
          type="button"
          title="Clear terminal"
          aria-label="Clear terminal"
          onClick={() => {
            setTerminalResetToken((token) => token + 1);
            setSwitcherOpen(false);
          }}
        >
          <Eraser size={15} />
        </button>
      )}
      <button
        className="desktop-titlebar-action"
        type="button"
        title={terminalSidebarOpen ? "Hide terminal" : "Show terminal"}
        aria-label={terminalSidebarOpen ? "Hide terminal" : "Show terminal"}
        aria-pressed={terminalSidebarOpen}
        onClick={() => {
          setRightSidebarOpen((open) => !open);
          setSwitcherOpen(false);
        }}
      >
        <SquareTerminal size={16} />
      </button>
    </>
  ) : null;

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
        {dataPort ? (
          <DataWorkspace
            key={workspaceKey}
            workspace={workspace}
            dataPort={dataPort}
            activePath={activeDataPath}
            onActivePathChange={handleActiveDataPathChange}
            resizableExplorer
            explorerCollapsed={sidebarCollapsed}
            explorerWidth={explorerWidth}
            minExplorerWidth={MIN_EXPLORER_WIDTH}
            maxExplorerWidth={MAX_EXPLORER_WIDTH}
            collapsedExplorerWidth={COLLAPSED_EXPLORER_WIDTH}
            onExplorerWidthChange={setExplorerWidth}
            onExplorerCollapsedChange={setSidebarCollapsed}
            collapsedExplorerSlot={
              <button
                className="desktop-sidebar-restore-button"
                type="button"
                title="Expand sidebar"
                aria-label="Expand sidebar"
                onClick={() => {
                  setSidebarCollapsed(false);
                  setSwitcherOpen(false);
                }}
              >
                <PanelLeftOpen size={16} />
              </button>
            }
            showHeader={false}
            showExplorerToolbar={sidebarNavigationPlacement === "top"}
            explorerToolbarSlot={sidebarNavigationPlacement === "top" ? (
              <DesktopSidebarTopNavigation
                activeView={activeView}
                orientation={sidebarNavigationOrientation}
                sidebarCollapsed={sidebarCollapsed}
                onNavigate={navigateDesktopView}
                onOpenSettings={() => navigateDesktopView("settings")}
                onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
              />
            ) : undefined}
            showPreviewHeader={false}
            hidePreviewSourceView
            fileIconTheme={fileIconTheme}
            editorSaveMode="auto"
            refreshKey={workspaceRefreshToken}
            explorerRootActionSlot={
              <DesktopExplorerRowActions
                parentPath={null}
                onCreate={openCreateEntryMenu}
                onOpenNodeMenu={openNodeActionMenu}
              />
            }
            explorerNodeActionSlot={(_state, node) => (
              <DesktopExplorerRowActions
                node={node}
                parentPath={node.type === "folder" ? node.path : null}
                onCreate={openCreateEntryMenu}
                onOpenNodeMenu={openNodeActionMenu}
              />
            )}
            explorerSlot={activeView === "data" ? undefined : (
              <div className="desktop-view-surface desktop-view-surface-sidebar" data-view={activeView}>
                {activeView === "git" ? (
                  <GitSidebar
                    status={activeGitStatus}
                    fileIconTheme={fileIconTheme}
                    activePanel={gitMainPanel}
                    selectedCommitId={selectedGitCommitId}
                    loading={gitStatusLoading}
                    error={gitStatusError}
                    selectedWorkingFile={selectedGitWorkingFile}
                    operationLoading={gitOperationLoading}
                    operationError={gitOperationError}
                    onSelectPanel={selectGitMainPanel}
                    onSelectCommit={selectGitCommit}
                    onSelectWorkingFile={selectGitWorkingFile}
                    onStagePaths={handleStageGitPaths}
                    onUnstagePaths={handleUnstageGitPaths}
                    onDiscardPaths={handleDiscardGitPaths}
                    onCommit={handleCommitGit}
                    onInitializeRepository={handleInitializeGitRepository}
                  />
                ) : activeView === "cloud" ? (
                  <CloudServiceSidebar
                    workspace={workspace}
                    status={activeGitStatus}
                    accountEmail={cloudAccountEmail}
                    loading={gitStatusLoading}
                    error={gitStatusError}
                    onOpenDetails={() => setCloudPanelOpen(true)}
                    onRefresh={refreshGitStatus}
                    onOpenGitSettings={() => {
                      setActiveSettingsSection("git");
                      navigateDesktopView("settings");
                    }}
                  />
                ) : (
                  <SettingsSidebar
                    activeSection={activeSettingsSection}
                    onSelectSection={setActiveSettingsSection}
                  />
                )}
              </div>
            )}
            explorerFooterSlot={
              sidebarNavigationPlacement === "bottom" ? (
                <DesktopSidebarFooterNavigation
                  activeView={activeView}
                  onNavigate={navigateDesktopView}
                  onOpenSettings={() => navigateDesktopView("settings")}
                  onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
                />
              ) : undefined
            }
            mainSlot={activeView === "git" || activeView === "settings" || activeView === "cloud" ? (
              <div className="desktop-view-surface desktop-view-surface-main" data-view={activeView}>
                {activeView === "git" ? (
                  <GitStatusView
                    workspace={workspace}
                    status={activeGitStatus}
                    activePanel={gitMainPanel}
                    selectedCommitId={selectedGitCommitId}
                    selectedWorkingFile={selectedGitWorkingFile}
                    commitDetail={gitCommitDetail}
                    commitDetailLoading={gitCommitDetailLoading}
                    commitDetailError={gitCommitDetailError}
                    workingFileDiff={gitWorkingFileDiff}
                    workingFileDiffLoading={gitWorkingFileDiffLoading}
                    workingFileDiffError={gitWorkingFileDiffError}
                    operationLoading={gitOperationLoading}
                    operationError={gitOperationError}
                    loading={gitStatusLoading}
                    error={gitStatusError}
                    onRefresh={refreshGitStatus}
                    onStagePaths={handleStageGitPaths}
                    onUnstagePaths={handleUnstageGitPaths}
                    onDiscardPaths={handleDiscardGitPaths}
                    onInitializeRepository={handleInitializeGitRepository}
                  />
                ) : activeView === "cloud" ? (
                  <CloudServiceMainView
                    workspace={workspace}
                    status={activeGitStatus}
                    accountEmail={cloudAccountEmail}
                    loading={gitStatusLoading}
                    error={gitStatusError}
                    onRefresh={refreshGitStatus}
                    onOpenDetails={() => setCloudPanelOpen(true)}
                    onOpenGitSettings={() => {
                      setActiveSettingsSection("git");
                      navigateDesktopView("settings");
                    }}
                  />
                ) : (
                  <SettingsView
                    workspace={workspace}
                    activeSection={activeSettingsSection}
                    gitStatus={activeGitStatus}
                    gitStatusLoading={gitStatusLoading}
                    gitStatusError={gitStatusError}
                    themeMode={themeMode}
                    fileIconTheme={fileIconTheme}
                    sidebarNavigationLayout={sidebarNavigationLayout}
                    filesVisibilitySettings={filesVisibilitySettings}
                    rightSidebarToolsSettings={rightSidebarToolsSettings}
                    onThemeModeChange={setThemeMode}
                    onFileIconThemeChange={setFileIconTheme}
                    onSidebarNavigationLayoutChange={setSidebarNavigationLayout}
                    onFilesVisibilitySettingsChange={handleFilesVisibilitySettingsChange}
                    onRightSidebarToolsSettingsChange={setRightSidebarToolsSettings}
                    onUnlinkWorkspace={unlinkCurrentWorkspace}
                    onRefreshGitStatus={refreshGitStatus}
                  />
                )}
              </div>
            ) : undefined}
            capabilities={{
              create: true,
              rename: true,
              delete: true,
              move: true,
              write: true,
              history: true,
              accessPoints: false,
              cloudSync: false,
              localGit: true,
              connectors: false,
            }}
          />
        ) : (
          activeView === "settings" ? (
            <SettingsView
              workspace={workspace}
              activeSection={activeSettingsSection}
              gitStatus={activeGitStatus}
              gitStatusLoading={gitStatusLoading}
              gitStatusError={gitStatusError}
              themeMode={themeMode}
              fileIconTheme={fileIconTheme}
              sidebarNavigationLayout={sidebarNavigationLayout}
              filesVisibilitySettings={filesVisibilitySettings}
              rightSidebarToolsSettings={rightSidebarToolsSettings}
              onThemeModeChange={setThemeMode}
              onFileIconThemeChange={setFileIconTheme}
              onSidebarNavigationLayoutChange={setSidebarNavigationLayout}
              onFilesVisibilitySettingsChange={handleFilesVisibilitySettingsChange}
              onRightSidebarToolsSettingsChange={setRightSidebarToolsSettings}
              onUnlinkWorkspace={unlinkCurrentWorkspace}
              onRefreshGitStatus={refreshGitStatus}
            />
          ) : activeView === "git" ? (
            <GitStatusView
              workspace={workspace}
              status={activeGitStatus}
              activePanel={gitMainPanel}
              selectedCommitId={selectedGitCommitId}
              selectedWorkingFile={selectedGitWorkingFile}
              commitDetail={gitCommitDetail}
              commitDetailLoading={gitCommitDetailLoading}
              commitDetailError={gitCommitDetailError}
              workingFileDiff={gitWorkingFileDiff}
              workingFileDiffLoading={gitWorkingFileDiffLoading}
              workingFileDiffError={gitWorkingFileDiffError}
              operationLoading={gitOperationLoading}
              operationError={gitOperationError}
              loading={gitStatusLoading}
              error={gitStatusError}
              onRefresh={refreshGitStatus}
              onStagePaths={handleStageGitPaths}
              onUnstagePaths={handleUnstageGitPaths}
              onDiscardPaths={handleDiscardGitPaths}
              onInitializeRepository={handleInitializeGitRepository}
            />
          ) : activeView === "cloud" ? (
            <CloudServiceMainView
              workspace={workspace}
              status={activeGitStatus}
              accountEmail={cloudAccountEmail}
              loading={gitStatusLoading}
              error={gitStatusError}
              onRefresh={refreshGitStatus}
              onOpenDetails={() => setCloudPanelOpen(true)}
              onOpenGitSettings={() => {
                setActiveSettingsSection("git");
                navigateDesktopView("settings");
              }}
            />
          ) : null
        )}
      </DesktopCloudShell>
      {workspace && (
        <CloudServicePanel
          open={cloudPanelOpen}
          workspace={workspace}
          status={activeGitStatus}
          accountEmail={cloudAccountEmail}
          loading={gitStatusLoading}
          error={gitStatusError}
          onClose={() => setCloudPanelOpen(false)}
          onRefresh={refreshGitStatus}
          onSignedIn={handleCloudSignedIn}
          onEnterCloud={enterCloudView}
          onOpenGitSettings={() => {
            setCloudPanelOpen(false);
            setActiveSettingsSection("git");
            navigateDesktopView("settings");
          }}
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
      {createEntryDraft && (
        <DesktopCreateEntryMenu
          draft={createEntryDraft}
          onChange={setCreateEntryDraft}
          onCancel={() => setCreateEntryDraft(null)}
          onSelectKind={selectCreateEntryKind}
          onCreate={createEntryFromMenu}
        />
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

function DesktopExplorerRowActions({
  node,
  parentPath,
  onCreate,
  onOpenNodeMenu,
}: {
  node?: DataNode;
  parentPath: string | null;
  onCreate: (parentPath: string | null, anchorRect: DOMRect) => void;
  onOpenNodeMenu: (node: DataNode, anchorRect: DOMRect) => void;
}) {
  const canCreate = node?.type === "folder" || !node;

  return (
    <>
      {canCreate && (
        <button
          className="tree-row-action-button"
          type="button"
          title="Create new"
          aria-label="Create new"
          onClick={(event) => onCreate(parentPath, event.currentTarget.getBoundingClientRect())}
        >
          <Plus size={13} />
        </button>
      )}
      {node && (
        <button
          className="tree-row-action-button"
          type="button"
          title="More actions"
          aria-label={`More actions for ${node.name}`}
          onClick={(event) => onOpenNodeMenu(node, event.currentTarget.getBoundingClientRect())}
        >
          <MoreVertical size={13} />
        </button>
      )}
    </>
  );
}

function DesktopSidebarFooterNavigation({
  activeView,
  onNavigate,
  onOpenSettings,
  onToggleCollapsed,
}: {
  activeView: DesktopView;
  onNavigate: (view: DesktopView) => void;
  onOpenSettings: () => void;
  onToggleCollapsed: () => void;
}) {
  return (
    <div className="desktop-sidebar-footer-bar actions-only horizontal">
      <div className="desktop-sidebar-footer-actions desktop-sidebar-footer-actions-start">
        <button
          className="desktop-sidebar-footer-button"
          type="button"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          onClick={onToggleCollapsed}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>
      <div className="desktop-sidebar-footer-actions desktop-sidebar-footer-actions-end">
        <DesktopSidebarIconNavigation
          activeView={activeView}
          items={DESKTOP_PRIMARY_SIDEBAR_NAV_ITEMS}
          onNavigate={onNavigate}
        />
        <DesktopSidebarFooterSettingsButton activeView={activeView} onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
}

function DesktopSidebarTopNavigation({
  activeView,
  orientation,
  sidebarCollapsed,
  onNavigate,
  onOpenSettings,
  onToggleCollapsed,
}: {
  activeView: DesktopView;
  orientation: SidebarNavigationOrientation;
  sidebarCollapsed: boolean;
  onNavigate: (view: DesktopView) => void;
  onOpenSettings: () => void;
  onToggleCollapsed: () => void;
}) {
  return (
    <div className={`desktop-sidebar-top-navigation ${orientation}`}>
      <div className="desktop-sidebar-top-navigation-list" aria-label="Workspace navigation">
        {DESKTOP_PRIMARY_SIDEBAR_NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            className={`desktop-sidebar-top-navigation-button ${activeView === item.view ? "active" : ""}`}
            type="button"
            aria-current={activeView === item.view ? "page" : undefined}
            onClick={() => onNavigate(item.view)}
          >
            <item.icon size={16} />
            <span>{item.label}</span>
          </button>
        ))}
        <button
          className={`desktop-sidebar-top-navigation-button ${activeView === "settings" ? "active" : ""}`}
          type="button"
          title="Settings"
          aria-label="Settings"
          aria-current={activeView === "settings" ? "page" : undefined}
          onClick={onOpenSettings}
        >
          <Settings size={16} />
          <span>Settings</span>
        </button>
      </div>
      <button
        className="desktop-sidebar-top-navigation-button desktop-sidebar-top-collapse-button"
        type="button"
        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={onToggleCollapsed}
      >
        {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        <span>{sidebarCollapsed ? "Expand" : "Collapse"}</span>
      </button>
    </div>
  );
}

function DesktopSidebarFooterSettingsButton({
  activeView,
  onOpenSettings,
}: {
  activeView: DesktopView;
  onOpenSettings: () => void;
}) {
  return (
    <button
      className={`desktop-sidebar-footer-button ${activeView === "settings" ? "active" : ""}`}
      type="button"
      title="Settings"
      aria-label="Settings"
      aria-current={activeView === "settings" ? "page" : undefined}
      onClick={onOpenSettings}
    >
      <Settings size={16} />
    </button>
  );
}

function DesktopSidebarIconNavigation({
  activeView,
  items,
  onNavigate,
}: {
  activeView: DesktopView;
  items: typeof DESKTOP_PRIMARY_SIDEBAR_NAV_ITEMS;
  onNavigate: (view: DesktopView) => void;
}) {
  return (
    <>
      {items.map((item) => (
        <button
          key={item.view}
          className={`desktop-sidebar-footer-button ${activeView === item.view ? "active" : ""}`}
          type="button"
          title={item.label}
          aria-label={item.label}
          aria-current={activeView === item.view ? "page" : undefined}
          onClick={() => onNavigate(item.view)}
        >
          <item.icon size={16} />
        </button>
      ))}
    </>
  );
}

const DESKTOP_PRIMARY_SIDEBAR_NAV_ITEMS = [
  { view: "data", label: "Files", icon: Folder },
  { view: "git", label: "Changes", icon: GitBranch },
  { view: "cloud", label: "Cloud", icon: Cloud },
] satisfies Array<{
  view: Extract<DesktopView, "data" | "git" | "cloud">;
  label: string;
  icon: typeof Folder;
}>;

function DesktopCreateEntryMenu({
  draft,
  onChange,
  onCancel,
  onSelectKind,
  onCreate,
}: {
  draft: DesktopCreateEntryDraft;
  onChange: Dispatch<SetStateAction<DesktopCreateEntryDraft | null>>;
  onCancel: () => void;
  onSelectKind: (kind: DesktopCreateEntryKind) => void;
  onCreate: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuWidth = draft.selectedKind ? CREATE_ENTRY_NAME_MENU_WIDTH : CREATE_ENTRY_PICKER_MENU_WIDTH;
  const position = getCreateEntryMenuPosition(draft.anchor, menuWidth);
  const menuStyle = {
    "--create-entry-menu-left": `${position.left}px`,
    "--create-entry-menu-top": `${position.top}px`,
    "--create-entry-menu-width": `${menuWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onCancel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    const handleViewportChange = () => onCancel();

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [onCancel]);

  useEffect(() => {
    if (!draft.selectedKind) return undefined;
    const frame = window.requestAnimationFrame(() => inputRef.current?.select());
    return () => window.cancelAnimationFrame(frame);
  }, [draft.selectedKind]);

  const selectedLabel = draft.selectedKind === "folder" ? "Folder" : "Markdown";

  return (
    <div
      ref={menuRef}
      className={`desktop-create-entry-menu ${draft.selectedKind ? "is-naming" : "is-picker"}`}
      role={draft.selectedKind ? "dialog" : "menu"}
      aria-label="Create new"
      style={menuStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {!draft.selectedKind ? (
        <>
          <DesktopCreateEntryMenuItem
            icon={<Folder size={15} strokeWidth={1.9} />}
            label="Folder"
            disabled={Boolean(draft.creatingKind)}
            onClick={() => onSelectKind("folder")}
          />
          <DesktopCreateEntryMenuItem
            icon={<FileText size={15} strokeWidth={1.9} />}
            label="Markdown"
            disabled={Boolean(draft.creatingKind)}
            onClick={() => onSelectKind("markdown")}
          />
          {draft.error && <div className="desktop-create-entry-error">{draft.error}</div>}
        </>
      ) : (
        <form
          className="desktop-create-entry-form"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate();
          }}
        >
          <div className="desktop-create-entry-form-title">New {selectedLabel}</div>
          <input
            ref={inputRef}
            value={draft.name}
            disabled={draft.creatingKind !== null}
            aria-label={`${selectedLabel} name`}
            onChange={(event) => {
              const value = event.target.value;
              onChange((current) => current ? { ...current, name: value, error: null } : current);
            }}
          />
          {draft.selectedKind === "markdown" && (
            <div className="desktop-create-entry-hint">Names without an extension are saved as .md.</div>
          )}
          <div className="desktop-create-entry-form-actions">
            <button
              type="button"
              disabled={draft.creatingKind !== null}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button type="submit" disabled={draft.creatingKind !== null || !draft.name.trim()}>
              {draft.creatingKind ? "Creating..." : "Create"}
            </button>
          </div>
          {draft.error && <div className="desktop-create-entry-error">{draft.error}</div>}
        </form>
      )}
    </div>
  );
}

function DesktopCreateEntryMenuItem({
  icon,
  label,
  loading,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="desktop-create-entry-menu-item"
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onClick();
      }}
    >
      <span className="desktop-create-entry-menu-icon">{icon}</span>
      <span className="desktop-create-entry-menu-label">{loading ? "Creating..." : label}</span>
    </button>
  );
}

function DesktopNodeActionMenu({
  draft,
  onChange,
  onCancel,
  onRename,
  onDelete,
}: {
  draft: DesktopNodeActionMenuDraft;
  onChange: Dispatch<SetStateAction<DesktopNodeActionMenuDraft | null>>;
  onCancel: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const position = getNodeActionMenuPosition(draft.anchor);
  const menuStyle = {
    "--node-action-menu-left": `${position.left}px`,
    "--node-action-menu-top": `${position.top}px`,
  } as CSSProperties;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      onCancel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    const handleViewportChange = () => onCancel();

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [onCancel]);

  useEffect(() => {
    if (draft.mode !== "rename") return undefined;
    const frame = window.requestAnimationFrame(() => inputRef.current?.select());
    return () => window.cancelAnimationFrame(frame);
  }, [draft.mode]);

  return (
    <div
      ref={menuRef}
      className="desktop-node-action-menu"
      role="menu"
      aria-label={`Actions for ${draft.node.name}`}
      style={menuStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {draft.mode === "rename" ? (
        <form
          className="desktop-node-action-rename"
          onSubmit={(event) => {
            event.preventDefault();
            onRename();
          }}
        >
          <input
            ref={inputRef}
            value={draft.renameValue}
            disabled={draft.operation !== null}
            onChange={(event) => {
              const value = event.target.value;
              onChange((current) => current ? { ...current, renameValue: value, error: null } : current);
            }}
          />
          <div className="desktop-node-action-rename-actions">
            <button type="button" disabled={draft.operation !== null} onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" disabled={draft.operation !== null || !draft.renameValue.trim()}>
              {draft.operation === "rename" ? "Saving..." : "Save"}
            </button>
          </div>
          {draft.error && <div className="desktop-node-action-error">{draft.error}</div>}
        </form>
      ) : (
        <>
          <DesktopNodeActionMenuItem
            icon={<Pencil size={14} />}
            label="Rename"
            disabled={draft.operation !== null}
            onClick={() => onChange((current) => current ? { ...current, mode: "rename", error: null } : current)}
          />
          <DesktopNodeActionMenuItem
            icon={<Trash2 size={14} />}
            label={draft.operation === "delete" ? "Deleting..." : "Delete"}
            destructive
            disabled={draft.operation !== null}
            onClick={onDelete}
          />
          {draft.error && <div className="desktop-node-action-error">{draft.error}</div>}
        </>
      )}
    </div>
  );
}

function DesktopNodeActionMenuItem({
  icon,
  label,
  destructive,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`desktop-node-action-menu-item ${destructive ? "danger" : ""}`}
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onClick();
      }}
    >
      <span className="desktop-node-action-menu-icon">{icon}</span>
      <span className="desktop-node-action-menu-label">{label}</span>
    </button>
  );
}

function defaultCreateName(kind: DesktopCreateEntryKind): string {
  if (kind === "folder") return "New Folder";
  return "Untitled.md";
}

function normalizeCreateEntryName(kind: DesktopCreateEntryKind, value: string): string {
  const name = value.trim();
  if (!name) {
    throw new Error("Name is required.");
  }
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new Error("Name must be a single file or folder name.");
  }
  if (name.includes("\0")) {
    throw new Error("Name contains unsupported characters.");
  }
  if (kind === "markdown" && !/\.(md|markdown|mdx)$/i.test(name)) {
    return `${name}.md`;
  }
  return name;
}

function uniqueCreateEntryName(defaultName: string, existingNames: Set<string>): string {
  if (!existingNames.has(defaultName)) return defaultName;

  const extensionIndex = defaultName.lastIndexOf(".");
  const hasExtension = extensionIndex > 0;
  const stem = hasExtension ? defaultName.slice(0, extensionIndex) : defaultName;
  const extension = hasExtension ? defaultName.slice(extensionIndex) : "";

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem} ${index}${extension}`;
    if (!existingNames.has(candidate)) return candidate;
  }

  return `${stem} ${Date.now()}${extension}`;
}

function rectToCreateEntryAnchor(rect: DOMRect): DesktopCreateEntryAnchor {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function getCreateEntryMenuPosition(anchor: DesktopCreateEntryAnchor, menuWidth: number) {
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const maxLeft = Math.max(CREATE_ENTRY_MENU_MARGIN, viewportWidth - menuWidth - CREATE_ENTRY_MENU_MARGIN);
  const maxTop = Math.max(CREATE_ENTRY_MENU_MARGIN, viewportHeight - CREATE_ENTRY_MENU_ESTIMATED_HEIGHT - CREATE_ENTRY_MENU_MARGIN);

  return {
    left: clampNumber(anchor.left, CREATE_ENTRY_MENU_MARGIN, maxLeft),
    top: clampNumber(anchor.bottom + 4, CREATE_ENTRY_MENU_MARGIN, maxTop),
  };
}

function getNodeActionMenuPosition(anchor: DesktopCreateEntryAnchor) {
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const maxLeft = Math.max(CREATE_ENTRY_MENU_MARGIN, viewportWidth - NODE_ACTION_MENU_WIDTH - CREATE_ENTRY_MENU_MARGIN);
  const maxTop = Math.max(CREATE_ENTRY_MENU_MARGIN, viewportHeight - NODE_ACTION_MENU_ESTIMATED_HEIGHT - CREATE_ENTRY_MENU_MARGIN);

  return {
    left: clampNumber(anchor.left, CREATE_ENTRY_MENU_MARGIN, maxLeft),
    top: clampNumber(anchor.bottom + 4, CREATE_ENTRY_MENU_MARGIN, maxTop),
  };
}

function createExplorerDataPort(dataPort: DataPort, settings: FilesVisibilitySettings): DataPort {
  if (settings.showHiddenFiles || settings.excludePatterns.length === 0) return dataPort;
  const matchers = settings.excludePatterns
    .map(createExplorerExcludeMatcher)
    .filter((matcher): matcher is ExcludeMatcher => matcher !== null);

  if (matchers.length === 0) return dataPort;

  return {
    ...dataPort,
    listChildren: async (folderPath) => {
      const children = await dataPort.listChildren(folderPath);
      return children.filter((node) => !matchers.some((matcher) => matcher(node)));
    },
  };
}

type ExcludeMatcher = (node: DataNode) => boolean;

function createExplorerExcludeMatcher(rawPattern: string): ExcludeMatcher | null {
  const pattern = rawPattern.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!pattern) return null;

  const targetPattern = pattern.includes("/") ? pattern : `**/${pattern}`;
  const regex = globPatternToRegExp(targetPattern);
  if (!regex) return null;

  return (node) => regex.test(normalizeExplorerPath(node.path));
}

function globPatternToRegExp(pattern: string): RegExp | null {
  let source = "";

  for (let index = 0; index < pattern.length;) {
    const char = pattern[index];
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];

    if (char === "*") {
      if (next === "*") {
        if (afterNext === "/") {
          source += "(?:.*/)?";
          index += 3;
        } else {
          source += ".*";
          index += 2;
        }
      } else {
        source += "[^/]*";
        index += 1;
      }
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }

    source += escapeRegExp(char);
    index += 1;
  }

  try {
    return new RegExp(`^${source}$`);
  } catch {
    return null;
  }
}

function normalizeExplorerPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getDataParentPath(path: string): string | null {
  const segments = path.split("/");
  segments.pop();
  return segments.length > 0 ? segments.join("/") : null;
}

function joinDataPath(parentPath: string | null, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

function remapActivePathAfterRename(current: string | null, previousPath: string, nextPath: string): string | null {
  if (!current) return current;
  if (current === previousPath) return nextPath;
  if (current.startsWith(`${previousPath}/`)) return `${nextPath}${current.slice(previousPath.length)}`;
  return current;
}

function shortenTitlebarLabel(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  if (maxChars <= 3) return trimmed.slice(0, maxChars);
  return `${trimmed.slice(0, maxChars - 3)}...`;
}

function formatGitOperationError(error: unknown, operation: string): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = cleanGitOperationError(rawMessage);

  if (operation === "checkout") {
    if (/local changes.*overwritten|would be overwritten|commit or stash|commit your changes or stash/i.test(message)) {
      return "Cannot switch branch because local changes would be overwritten. Commit or stash your changes before switching branches.";
    }
    if (/already checked out|already used by worktree/i.test(message)) {
      return "Cannot switch branch because that branch is already checked out in another worktree.";
    }
    if (/pathspec .* did not match|invalid reference|not a commit|cannot find that branch/i.test(message)) {
      return "Cannot find that branch. Fetch remotes and try again.";
    }
    return message ? `Cannot switch branch. ${message}` : "Cannot switch branch.";
  }

  if (operation === "init") {
    return message ? `Cannot initialize repository. ${message}` : "Cannot initialize repository.";
  }

  if (operation === "commit-switch") {
    return message ? `Cannot commit changes. ${message}` : "Cannot commit changes.";
  }

  return message || "Git operation failed.";
}

function cleanGitOperationError(value: string): string {
  const withoutIpcPrefix = value
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "");
  const withoutOperationPrefix = withoutIpcPrefix
    .replace(/^Unable to checkout branch:\s*/i, "")
    .replace(/^Unable to initialize repository:\s*/i, "")
    .replace(/^Unable to stage changes:\s*/i, "")
    .replace(/^Unable to commit changes:\s*/i, "")
    .replace(/^Unable to stash changes:\s*/i, "");
  const lines = withoutOperationPrefix
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Command failed:/i.test(line))
    .filter((line) => !/^git -C\s/i.test(line))
    .filter((line) => !line.includes(" git -C "));

  return lines.join(" ").replace(/^Error:\s*/i, "").trim();
}

function isBranchOverwriteError(message: string): boolean {
  return /local changes would be overwritten|would overwrite/i.test(message);
}

function getGitChangeCount(status: GitStatusSnapshot): number {
  return status.stagedEntries.length + status.unstagedEntries.length + status.untrackedEntries.length;
}

function BranchSwitchConflictDialog({
  branchName,
  changeCount,
  error,
  loading,
  operationLoading,
  onCancel,
  onStashAndSwitch,
  onCommitAndSwitch,
}: {
  branchName: string;
  changeCount: number;
  error: string | null;
  loading: boolean;
  operationLoading: string | null;
  onCancel: () => void;
  onStashAndSwitch: () => void;
  onCommitAndSwitch: () => void;
}) {
  return (
    <div className="desktop-dialog-backdrop" role="presentation" onClick={loading ? undefined : onCancel}>
      <section
        className="desktop-dialog-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-switch-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <span className="desktop-dialog-leading warning" aria-hidden="true">
              <AlertTriangle size={17} />
            </span>
            <div>
              <h2 id="branch-switch-dialog-title">Switch Branch?</h2>
              <p>Switching to <strong>{branchName}</strong> may overwrite your current changes.</p>
            </div>
          </div>
          <button
            className="desktop-dialog-icon-button"
            type="button"
            aria-label="Close"
            disabled={loading}
            onClick={onCancel}
          >
            <X size={15} />
          </button>
        </header>

        <div className="desktop-dialog-body">
          <div className="desktop-dialog-callout">
            <strong>{changeCount}</strong>
            <span>{changeCount === 1 ? "local change" : "local changes"} in this workspace.</span>
          </div>
          <p className="desktop-dialog-note">Commit them to history, or stash them temporarily before switching.</p>
          {error && <p className="desktop-dialog-error">{error}</p>}
        </div>

        <footer className="desktop-dialog-footer two-action">
          <button className="desktop-dialog-button" type="button" disabled={loading} onClick={onStashAndSwitch}>
            {operationLoading === "stash" ? "Stashing..." : "Stash & Switch"}
          </button>
          <button className="desktop-dialog-button primary" type="button" disabled={loading} onClick={onCommitAndSwitch}>
            {operationLoading === "commit-switch" ? "Committing..." : "Commit & Switch"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function BranchMenuGroup({
  title,
  branches,
  operationLoading,
  onCheckout,
  onDone,
}: {
  title: string;
  branches: GitBranchSummary[];
  operationLoading: string | null;
  onCheckout: (branchName: string, remote: boolean) => Promise<boolean>;
  onDone: () => void;
}) {
  if (branches.length === 0) return null;

  return (
    <div className="desktop-branch-menu-group">
      <div className="desktop-branch-menu-label">{title}</div>
      <div className="desktop-branch-menu-list">
        {branches.map((branch) => (
          <button
            key={`${branch.remote ? "remote" : "local"}:${branch.name}`}
            className={`desktop-branch-menu-row ${branch.current ? "current" : ""}`}
            type="button"
            title={branch.lastCommitMessage ?? branch.name}
            disabled={Boolean(operationLoading) || branch.current}
            onClick={async () => {
              const checkedOut = await onCheckout(branch.name, branch.remote);
              if (checkedOut) onDone();
            }}
          >
            <GitBranch size={13} />
            <span>{branch.name}</span>
            {branch.current && <small>current</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

function readInitialThemeMode(): ThemeMode {
  if (typeof window === "undefined") return DEFAULT_THEME_MODE;
  return parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
}

function readInitialFileIconTheme(): FileIconThemeId {
  if (typeof window === "undefined") return "default";
  const stored = window.localStorage.getItem(FILE_ICON_THEME_STORAGE_KEY);
  return isFileIconThemeId(stored) ? stored : "default";
}

function readInitialSidebarNavigationLayout(): SidebarNavigationLayout {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_NAVIGATION_LAYOUT;
  return parseSidebarNavigationLayout(window.localStorage.getItem(SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY));
}

function readInitialFilesVisibilitySettings(): FilesVisibilitySettings {
  if (typeof window === "undefined") return parseFilesVisibilitySettings(null);
  return parseFilesVisibilitySettings(window.localStorage.getItem(FILES_VISIBILITY_STORAGE_KEY));
}

function readInitialRightSidebarToolsSettings(): RightSidebarToolsSettings {
  if (typeof window === "undefined") return parseRightSidebarToolsSettings(null);
  return parseRightSidebarToolsSettings(window.localStorage.getItem(RIGHT_SIDEBAR_TOOLS_STORAGE_KEY));
}

function readInitialExplorerWidth(): number {
  if (typeof window === "undefined") return DEFAULT_EXPLORER_WIDTH;
  const stored = Number(window.localStorage.getItem(EXPLORER_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(stored)) return DEFAULT_EXPLORER_WIDTH;
  return Math.min(Math.max(Math.round(stored), MIN_EXPLORER_WIDTH), MAX_EXPLORER_WIDTH);
}

function readInitialSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

function readInitialRightSidebarWidth(): number {
  if (typeof window === "undefined") return DEFAULT_RIGHT_SIDEBAR_WIDTH;
  const stored = Number(window.localStorage.getItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(stored)) return DEFAULT_RIGHT_SIDEBAR_WIDTH;
  return Math.min(Math.max(Math.round(stored), MIN_RIGHT_SIDEBAR_WIDTH), MAX_RIGHT_SIDEBAR_WIDTH);
}

function readSystemDarkMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
