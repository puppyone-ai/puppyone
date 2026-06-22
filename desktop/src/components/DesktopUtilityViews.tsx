import {
  Bot,
  Check,
  ChevronRight,
  Cloud,
  Copy,
  FileText,
  GitBranch,
  GripVertical,
  Minus,
  Monitor,
  Moon,
  PanelBottom,
  PanelTop,
  Plus,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  SquareTerminal,
  Sun,
  Trash2,
  Unlink,
  Users,
} from "lucide-react";
import { FILE_ICON_THEMES, FileGlyphIcon, type FileIconThemeId, type Workspace } from "@puppyone/shared-ui";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  GitCommitDetail,
  GitCommitSummary,
  GitDiffLine,
  GitFileDiff,
  GitStatusEntry,
  GitStatusSnapshot,
} from "../types/electron";
import {
  DEFAULT_EXPLORER_EXCLUDE_PATTERNS,
  SIDEBAR_NAVIGATION_LAYOUT_OPTIONS,
  normalizeExplorerExcludePatterns,
  type FilesVisibilitySettings,
  type RightSidebarToolId,
  type RightSidebarToolsSettings,
  type SidebarNavigationLayout,
  type ThemeMode,
} from "../preferences";

type GitStatusViewProps = {
  workspace: Workspace;
  status: GitStatusSnapshot | null;
  activePanel: GitMainPanel;
  selectedCommitId: string | null;
  selectedWorkingFile: GitWorkingSelection | null;
  commitDetail: GitCommitDetail | null;
  commitDetailLoading: boolean;
  commitDetailError: string | null;
  workingFileDiff: GitCommitDetail | null;
  workingFileDiffLoading: boolean;
  workingFileDiffError: string | null;
  operationLoading: string | null;
  operationError: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onStagePaths: (paths: string[]) => Promise<boolean>;
  onUnstagePaths: (paths: string[]) => Promise<boolean>;
  onDiscardPaths: (paths: string[]) => Promise<boolean>;
  onInitializeRepository: () => Promise<boolean>;
};

export type GitWorkingSelection = {
  path: string;
  status: string;
  staged: boolean;
};

export type GitMainPanel = "changes" | "history";

export type SettingsSection = "workspace" | "git" | "appearance" | "files";

type SettingsViewProps = {
  workspace: Workspace;
  activeSection: SettingsSection;
  gitStatus: GitStatusSnapshot | null;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
  themeMode: ThemeMode;
  fileIconTheme: FileIconThemeId;
  sidebarNavigationLayout: SidebarNavigationLayout;
  filesVisibilitySettings: FilesVisibilitySettings;
  rightSidebarToolsSettings: RightSidebarToolsSettings;
  onThemeModeChange: (mode: ThemeMode) => void;
  onFileIconThemeChange: (theme: FileIconThemeId) => void;
  onSidebarNavigationLayoutChange: (layout: SidebarNavigationLayout) => void;
  onFilesVisibilitySettingsChange: (settings: FilesVisibilitySettings) => void;
  onRightSidebarToolsSettingsChange: (settings: RightSidebarToolsSettings) => void;
  onUnlinkWorkspace: () => Promise<void>;
  onRefreshGitStatus: () => void;
};

type SettingsSidebarProps = {
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
};

type CloudServiceSidebarProps = {
  workspace: Workspace;
  status: GitStatusSnapshot | null;
  accountEmail: string | null;
  loading: boolean;
  error: string | null;
  onOpenDetails: () => void;
  onRefresh: () => void;
  onOpenGitSettings: () => void;
};

type CloudServicePanelProps = {
  open: boolean;
  workspace: Workspace;
  status: GitStatusSnapshot | null;
  accountEmail: string | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onSignedIn: (email: string) => void;
  onEnterCloud: () => void;
  onOpenGitSettings: () => void;
};

type CloudServiceMainViewProps = {
  workspace: Workspace;
  status: GitStatusSnapshot | null;
  accountEmail: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenDetails: () => void;
  onOpenGitSettings: () => void;
};

type GitSidebarProps = {
  status: GitStatusSnapshot | null;
  fileIconTheme: FileIconThemeId;
  activePanel: GitMainPanel;
  selectedCommitId: string | null;
  selectedWorkingFile: GitWorkingSelection | null;
  operationLoading: string | null;
  operationError: string | null;
  loading: boolean;
  error: string | null;
  onSelectPanel: (panel: GitMainPanel) => void;
  onSelectCommit: (commitId: string) => void;
  onSelectWorkingFile: (selection: GitWorkingSelection) => void;
  onStagePaths: (paths: string[]) => Promise<boolean>;
  onUnstagePaths: (paths: string[]) => Promise<boolean>;
  onDiscardPaths: (paths: string[]) => Promise<boolean>;
  onCommit: (message: string) => Promise<boolean>;
  onInitializeRepository: () => Promise<boolean>;
};

const RIGHT_SIDEBAR_TOOL_DEFINITIONS = [
  {
    id: "terminal",
    label: "Terminal",
    icon: SquareTerminal,
  },
] as const satisfies Array<{
  id: RightSidebarToolId;
  label: string;
  icon: typeof SquareTerminal;
}>;

export function GitStatusView({
  workspace,
  status,
  activePanel,
  selectedCommitId,
  selectedWorkingFile,
  commitDetail,
  commitDetailLoading,
  commitDetailError,
  workingFileDiff,
  workingFileDiffLoading,
  workingFileDiffError,
  operationLoading,
  operationError,
  loading,
  error,
  onRefresh,
  onStagePaths,
  onUnstagePaths,
  onDiscardPaths,
  onInitializeRepository,
}: GitStatusViewProps) {
  const commits = status?.commits ?? [];
  const historyCommits = status?.allCommits ?? commits;
  const selectedCommit =
    historyCommits.find((commit) => commit.commit_id === selectedCommitId) ??
    (activePanel === "history" ? historyCommits[0] ?? null : null);

  if (error) {
    return <UtilityEmptyState tone="danger" message={error} onRefresh={onRefresh} loading={loading} />;
  }

  if (status && !status.isRepo) {
    return (
      <UtilityEmptyState
        icon={<GitBranch size={34} strokeWidth={1.4} />}
        message="This folder is not under source control."
        detail={operationError ?? "Initialize a Git repository to start tracking changes in this workspace."}
        action={(
          <button
            className="desktop-utility-primary-button"
            type="button"
            disabled={Boolean(operationLoading)}
            onClick={() => void onInitializeRepository()}
          >
            Initialize Repository
          </button>
        )}
        onRefresh={onRefresh}
        loading={loading}
      />
    );
  }

  if (loading && !status) {
    return <UtilityEmptyState message="Reading Git history..." loading={loading} />;
  }

  if (activePanel === "history") {
    if (selectedCommit) {
      return (
        <section className="desktop-utility-view desktop-history-detail-view">
          <div className="desktop-history-detail-scroll">
            <CommitDetail
              commit={selectedCommit}
              detail={commitDetail}
              loading={commitDetailLoading}
              error={commitDetailError}
              isHead={selectedCommit.commit_id === status?.headCommitId}
            />
          </div>
        </section>
      );
    }

    return (
      <section className="desktop-utility-view desktop-history-detail-view">
        <div className="desktop-history-detail-scroll">
          <EmptyGitHistoryState status={status} operationError={operationError} onRefresh={onRefresh} loading={loading} />
        </div>
      </section>
    );
  }

  if (selectedWorkingFile) {
    return (
      <WorkingFileDetail
        selection={selectedWorkingFile}
        detail={workingFileDiff}
        loading={workingFileDiffLoading}
        error={workingFileDiffError}
        operationLoading={operationLoading}
        operationError={operationError}
        onStagePaths={onStagePaths}
        onUnstagePaths={onUnstagePaths}
        onDiscardPaths={onDiscardPaths}
      />
    );
  }

  return (
    <GitOverview
      workspace={workspace}
      status={status}
      loading={loading}
      operationLoading={operationLoading}
      operationError={operationError}
      onRefresh={onRefresh}
    />
  );
}

export function GitSidebar({
  status,
  fileIconTheme,
  activePanel,
  selectedCommitId,
  selectedWorkingFile,
  operationLoading,
  operationError,
  loading,
  error,
  onSelectPanel,
  onSelectCommit,
  onSelectWorkingFile,
  onStagePaths,
  onUnstagePaths,
  onDiscardPaths,
  onCommit,
  onInitializeRepository,
}: GitSidebarProps) {
  const [commitMessage, setCommitMessage] = useState("");
  const stagedEntries = status?.stagedEntries ?? [];
  const workingEntries = status ? [...status.unstagedEntries, ...status.untrackedEntries] : [];
  const historyCommits = status?.allCommits ?? status?.commits ?? [];
  const changeCount = stagedEntries.length + workingEntries.length;
  const historyCount = historyCommits.length || status?.totalCommits || 0;
  const disabled = Boolean(operationLoading) || loading || !status?.isRepo;
  const canCommit = !disabled && commitMessage.trim().length > 0 && stagedEntries.length > 0;

  const submitCommit = async () => {
    if (!canCommit) return;
    const committed = await onCommit(commitMessage);
    if (committed) setCommitMessage("");
  };

  return (
    <section className="desktop-tool-sidebar desktop-git-sidebar">
      {!error && !(status && !status.isRepo) && !(loading && !status) && (
        <GitSidebarTabs
          activePanel={activePanel}
          changesCount={changeCount}
          historyCount={historyCount}
          onSelectPanel={onSelectPanel}
        />
      )}
      <div className="desktop-tool-sidebar-list desktop-git-sidebar-list">
        {error ? (
          <div className="desktop-tool-sidebar-empty danger">{error}</div>
        ) : status && !status.isRepo ? (
          <div className="desktop-tool-sidebar-empty vertical">
            <span>No repository</span>
            {operationError && <small className="desktop-tool-sidebar-error-text">{operationError}</small>}
            <button
              className="desktop-tool-sidebar-action"
              type="button"
              disabled={Boolean(operationLoading)}
              onClick={() => void onInitializeRepository()}
            >
              Initialize Repository
            </button>
          </div>
        ) : loading && !status ? (
          <div className="desktop-tool-sidebar-empty">Reading Git...</div>
        ) : (
          <>
            {activePanel === "history" ? (
              <>
                {historyCommits.length === 0 ? (
                  <SidebarEmptyHistory status={status} />
                ) : (
                  <div className="desktop-git-history-scroll">
                    <div className="desktop-history-list">
                      {historyCommits.map((commit, index) => (
                        <SidebarHistoryRow
                          key={commit.commit_id}
                          commit={commit}
                          isHead={commit.commit_id === status?.headCommitId}
                          isSelected={commit.commit_id === selectedCommitId}
                          hasPrevious={index > 0}
                          hasNext={index < historyCommits.length - 1}
                          onClick={() => onSelectCommit(commit.commit_id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="desktop-git-fixed-region">
                  <div className="desktop-git-commit-box">
                    <textarea
                      value={commitMessage}
                      placeholder="Message"
                      rows={3}
                      disabled={disabled}
                      onChange={(event) => setCommitMessage(event.target.value)}
                    />
                    <button type="button" disabled={!canCommit} onClick={() => void submitCommit()}>
                      <Check size={14} />
                      <span>Commit</span>
                    </button>
                  </div>

                  {operationError && <div className="desktop-git-operation-error">{operationError}</div>}

                  <GitSectionHeader
                    title="Staged Changes"
                    count={stagedEntries.length}
                    action={stagedEntries.length > 0 ? (
                      <button
                        className="desktop-tool-sidebar-icon"
                        type="button"
                        title="Unstage all"
                        aria-label="Unstage all"
                        disabled={disabled}
                        onClick={() => void onUnstagePaths([])}
                      >
                        <Minus size={14} />
                      </button>
                    ) : null}
                  />
                </div>

                <div className="desktop-git-changes-scroll">
                  {stagedEntries.length === 0 ? (
                    <div className="desktop-tool-sidebar-empty compact">No staged changes</div>
                  ) : (
                    <div className="desktop-working-tree-list">
                      {stagedEntries.map((entry) => (
                        <WorkingTreeRow
                          entry={entry}
                          staged
                          key={`staged:${entry.status}:${entry.path}`}
                          selected={selectedWorkingFile?.staged === true && selectedWorkingFile.path === entry.path}
                          operationLoading={operationLoading}
                          fileIconTheme={fileIconTheme}
                          onSelect={onSelectWorkingFile}
                          onStagePaths={onStagePaths}
                          onUnstagePaths={onUnstagePaths}
                          onDiscardPaths={onDiscardPaths}
                        />
                      ))}
                    </div>
                  )}

                  <GitSectionHeader
                    title="Changes"
                    count={workingEntries.length}
                    action={workingEntries.length > 0 ? (
                      <button
                        className="desktop-tool-sidebar-icon"
                        type="button"
                        title="Stage all"
                        aria-label="Stage all"
                        disabled={disabled}
                        onClick={() => void onStagePaths([])}
                      >
                        <Plus size={14} />
                      </button>
                    ) : null}
                  />
                  {workingEntries.length === 0 ? (
                    <div className="desktop-tool-sidebar-empty compact">No working changes</div>
                  ) : (
                    <div className="desktop-working-tree-list">
                      {workingEntries.map((entry) => (
                        <WorkingTreeRow
                          entry={entry}
                          staged={false}
                          key={`working:${entry.status}:${entry.path}`}
                          selected={selectedWorkingFile?.staged === false && selectedWorkingFile.path === entry.path}
                          operationLoading={operationLoading}
                          fileIconTheme={fileIconTheme}
                          onSelect={onSelectWorkingFile}
                          onStagePaths={onStagePaths}
                          onUnstagePaths={onUnstagePaths}
                          onDiscardPaths={onDiscardPaths}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function CloudServiceSidebar({
  workspace,
  status,
  accountEmail,
  loading,
  error,
  onOpenDetails,
  onRefresh,
  onOpenGitSettings,
}: CloudServiceSidebarProps) {
  const cloudRemote = getPuppyoneRemote(status);
  const hosted = Boolean(cloudRemote);
  const accountConnected = Boolean(accountEmail) || hosted;
  const currentBranch = status?.branches.find((branch) => branch.current) ?? null;
  const localChangeCount =
    (status?.stagedEntries.length ?? 0) +
    (status?.unstagedEntries.length ?? 0) +
    (status?.untrackedEntries.length ?? 0);
  const syncStatus = currentBranch?.upstream
    ? `${currentBranch.ahead} ahead, ${currentBranch.behind} behind`
    : hosted
      ? "Remote configured"
      : "Local only";
  const statusLabel = error
    ? "Check failed"
    : loading && !status
      ? "Checking"
      : hosted
        ? "Hosted"
        : accountConnected
          ? "Account connected"
          : "Local only";
  const statusCopy = error
    ? error
    : hosted
      ? "This workspace is backed up to PuppyOne Cloud. Cloud-native services operate on the hosted copy."
      : accountConnected
        ? "Your Puppyone account is connected. Back up this workspace to enable cloud-native services here."
        : "Sign in to a PuppyOne account, then back up this folder before cloud services can run.";
  const services: CloudSidebarServiceDescriptor[] = [
    {
      label: "Puppyone CLI",
      description: "Scoped cloud filesystem for terminal and agents.",
      icon: SquareTerminal,
      state: hosted ? "Ready" : accountConnected ? "Backup" : "Login",
      plan: "Included",
      tone: hosted ? "ready" : "locked",
    },
    {
      label: "Git Remote",
      description: "Local backup and restore transport.",
      icon: GitBranch,
      state: hosted ? "Connected" : "Backup",
      plan: "Included",
      tone: hosted ? "ready" : "locked",
    },
    {
      label: "MCP Server",
      description: "MCP-compatible access to cloud content.",
      icon: Server,
      state: hosted ? "Plus" : "Backup",
      plan: "Plus",
      tone: hosted ? "upgrade" : "locked",
    },
    {
      label: "Team",
      description: "Members, roles, and shared access.",
      icon: Users,
      state: hosted ? "Plus" : "Backup",
      plan: "Plus",
      tone: hosted ? "upgrade" : "locked",
    },
    {
      label: "Hosted workspace",
      description: "Cloud-native workspace runtime.",
      icon: Bot,
      state: hosted ? "Pro" : "Backup",
      plan: "Pro",
      tone: hosted ? "upgrade" : "locked",
    },
  ];

  return (
    <section className="desktop-tool-sidebar desktop-cloud-service-sidebar">
      <div className="desktop-cloud-sidebar-topbar">
        <div>
          <span>Cloud</span>
          <strong>Native Service</strong>
        </div>
        <button className="desktop-tool-sidebar-icon" type="button" onClick={onRefresh} aria-label="Refresh Cloud status">
          <RefreshCw size={14} className={loading ? "spin" : undefined} />
        </button>
      </div>

      <div className="desktop-cloud-sidebar-scroll">
        <section className={`desktop-cloud-sidebar-card ${hosted ? "hosted" : ""}`}>
          <div className="desktop-cloud-sidebar-status">
            <span className={`desktop-cloud-sidebar-status-icon ${hosted ? "hosted" : ""}`}>
              <Cloud size={17} />
            </span>
            <div>
              <strong>{hosted ? "Backed up to Cloud" : accountConnected ? "Cloud unlocked" : "PuppyOne account required"}</strong>
              <span>{statusLabel}</span>
            </div>
          </div>
          <p>{statusCopy}</p>
          <div className="desktop-cloud-sidebar-actions">
            <button
              className="desktop-cloud-sidebar-primary"
              type="button"
              onClick={accountConnected ? onOpenDetails : () => openCloudApp("/login")}
            >
              {hosted ? "Manage Cloud" : accountConnected ? "Back up workspace" : "Sign in"}
            </button>
            <button className="desktop-cloud-sidebar-secondary" type="button" onClick={onOpenDetails}>
              Details
            </button>
          </div>
        </section>

        <section className="desktop-cloud-sidebar-section">
          <div className="desktop-cloud-sidebar-section-title">
            <span>Access surfaces</span>
            <button type="button" onClick={onOpenDetails}>Manage</button>
          </div>
          <div className="desktop-cloud-sidebar-service-list">
            {services.map((service) => (
              <CloudSidebarServiceRow key={service.label} service={service} />
            ))}
          </div>
        </section>

        <section className="desktop-cloud-sidebar-section">
          <div className="desktop-cloud-sidebar-section-title">
            <span>Backup and plan</span>
            <button type="button" onClick={() => openCloudApp("/billing")}>Billing</button>
          </div>
          <div className="desktop-cloud-sidebar-meter">
            <CloudSidebarMetric label="Project" value={cloudRemote?.info.displayId ?? "Not backed up"} tone={hosted ? "ready" : undefined} />
            <CloudSidebarMetric label="Sync" value={syncStatus} />
            <CloudSidebarMetric
              label="Local changes"
              value={localChangeCount === 0 ? "None" : String(localChangeCount)}
              tone={localChangeCount === 0 ? undefined : "warning"}
            />
          </div>
          <p className="desktop-cloud-sidebar-note">Backup size counts against Cloud storage. MCP starts on Plus; hosted workspace and sandbox start on Pro.</p>
        </section>

        <button className="desktop-cloud-sidebar-git-button" type="button" onClick={onOpenGitSettings}>
          <GitBranch size={14} />
          <span>Git sync details</span>
        </button>
      </div>
    </section>
  );
}

export function CloudServiceMainView({
  workspace,
  status,
  accountEmail,
  loading,
  error,
  onRefresh,
  onOpenDetails,
  onOpenGitSettings,
}: CloudServiceMainViewProps) {
  const cloudRemote = getPuppyoneRemote(status);
  const hosted = Boolean(cloudRemote);
  const accountConnected = Boolean(accountEmail) || hosted;
  const currentBranch = status?.branches.find((branch) => branch.current) ?? null;
  const localChangeCount =
    (status?.stagedEntries.length ?? 0) +
    (status?.unstagedEntries.length ?? 0) +
    (status?.untrackedEntries.length ?? 0);
  const syncStatus = currentBranch?.upstream
    ? `${currentBranch.ahead} ahead, ${currentBranch.behind} behind`
    : hosted
      ? "Remote configured"
      : "Not backed up";
  const services: CloudSidebarServiceDescriptor[] = [
    {
      label: "Cloud backup",
      description: "Sync this local workspace to a hosted copy.",
      icon: Cloud,
      state: hosted ? "Ready" : accountConnected ? "Set up" : "Login",
      plan: "Included",
      tone: hosted ? "ready" : "locked",
    },
    {
      label: "Team collaboration",
      description: "Share workspace access with teammates.",
      icon: Users,
      state: hosted ? "Plus" : "Backup",
      plan: "Plus",
      tone: hosted ? "upgrade" : "locked",
    },
    {
      label: "MCP / CLI",
      description: "Connect agents and command line tools to Cloud.",
      icon: SquareTerminal,
      state: hosted ? "Ready" : "Backup",
      plan: "Included",
      tone: hosted ? "ready" : "locked",
    },
    {
      label: "24/7 online",
      description: "Keep a hosted workspace available outside this computer.",
      icon: Server,
      state: hosted ? "Pro" : "Backup",
      plan: "Pro",
      tone: hosted ? "upgrade" : "locked",
    },
  ];

  return (
    <main className="desktop-cloud-main-view">
      <section className="desktop-cloud-main-hero">
        <div className="desktop-cloud-main-mark" aria-hidden="true">
          <CloudProductMark />
        </div>
        <div className="desktop-cloud-main-copy">
          <span>Cloud version</span>
          <h2>{hosted ? "Cloud workspace ready" : "Cloud unlocked"}</h2>
          <p>
            {hosted
              ? "This local workspace is connected to Puppyone Cloud."
              : "Your Puppyone account is connected. Back up this workspace to enable hosted services."}
          </p>
        </div>
        <div className="desktop-cloud-main-actions">
          <button className="desktop-cloud-primary-button" type="button" onClick={onOpenDetails}>
            {hosted ? "Manage Cloud" : "Set up backup"}
          </button>
          <button className="desktop-cloud-ghost-button" type="button" onClick={onRefresh}>
            <RefreshCw size={14} className={loading ? "spin" : undefined} />
            <span>Refresh</span>
          </button>
        </div>
      </section>

      {error && <div className="desktop-cloud-main-alert">{error}</div>}

      <section className="desktop-cloud-detail-grid desktop-cloud-main-detail-grid">
        <CloudMainDetail label="Account" value={accountEmail ?? "Connected"} tone={accountConnected ? "ready" : undefined} />
        <CloudMainDetail label="Workspace" value={workspace.name} />
        <CloudMainDetail label="Backup" value={cloudRemote?.info.displayId ?? "Not configured"} tone={hosted ? "ready" : "warning"} />
        <CloudMainDetail label="Sync" value={syncStatus} />
        <CloudMainDetail label="Local changes" value={localChangeCount === 0 ? "None" : String(localChangeCount)} tone={localChangeCount === 0 ? undefined : "warning"} />
      </section>

      <section className="desktop-cloud-services-section">
        <div className="desktop-cloud-section-heading">
          <strong>Cloud services</strong>
          <span>Services unlock as this workspace is backed up and upgraded.</span>
        </div>
        <div className="desktop-cloud-service-list">
          {services.map((service) => (
            <CloudServiceMainRow key={service.label} service={service} />
          ))}
        </div>
      </section>

      <section className="desktop-cloud-details-section">
        <div className="desktop-cloud-section-heading">
          <strong>Version transport</strong>
          <span>Puppyone Cloud uses Git under the hood for local backup and restore.</span>
        </div>
        <button className="desktop-cloud-row-action" type="button" onClick={onOpenGitSettings}>
          Git sync details
        </button>
      </section>
    </main>
  );
}

export function CloudServicePanel({
  open,
  workspace,
  status,
  accountEmail,
  loading,
  error,
  onClose,
  onRefresh,
  onSignedIn,
  onEnterCloud,
  onOpenGitSettings,
}: CloudServicePanelProps) {
  const [cloudAuthView, setCloudAuthView] = useState<CloudAuthView>("main");
  const [cloudLoginEmail, setCloudLoginEmail] = useState("");
  const [cloudLoginLoading, setCloudLoginLoading] = useState<CloudLoginMethod | null>(null);
  const [cloudLoginPassword, setCloudLoginPassword] = useState("");
  const [cloudLoginError, setCloudLoginError] = useState<string | null>(null);
  const [cloudLoginMessage, setCloudLoginMessage] = useState<string | null>(null);
  const [cloudSignedInEmail, setCloudSignedInEmail] = useState<string | null>(null);

  if (!open) return null;

  const cloudRemote = getPuppyoneRemote(status);
  const hosted = Boolean(cloudRemote);
  const signedInEmail = cloudSignedInEmail ?? accountEmail;
  const effectiveAuthView: CloudAuthView = !hosted && signedInEmail ? "signedIn" : cloudAuthView;
  const statusBadge = error
    ? "Check failed"
    : loading && !status
      ? "Checking"
      : hosted
        ? "Hosted"
        : null;
  const statusTitle = hosted ? "Workspace already connected." : "Sign in to continue.";
  const startCloudLogin = (method: CloudLoginMethod, email?: string) => {
    const params = new URLSearchParams();
    if (method !== "email") params.set("provider", method);
    const trimmedEmail = email?.trim();
    if (trimmedEmail) params.set("email", trimmedEmail);

    setCloudLoginLoading(method);
    openCloudApp(`/login${params.size > 0 ? `?${params.toString()}` : ""}`);
    window.setTimeout(() => setCloudLoginLoading(null), 1200);
  };
  const handleCloudEmailLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = cloudLoginEmail.trim();
    if (!email) return;

    setCloudLoginError(null);
    setCloudLoginMessage(null);
    setCloudLoginLoading("email");

    try {
      const result = await checkCloudEmail(email);
      setCloudAuthView(result.exists ? "signin" : "signup");
    } catch (checkError) {
      setCloudLoginError(checkError instanceof Error ? checkError.message : "Failed to check email");
    } finally {
      setCloudLoginLoading(null);
    }
  };
  const handleCloudPasswordLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = cloudLoginEmail.trim();
    if (!email || !cloudLoginPassword) return;

    setCloudLoginError(null);
    setCloudLoginMessage(null);
    setCloudLoginLoading("password");

    try {
      const session = await loginCloudWithPassword(email, cloudLoginPassword);
      await initializeCloudUser(session.access_token);
      const signedInAs = session.user_email || email;
      setCloudSignedInEmail(signedInAs);
      setCloudAuthView("signedIn");
      setCloudLoginMessage(null);
      setCloudLoginPassword("");
      await onRefresh();
      onSignedIn(signedInAs);
    } catch (loginError) {
      setCloudLoginError(loginError instanceof Error ? loginError.message : "Sign-in failed");
    } finally {
      setCloudLoginLoading(null);
    }
  };
  const handleCloudSignupContinue = () => {
    startCloudLogin("email", cloudLoginEmail);
  };
  const handleCloudAuthBack = () => {
    setCloudAuthView("main");
    setCloudLoginPassword("");
    setCloudLoginError(null);
    setCloudLoginMessage(null);
  };
  const cloudFeatures: CloudLoginFeature[] = [
    {
      label: "Team collaboration",
      icon: Users,
    },
    {
      label: "Cloud backup",
      icon: Cloud,
    },
    {
      label: "MCP / CLI supported",
      icon: SquareTerminal,
    },
    {
      label: "24/7 online",
      icon: Server,
    },
  ];

  return (
    <div className="desktop-cloud-panel-layer">
      <button className="desktop-cloud-panel-scrim" type="button" aria-label="Close Cloud panel" onClick={onClose} />
      <section className={`desktop-cloud-panel ${hosted ? "hosted" : "locked"}`} role="dialog" aria-modal="true" aria-label="Cloud Native Service">
        <div className="desktop-cloud-panel-body">
          <section className="desktop-cloud-login-layout">
            <div className="desktop-cloud-login-copy">
              <div className="desktop-cloud-login-copy-content">
                <div className="desktop-cloud-login-identity">
                  <div className="desktop-cloud-login-logo" aria-hidden="true">
                    <CloudProductMark />
                  </div>
                  <div className="desktop-cloud-login-copy-stack">
                    <h3>Get Puppyone Cloud</h3>
                    {statusBadge && (
                      <span className={`desktop-cloud-login-badge ${hosted ? "hosted" : "locked"}`}>{statusBadge}</span>
                    )}
                    <p>Back up this workspace. Keep agents, teammates, MCP, and CLI connected.</p>
                  </div>
                </div>
                <div className="desktop-cloud-login-feature-list">
                  {cloudFeatures.map((feature) => (
                    <CloudLoginFeatureRow key={feature.label} feature={feature} />
                  ))}
                </div>
              </div>
            </div>
            <aside className="desktop-cloud-login-card">
              {hosted ? (
                <CloudHostedLoginCard
                  loading={loading}
                  statusTitle={statusTitle}
                  error={error}
                  onOpenCloud={onEnterCloud}
                  onRefresh={onRefresh}
                  onOpenGitSettings={onOpenGitSettings}
                />
              ) : (
                <CloudAuthCard
                  view={effectiveAuthView}
                  email={cloudLoginEmail}
                  password={cloudLoginPassword}
                  signedInEmail={signedInEmail}
                  loading={cloudLoginLoading}
                  error={cloudLoginError}
                  message={cloudLoginMessage}
                  onEmailChange={setCloudLoginEmail}
                  onPasswordChange={setCloudLoginPassword}
                  onProviderLogin={(method) => startCloudLogin(method)}
                  onEmailSubmit={handleCloudEmailLogin}
                  onPasswordSubmit={handleCloudPasswordLogin}
                  onSignupContinue={handleCloudSignupContinue}
                  onOpenCloud={onEnterCloud}
                  onRefresh={onRefresh}
                  onBack={handleCloudAuthBack}
                />
              )}
            </aside>
          </section>
        </div>
      </section>
    </div>
  );
}

type CloudAuthView = "main" | "signin" | "signup" | "signedIn";
type CloudLoginMethod = "google" | "github" | "email" | "password";

type CloudLoginFeature = {
  label: string;
  icon: typeof Cloud;
};

function CloudAuthCard({
  view,
  email,
  password,
  signedInEmail,
  loading,
  error,
  message,
  onEmailChange,
  onPasswordChange,
  onProviderLogin,
  onEmailSubmit,
  onPasswordSubmit,
  onSignupContinue,
  onOpenCloud,
  onRefresh,
  onBack,
}: {
  view: CloudAuthView;
  email: string;
  password: string;
  signedInEmail: string | null;
  loading: CloudLoginMethod | null;
  error: string | null;
  message: string | null;
  onEmailChange: (email: string) => void;
  onPasswordChange: (password: string) => void;
  onProviderLogin: (method: Exclude<CloudLoginMethod, "email" | "password">) => void;
  onEmailSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPasswordSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSignupContinue: () => void;
  onOpenCloud: () => void;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const disabled = Boolean(loading);

  return (
    <div className="desktop-cloud-auth-card">
      {view !== "main" && view !== "signedIn" && (
        <button className="desktop-cloud-auth-back" type="button" disabled={disabled} onClick={onBack}>
          All sign in options
        </button>
      )}

      {view === "main" ? (
        <>
          <div className="desktop-cloud-auth-provider-list">
            <CloudProviderButton
              icon={<CloudGoogleIcon />}
              label="Continue with Google"
              loadingLabel="Redirecting..."
              isLoading={loading === "google"}
              disabled={disabled}
              onClick={() => onProviderLogin("google")}
            />
            <CloudProviderButton
              icon={<CloudGithubIcon />}
              label="Continue with GitHub"
              loadingLabel="Redirecting..."
              isLoading={loading === "github"}
              disabled={disabled}
              onClick={() => onProviderLogin("github")}
            />
          </div>

          <CloudAuthDivider />

          <form className="desktop-cloud-auth-form" onSubmit={onEmailSubmit}>
            <label htmlFor="desktop-cloud-login-email">Email</label>
            <input
              id="desktop-cloud-login-email"
              type="email"
              value={email}
              placeholder="Your email address"
              required
              disabled={disabled}
              onChange={(event) => onEmailChange(event.target.value)}
            />
            <button className="desktop-cloud-auth-submit" type="submit" disabled={disabled}>
              {loading === "email" && <CloudAuthDots />}
              <span>{loading === "email" ? "Checking..." : "Continue"}</span>
            </button>
          </form>
        </>
      ) : view === "signin" ? (
        <>
          <div className="desktop-cloud-auth-heading">
            <h3>Welcome back</h3>
            <p>{email}</p>
          </div>
          <form className="desktop-cloud-auth-form" onSubmit={onPasswordSubmit}>
            <label htmlFor="desktop-cloud-login-password">Password</label>
            <input
              id="desktop-cloud-login-password"
              type="password"
              value={password}
              placeholder="Enter your password"
              required
              minLength={6}
              disabled={disabled}
              autoFocus
              onChange={(event) => onPasswordChange(event.target.value)}
            />
            <button className="desktop-cloud-auth-submit" type="submit" disabled={disabled}>
              {loading === "password" && <CloudAuthDots />}
              <span>{loading === "password" ? "Signing in..." : "Sign In"}</span>
            </button>
          </form>
        </>
      ) : view === "signup" ? (
        <>
          <div className="desktop-cloud-auth-heading">
            <h3>Create your account</h3>
            <p>{email}</p>
          </div>
          <button className="desktop-cloud-auth-submit" type="button" disabled={disabled} onClick={onSignupContinue}>
            {loading === "email" && <CloudAuthDots />}
            <span>{loading === "email" ? "Opening..." : "Continue in PuppyOne Cloud"}</span>
          </button>
        </>
      ) : (
        <>
          <div className="desktop-cloud-auth-heading">
            <h3>Signed in</h3>
            <p>{signedInEmail ?? email}</p>
          </div>
          <div className="desktop-cloud-auth-state">
            <span>
              <Check size={14} />
            </span>
            <div>
              <strong>Puppyone account connected</strong>
              <p>Back up this workspace to enable Cloud services here.</p>
            </div>
          </div>
          <button className="desktop-cloud-auth-submit" type="button" onClick={onOpenCloud}>
            Enter Cloud version
          </button>
          <button className="desktop-cloud-auth-secondary" type="button" onClick={onRefresh}>
            <RefreshCw size={14} />
            <span>Check workspace status</span>
          </button>
        </>
      )}

      <CloudAuthFeedback error={error} message={message} />

      {view !== "signedIn" && (
        <p className="desktop-cloud-auth-terms">By continuing you agree to our Terms and Privacy Policy.</p>
      )}
    </div>
  );
}

function CloudHostedLoginCard({
  loading,
  statusTitle,
  error,
  onOpenCloud,
  onRefresh,
  onOpenGitSettings,
}: {
  loading: boolean;
  statusTitle: string;
  error: string | null;
  onOpenCloud: () => void;
  onRefresh: () => void;
  onOpenGitSettings: () => void;
}) {
  return (
    <div className="desktop-cloud-auth-card desktop-cloud-auth-card-hosted">
      <h3>PuppyOne Cloud</h3>
      <p className="desktop-cloud-auth-hosted-copy">{statusTitle}</p>
      <button className="desktop-cloud-auth-submit" type="button" onClick={onOpenCloud}>
        Enter Cloud version
      </button>
      <button className="desktop-cloud-auth-secondary" type="button" onClick={onRefresh}>
        <RefreshCw size={14} className={loading ? "spin" : undefined} />
        <span>Check status</span>
      </button>
      <button className="desktop-cloud-auth-secondary" type="button" onClick={onOpenGitSettings}>
        Git sync details
      </button>
      {error && <p className="desktop-cloud-login-error">{error}</p>}
    </div>
  );
}

function CloudProviderButton({
  icon,
  label,
  loadingLabel,
  isLoading,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  loadingLabel: string;
  isLoading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button className="desktop-cloud-provider-button" type="button" disabled={disabled} onClick={onClick}>
      <span className="desktop-cloud-provider-button-icon">{icon}</span>
      <span>{isLoading ? loadingLabel : label}</span>
    </button>
  );
}

function CloudAuthDivider() {
  return (
    <div className="desktop-cloud-auth-divider">
      <span />
      <small>or</small>
      <span />
    </div>
  );
}

function CloudAuthFeedback({ error, message }: { error: string | null; message: string | null }) {
  if (!error && !message) return null;

  return (
    <div className="desktop-cloud-auth-feedback">
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
    </div>
  );
}

function CloudAuthDots() {
  return (
    <span className="desktop-cloud-auth-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function CloudLoginFeatureRow({ feature }: { feature: CloudLoginFeature }) {
  return (
    <div className="desktop-cloud-login-feature-row">
      <span>
        <Check size={13} />
      </span>
      <div>
        <strong>{feature.label}</strong>
      </div>
    </div>
  );
}

function CloudProductMark() {
  return (
    <svg className="desktop-cloud-product-mark" viewBox="0 0 160 100" aria-hidden="true" focusable="false">
      <path
        className="desktop-cloud-product-mark-cloud"
        d="M43.8 76.5h72.6c14.4 0 26.1-11.1 26.1-24.8 0-13.6-11.4-24.6-25.6-24.9C111.2 13.8 98.1 5.5 83.5 7.1 67.3 8.8 54.2 21.1 51.2 37.2h-6.8c-15.5 0-27.9 11.1-27.9 24.6 0 9.6 9.3 14.7 27.3 14.7Z"
      />
    </svg>
  );
}

function CloudGoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 533.5 544.3" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="#4285f4" d="M533.5 278.4c0-17.6-1.6-34.4-4.6-50.4H272v95.3h147c-6.4 34.6-25.8 63.9-55 83.6l89 69.4c51.8-47.7 80.5-118 80.5-198z" />
      <path fill="#34a853" d="M272 544.3c74.7 0 137.5-24.8 183.3-67.4l-89-69.4c-24.7 16.6-56.3 26.3-94.3 26.3-72.5 0-134-49-155.9-114.9l-92 71.6c41.6 82.5 127.1 153.8 247.9 153.8z" />
      <path fill="#fbbc04" d="M116.1 318.9c-10-29.8-10-62.1 0-91.9l-92-71.6C4 211 0 240.9 0 272.4s4 61.4 24.1 116.9l92-70.4z" />
      <path fill="#ea4335" d="M272 107.7c39.7-.6 77.6 14.7 105.8 42.9l77.5-77.5C395.1 24 334.2 0 272 0 151.2 0 65.7 71.3 24.1 155.5l92 71.6C138 161.3 199.5 107.7 272 107.7z" />
    </svg>
  );
}

function CloudGithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 1C6 1 1.5 5.5 1.5 11.5c0 4.6 3 8.5 7.2 9.9.5.1.7-.2.7-.5v-1.9c-2.9.6-3.5-1.2-3.5-1.2-.5-1.2-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 1.7 2.6 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.4-.3-4.9-1.2-4.9-5.3 0-1.2.4-2.1 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 .1 1-.3 2-.4 3.1-.4s2.1.1 3.1.4c2.1-1.4 3-.1 3-.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.7 1.1 2.9 0 4.1-2.6 5.1-5 5.4.4.3.7 1 .7 2v3c0 .3.2.6.7.5 4.2-1.4 7.2-5.3 7.2-9.9C22.5 5.5 18 1 12 1z" />
    </svg>
  );
}

type CloudSidebarServiceDescriptor = {
  label: string;
  description: string;
  icon: typeof Cloud;
  state: string;
  plan: string;
  tone: "ready" | "upgrade" | "locked";
};

function CloudSidebarServiceRow({ service }: { service: CloudSidebarServiceDescriptor }) {
  const Icon = service.icon;

  return (
    <div className="desktop-cloud-sidebar-service-row">
      <span className={`desktop-cloud-sidebar-service-icon ${service.tone}`}>
        <Icon size={14} />
      </span>
      <div>
        <strong>{service.label}</strong>
        <span>{service.description}</span>
      </div>
      <small className={service.tone}>{service.state}</small>
    </div>
  );
}

function CloudSidebarMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ready" | "warning";
}) {
  return (
    <div className={`desktop-cloud-sidebar-metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CloudMainDetail({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ready" | "warning";
}) {
  return (
    <div className={`desktop-cloud-detail-item ${tone ?? ""}`}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function CloudServiceMainRow({ service }: { service: CloudSidebarServiceDescriptor }) {
  const Icon = service.icon;

  return (
    <div className="desktop-cloud-service-panel-row">
      <span className={`desktop-cloud-service-panel-icon ${service.tone}`}>
        <Icon size={14} />
      </span>
      <div className="desktop-cloud-service-panel-copy">
        <div>
          <strong>{service.label}</strong>
          <span>{service.plan}</span>
        </div>
        <p>{service.description}</p>
      </div>
      <small className={`desktop-cloud-service-panel-state ${service.tone}`}>{service.state}</small>
    </div>
  );
}

function openCloudApp(path: string) {
  window.open(`https://app.puppyone.ai${path}`, "_blank", "noopener,noreferrer");
}

const DESKTOP_CLOUD_API_BASE_URL = "http://localhost:9090/api/v1";

async function checkCloudEmail(email: string) {
  const response = await fetch(desktopCloudApiUrl("/auth/check-email"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const payload = await readCloudApiPayload(response);
  return { exists: Boolean(payload?.data?.exists) };
}

async function loginCloudWithPassword(email: string, password: string) {
  const response = await fetch(desktopCloudApiUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const payload = await readCloudApiPayload(response);
  const data = payload?.data ?? {};
  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  if (!accessToken) throw new Error("Login succeeded but no access token was returned.");

  return {
    access_token: accessToken,
    refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : "",
    expires_in: typeof data.expires_in === "number" ? data.expires_in : 0,
    user_email: typeof data.user_email === "string" ? data.user_email : email,
  };
}

async function initializeCloudUser(accessToken: string) {
  const response = await fetch(desktopCloudApiUrl("/auth/initialize"), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await readCloudApiPayload(response);
}

function desktopCloudApiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${DESKTOP_CLOUD_API_BASE_URL}${normalizedPath}`;
}

async function readCloudApiPayload(response: Response) {
  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(getCloudApiErrorMessage(payload, `Request failed (${response.status})`));
  }

  return payload;
}

function getCloudApiErrorMessage(payload: any, fallback: string) {
  const detail = payload?.detail;
  if (typeof payload?.message === "string" && payload.message) return payload.message;
  if (typeof detail === "string" && detail) return detail;
  if (typeof detail?.message === "string" && detail.message) return detail.message;
  if (typeof payload?.error === "string" && payload.error) return payload.error;
  return fallback;
}

function GitSidebarTabs({
  activePanel,
  changesCount,
  historyCount,
  onSelectPanel,
}: {
  activePanel: GitMainPanel;
  changesCount: number;
  historyCount: number;
  onSelectPanel: (panel: GitMainPanel) => void;
}) {
  return (
    <div className="desktop-git-sidebar-tabs" aria-label="Git view">
      <button
        className={activePanel === "changes" ? "active" : ""}
        type="button"
        onClick={() => onSelectPanel("changes")}
      >
        <span>Changes</span>
        <small>{changesCount}</small>
      </button>
      <button
        className={activePanel === "history" ? "active" : ""}
        type="button"
        onClick={() => onSelectPanel("history")}
      >
        <span>History</span>
        <small>{historyCount}</small>
      </button>
    </div>
  );
}

function SidebarHistoryRow({
  commit,
  isHead,
  isSelected,
  hasPrevious,
  hasNext,
  onClick,
}: {
  commit: GitCommitSummary;
  isHead: boolean;
  isSelected: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onClick: () => void;
}) {
  const totals = getChangeTotals(commit.changes);

  return (
    <button
      className={`desktop-history-row ${isSelected ? "active" : ""}`}
      type="button"
      onClick={onClick}
      title={commit.message}
    >
      <span className="desktop-history-graph" aria-hidden="true">
        {hasPrevious && <i className="before" />}
        {hasNext && <i className="after" />}
        <i className="dot" />
      </span>
      <span className="desktop-history-row-main">
        <span className="desktop-history-row-title">
          {isHead && <span className="desktop-head-badge">HEAD</span>}
          <span>{commit.message || "(no message)"}</span>
        </span>
        <span className="desktop-history-row-stat">
          <span className="added">+{totals.additions}</span>
          <span className="deleted">-{totals.deletions}</span>
        </span>
      </span>
    </button>
  );
}

export function SettingsView({
  workspace,
  activeSection,
  gitStatus,
  gitStatusLoading,
  gitStatusError,
  themeMode,
  fileIconTheme,
  sidebarNavigationLayout,
  filesVisibilitySettings,
  rightSidebarToolsSettings,
  onThemeModeChange,
  onFileIconThemeChange,
  onSidebarNavigationLayoutChange,
  onFilesVisibilitySettingsChange,
  onRightSidebarToolsSettingsChange,
  onUnlinkWorkspace,
  onRefreshGitStatus,
}: SettingsViewProps) {
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [copiedRemoteKey, setCopiedRemoteKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [draggingRightSidebarToolId, setDraggingRightSidebarToolId] = useState<RightSidebarToolId | null>(null);
  const orderedRightSidebarTools = rightSidebarToolsSettings.order
    .map((toolId) => RIGHT_SIDEBAR_TOOL_DEFINITIONS.find((tool) => tool.id === toolId))
    .filter((tool): tool is typeof RIGHT_SIDEBAR_TOOL_DEFINITIONS[number] => Boolean(tool));

  const unlinkWorkspace = async () => {
    if (unlinking) return;
    const confirmed = window.confirm(
      `Unlink "${workspace.name}" from puppyone? Local files will stay on disk. You will choose a folder again next time.`,
    );
    if (!confirmed) return;

    setUnlinking(true);
    setUnlinkError(null);
    try {
      await onUnlinkWorkspace();
    } catch (error) {
      setUnlinkError(error instanceof Error ? error.message : String(error));
      setUnlinking(false);
    }
  };

  const copyRemoteUrl = async (key: string, url: string) => {
    setCopyError(null);
    try {
      await writeClipboardText(url);
      setCopiedRemoteKey(key);
      window.setTimeout(() => setCopiedRemoteKey((current) => current === key ? null : current), 1500);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : String(error));
    }
  };

  if (activeSection === "git") {
    return (
      <GitSettingsView
        status={gitStatus}
        loading={gitStatusLoading}
        error={gitStatusError}
        copiedRemoteKey={copiedRemoteKey}
        copyError={copyError}
        onCopyRemoteUrl={copyRemoteUrl}
        onRefresh={onRefreshGitStatus}
      />
    );
  }

  if (activeSection === "files") {
    return (
      <FilesSettingsView
        settings={filesVisibilitySettings}
        onChange={onFilesVisibilitySettingsChange}
      />
    );
  }

  if (activeSection === "appearance") {
    return (
      <section className="desktop-utility-view desktop-settings-view">
        <div className="desktop-utility-body desktop-settings-body">
          <div className="desktop-settings-section">
            <SettingsSectionHeader title="Appearance" detail="Local display preferences for this device." />
            <div className="desktop-settings-list">
              <div className="desktop-settings-row desktop-settings-row-control">
                <span>Theme</span>
                <div className="desktop-theme-segment" aria-label="Theme mode">
                  <button
                    className={themeMode === "system" ? "active" : ""}
                    type="button"
                    onClick={() => onThemeModeChange("system")}
                  >
                    <Monitor size={14} />
                    <span>System</span>
                  </button>
                  <button
                    className={themeMode === "light" ? "active" : ""}
                    type="button"
                    onClick={() => onThemeModeChange("light")}
                  >
                    <Sun size={14} />
                    <span>Light</span>
                  </button>
                  <button
                    className={themeMode === "dark" ? "active" : ""}
                    type="button"
                    onClick={() => onThemeModeChange("dark")}
                  >
                    <Moon size={14} />
                    <span>Dark</span>
                  </button>
                </div>
              </div>
              <div className="desktop-settings-row desktop-settings-row-control">
                <span>File icons</span>
                <div className="desktop-theme-segment desktop-file-icon-theme-segment" aria-label="File icon theme">
                  {FILE_ICON_THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      className={fileIconTheme === theme.id ? "active" : ""}
                      type="button"
                      title={theme.description}
                      onClick={() => onFileIconThemeChange(theme.id)}
                    >
                      <FileGlyphIcon name="document.md" size={14} theme={theme.id} />
                      <span>{theme.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="desktop-settings-row desktop-settings-row-control">
                <span>Navigation</span>
                <div className="desktop-theme-segment desktop-sidebar-layout-segment" aria-label="Sidebar navigation layout">
                  {SIDEBAR_NAVIGATION_LAYOUT_OPTIONS.map((option) => {
                    const Icon = option.placement === "top" ? PanelTop : PanelBottom;
                    return (
                      <button
                        className={sidebarNavigationLayout === option.value ? "active" : ""}
                        type="button"
                        key={option.value}
                        onClick={() => onSidebarNavigationLayoutChange(option.value)}
                      >
                        <Icon size={14} />
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="desktop-settings-row desktop-settings-row-control desktop-settings-tools-row">
                <span>Right sidebar</span>
                <div className="desktop-settings-tool-list">
                  {orderedRightSidebarTools.map((tool) => {
                    const Icon = tool.icon;
                    return (
                      <div
                        className={`desktop-settings-tool-item ${draggingRightSidebarToolId === tool.id ? "dragging" : ""}`}
                        key={tool.id}
                        draggable={orderedRightSidebarTools.length > 1}
                        onDragStart={(event) => {
                          setDraggingRightSidebarToolId(tool.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", tool.id);
                        }}
                        onDragOver={(event) => {
                          if (!draggingRightSidebarToolId || draggingRightSidebarToolId === tool.id) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const sourceToolId = readRightSidebarDragToolId(event.dataTransfer.getData("text/plain")) ?? draggingRightSidebarToolId;
                          if (!sourceToolId || sourceToolId === tool.id) return;
                          onRightSidebarToolsSettingsChange({
                            ...rightSidebarToolsSettings,
                            order: moveRightSidebarTool(rightSidebarToolsSettings.order, sourceToolId, tool.id),
                          });
                          setDraggingRightSidebarToolId(null);
                        }}
                        onDragEnd={() => setDraggingRightSidebarToolId(null)}
                      >
                        <span className="desktop-settings-tool-drag-handle" aria-hidden="true">
                          <GripVertical size={14} />
                        </span>
                        <span className="desktop-settings-tool-label">
                          <Icon size={14} />
                          <span>{tool.label}</span>
                        </span>
                        <label className="desktop-settings-switch">
                          <input
                            type="checkbox"
                            checked={rightSidebarToolsSettings.enabled[tool.id]}
                            onChange={(event) => onRightSidebarToolsSettingsChange({
                              ...rightSidebarToolsSettings,
                              enabled: {
                                ...rightSidebarToolsSettings.enabled,
                                [tool.id]: event.target.checked,
                              },
                            })}
                          />
                          <span aria-hidden="true" />
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body">
        <div className="desktop-settings-section">
          <SettingsSectionHeader title="Workspace" detail="Local folder binding for this puppyone desktop app." />
          <div className="desktop-settings-list">
            <div className="desktop-settings-row">
              <span>Name</span>
              <strong>{workspace.name}</strong>
            </div>
            <div className="desktop-settings-row">
              <span>Path</span>
              <strong>{workspace.path}</strong>
            </div>
            <div className="desktop-settings-row">
              <span>Mode</span>
              <strong>Local</strong>
            </div>
            <div className="desktop-settings-row">
              <span>Status</span>
              <strong className="desktop-settings-status">
                <ShieldCheck size={14} />
                Protected
              </strong>
            </div>
            <div className="desktop-settings-row desktop-settings-row-control">
              <span>Workspace binding</span>
              <button
                className="desktop-settings-action danger"
                type="button"
                disabled={unlinking}
                title="Unlink workspace"
                onClick={() => void unlinkWorkspace()}
              >
                <Unlink size={14} />
                <span>{unlinking ? "Unlinking..." : "Unlink"}</span>
              </button>
            </div>
            {unlinkError && <div className="desktop-utility-empty danger">{unlinkError}</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function FilesSettingsView({
  settings,
  onChange,
}: {
  settings: FilesVisibilitySettings;
  onChange: (settings: FilesVisibilitySettings) => void;
}) {
  const savedPatternText = settings.excludePatterns.join("\n");
  const [patternDraft, setPatternDraft] = useState(savedPatternText);
  const normalizedDraft = normalizeExplorerExcludePatterns(patternDraft);
  const patternsDirty = normalizedDraft.join("\n") !== savedPatternText;

  useEffect(() => {
    setPatternDraft(savedPatternText);
  }, [savedPatternText]);

  const applyPatterns = () => {
    onChange({
      ...settings,
      excludePatterns: normalizedDraft,
    });
  };

  const resetPatterns = () => {
    const nextPatterns = [...DEFAULT_EXPLORER_EXCLUDE_PATTERNS];
    setPatternDraft(nextPatterns.join("\n"));
    onChange({
      ...settings,
      excludePatterns: nextPatterns,
    });
  };

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body">
        <div className="desktop-settings-section desktop-files-settings-section">
          <SettingsSectionHeader title="Files" />

          <SettingsGroup title="Explorer">
            <div className="desktop-settings-line desktop-settings-toggle-line desktop-files-toggle-line">
              <span>Show hidden files</span>
              <label className="desktop-settings-switch">
                <input
                  type="checkbox"
                  checked={settings.showHiddenFiles}
                  onChange={(event) => onChange({
                    ...settings,
                    showHiddenFiles: event.target.checked,
                  })}
                />
                <span aria-hidden="true" />
              </label>
            </div>
            <div className="desktop-settings-pattern-editor desktop-files-pattern-editor">
              <div className="desktop-files-pattern-editor-toolbar">
                <span>Exclude patterns</span>
                <small>{normalizedDraft.length} pattern{normalizedDraft.length === 1 ? "" : "s"}</small>
              </div>
              <textarea
                value={patternDraft}
                spellCheck={false}
                onChange={(event) => setPatternDraft(event.target.value)}
              />
              <div className="desktop-settings-pattern-editor-footer">
                <button
                  className="desktop-settings-row-action"
                  type="button"
                  disabled={!patternsDirty}
                  onClick={applyPatterns}
                >
                  <Check size={13} />
                  <span>Apply</span>
                </button>
                <button
                  className="desktop-settings-row-action"
                  type="button"
                  onClick={resetPatterns}
                >
                  <RefreshCw size={13} />
                  <span>Reset</span>
                </button>
              </div>
            </div>
          </SettingsGroup>
        </div>
      </div>
    </section>
  );
}

function readRightSidebarDragToolId(value: string): RightSidebarToolId | null {
  return RIGHT_SIDEBAR_TOOL_DEFINITIONS.some((tool) => tool.id === value)
    ? value as RightSidebarToolId
    : null;
}

function moveRightSidebarTool(
  order: RightSidebarToolId[],
  sourceToolId: RightSidebarToolId,
  targetToolId: RightSidebarToolId,
): RightSidebarToolId[] {
  if (sourceToolId === targetToolId) return order;

  const nextOrder = order.filter((toolId) => toolId !== sourceToolId);
  const targetIndex = nextOrder.indexOf(targetToolId);
  if (targetIndex < 0) return order;

  nextOrder.splice(targetIndex, 0, sourceToolId);
  return nextOrder;
}

function GitSettingsView({
  status,
  loading,
  error,
  copiedRemoteKey,
  copyError,
  onCopyRemoteUrl,
  onRefresh,
}: {
  status: GitStatusSnapshot | null;
  loading: boolean;
  error: string | null;
  copiedRemoteKey: string | null;
  copyError: string | null;
  onCopyRemoteUrl: (key: string, url: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const currentBranch = status?.branches.find((branch) => branch.current) ?? null;
  const remotes = status?.remotes ?? [];
  const localBranchCount = status?.branches.filter((branch) => !branch.remote).length ?? 0;
  const remoteBranchCount = status?.branches.filter((branch) => branch.remote).length ?? 0;
  const puppyoneRemote = remotes
    .map((remote) => ({ remote, info: parsePuppyoneRemote(remote.fetchUrl ?? remote.pushUrl) }))
    .find((entry) => entry.info);
  const cloudRemote = puppyoneRemote?.remote ?? null;
  const cloudInfo = puppyoneRemote?.info ?? null;
  const cloudRemoteUrl = cloudRemote ? cloudRemote.fetchUrl ?? cloudRemote.pushUrl : null;
  const cloudCopyKey = cloudRemoteUrl ? `${cloudRemote?.name}:${cloudRemoteUrl}` : "";

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body">
        <div className="desktop-settings-section">
          <div className="desktop-settings-heading-row">
            <SettingsSectionHeader title="Git" />
            <button className="desktop-settings-action" type="button" onClick={onRefresh} disabled={loading}>
              <RefreshCw size={14} className={loading ? "spin" : undefined} />
              <span>Refresh</span>
            </button>
          </div>

          {error ? (
            <div className="desktop-utility-empty danger">{error}</div>
          ) : loading && !status ? (
            <div className="desktop-utility-empty">Reading Git...</div>
          ) : status && !status.isRepo ? (
            <div className="desktop-utility-empty">Not a Git repository.</div>
          ) : (
            <>
              <SettingsGroup title="Repository">
                <SettingsLine label="Branch" value={status?.branch ?? "Detached"} />
                <SettingsLine label="Branches" value={`${localBranchCount} local, ${remoteBranchCount} remote`} />
                <SettingsLine label="Upstream" value={currentBranch?.upstream ?? "Not configured"} />
                <SettingsLine
                  label="Sync status"
                  value={currentBranch?.upstream ? `${currentBranch.ahead} ahead, ${currentBranch.behind} behind` : "Local only"}
                />
                <SettingsLine label="HEAD" value={status?.headCommitId ? shortCommit(status.headCommitId) : "No commits"} monospace />
              </SettingsGroup>

              <SettingsGroup title="puppyone remote">
                <SettingsLine
                  label="Status"
                  value={cloudInfo ? "Connected" : "Not configured"}
                  tone={cloudInfo ? "success" : undefined}
                />
                {cloudInfo ? (
                  <>
                    <SettingsLine label="Remote" value={cloudRemote?.name ?? "puppyone"} />
                    <SettingsLine label="Host" value={cloudInfo.host} />
                    <SettingsLine
                      label={cloudInfo.kind === "access-point" ? "Access key" : "Project"}
                      value={cloudInfo.displayId}
                      monospace
                    />
                    <SettingsLine
                      label="Git URL"
                      value={cloudRemoteUrl ? maskRemoteUrl(cloudRemoteUrl) : "Not configured"}
                      title={cloudRemoteUrl ?? undefined}
                      monospace
                      action={cloudRemoteUrl ? (
                        <button
                          className="desktop-settings-row-action"
                          type="button"
                          onClick={() => void onCopyRemoteUrl(cloudCopyKey, cloudRemoteUrl)}
                        >
                          <Copy size={13} />
                          <span>{copiedRemoteKey === cloudCopyKey ? "Copied" : "Copy"}</span>
                        </button>
                      ) : undefined}
                    />
                  </>
                ) : (
                  <div className="desktop-settings-muted-row">Not configured</div>
                )}
              </SettingsGroup>

              <SettingsGroup title="Remotes">
                {remotes.length === 0 ? (
                  <div className="desktop-settings-muted-row">No remotes</div>
                ) : (
                  remotes.map((remote) => {
                    const copyUrl = remote.fetchUrl ?? remote.pushUrl;
                    const copyKey = `${remote.name}:${copyUrl ?? ""}`;
                    const remoteInfo = parsePuppyoneRemote(copyUrl);
                    const provider = remoteInfo ? "puppyone" : remoteKindLabel(copyUrl);
                    const pushUrlDiffers = Boolean(remote.fetchUrl && remote.pushUrl && remote.fetchUrl !== remote.pushUrl);
                    return (
                      <div className="desktop-settings-remote-setting" key={remote.name}>
                        <div className="desktop-settings-remote-setting-main">
                          <strong>{remote.name}</strong>
                          <span className={`desktop-settings-badge ${remoteInfo ? "connected" : ""}`}>
                            {provider}
                          </span>
                        </div>
                        <div className="desktop-settings-remote-setting-meta">
                          <strong>{remote.branches.length}</strong>
                          <span>{remote.branches.length === 1 ? "branch" : "branches"}</span>
                        </div>
                        <div className="desktop-settings-remote-setting-url">
                          <code title={copyUrl ?? ""}>{copyUrl ? maskRemoteUrl(copyUrl) : "Not configured"}</code>
                          {pushUrlDiffers && remote.pushUrl && (
                            <small title={remote.pushUrl}>Push URL differs</small>
                          )}
                        </div>
                        <button
                          className="desktop-settings-row-action"
                          type="button"
                          disabled={!copyUrl}
                          onClick={() => copyUrl ? void onCopyRemoteUrl(copyKey, copyUrl) : undefined}
                        >
                          <Copy size={13} />
                          <span>{copiedRemoteKey === copyKey ? "Copied" : "Copy"}</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </SettingsGroup>
              {copyError && <div className="desktop-utility-empty danger">{copyError}</div>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function SettingsSectionHeader({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="desktop-settings-section-header">
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="desktop-settings-group">
      <div className="desktop-settings-group-title">{title}</div>
      <div className="desktop-settings-group-body">{children}</div>
    </section>
  );
}

function SettingsLine({
  label,
  value,
  title,
  action,
  monospace = false,
  tone,
}: {
  label: string;
  value: ReactNode;
  title?: string;
  action?: ReactNode;
  monospace?: boolean;
  tone?: "success";
}) {
  return (
    <div className="desktop-settings-line">
      <span>{label}</span>
      <div className="desktop-settings-line-value">
        <strong
          className={`${monospace ? "desktop-settings-code" : ""} ${tone === "success" ? "success" : ""}`}
          title={title}
        >
          {value}
        </strong>
        {action}
      </div>
    </div>
  );
}

export function SettingsSidebar({ activeSection, onSelectSection }: SettingsSidebarProps) {
  const settingsSections = [
    { id: "workspace", label: "Workspace", icon: Settings, disabled: false },
    { id: "git", label: "Git", icon: GitBranch, disabled: false },
    { id: "appearance", label: "Appearance", icon: Monitor, disabled: false },
    { id: "files", label: "Files", icon: FileText, disabled: false },
  ] satisfies Array<{
    id: SettingsSection;
    label: string;
    icon: typeof Settings;
    disabled: boolean;
  }>;

  return (
    <section className="desktop-tool-sidebar desktop-settings-sidebar">
      <div className="desktop-tool-sidebar-list">
        {settingsSections.map((section) => {
          const Icon = section.icon;
          return (
            <button
              className={`desktop-tool-sidebar-row ${section.id === activeSection ? "active" : ""}`}
              type="button"
              disabled={section.disabled}
              aria-disabled={section.disabled}
              title={section.disabled ? `${section.label} is not available yet` : section.label}
              key={section.id}
              onClick={() => onSelectSection(section.id)}
            >
              <Icon size={15} />
              <span>{section.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CommitDetail({
  commit,
  detail,
  loading,
  error,
  isHead,
}: {
  commit: GitCommitSummary;
  detail: GitCommitDetail | null;
  loading: boolean;
  error: string | null;
  isHead: boolean;
}) {
  const files = detail?.files ?? [];
  const totals = getChangeTotals(files.length > 0 ? files : commit.changes);

  return (
    <div className="desktop-commit-detail">
      <div className="desktop-commit-summary">
        <div className="desktop-commit-id-row">
          <strong title={commit.commit_id}>{shortCommit(commit.commit_id)}</strong>
          {isHead && <span className="desktop-head-badge">HEAD</span>}
        </div>
        <p>{commit.message || "(no message)"}</p>
        <div className="desktop-commit-meta">
          <span>{commit.author_name}</span>
          <span title={formatFullTime(commit.created_at)}>{formatRelativeTime(commit.created_at)}</span>
          <span>{commit.parent_ids.length} parent{commit.parent_ids.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      <div className="desktop-commit-stats">
        <span>
          {totals.files} file{totals.files === 1 ? "" : "s"} changed
        </span>
        <span className="added">+{totals.additions}</span>
        <span className="deleted">-{totals.deletions}</span>
      </div>

      {loading ? (
        <div className="desktop-utility-empty">Loading diff...</div>
      ) : error ? (
        <div className="desktop-utility-empty danger">{error}</div>
      ) : files.length > 0 ? (
        <div className="desktop-file-diff-list">
          {files.map((file) => (
            <FileDiffBlock file={file} key={`${file.status}:${file.oldPath ?? ""}:${file.path}`} />
          ))}
        </div>
      ) : commit.changes.length > 0 ? (
        <div className="desktop-file-diff-list">
          {commit.changes.map((file) => (
            <FileDiffBlock
              file={{
                ...file,
                binary: false,
                lines: [],
              }}
              key={`${file.status}:${file.oldPath ?? ""}:${file.path}`}
            />
          ))}
        </div>
      ) : (
        <div className="desktop-commit-empty">No file changes in this commit.</div>
      )}
    </div>
  );
}

function GitOverview({
  workspace,
  status,
  loading,
  operationLoading,
  operationError,
  onRefresh,
}: {
  workspace: Workspace;
  status: GitStatusSnapshot | null;
  loading: boolean;
  operationLoading: string | null;
  operationError: string | null;
  onRefresh: () => void;
}) {
  const stagedCount = status?.stagedEntries.length ?? 0;
  const workingCount = (status?.unstagedEntries.length ?? 0) + (status?.untrackedEntries.length ?? 0);

  if (status && isEmptyGitRepository(status)) {
    return (
      <InitialGitRepositoryState
        workspace={workspace}
        status={status}
        loading={loading}
        operationLoading={operationLoading}
        operationError={operationError}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <section className="desktop-utility-view desktop-history-detail-view">
      <div className="desktop-history-detail-scroll">
        <div className="desktop-commit-detail">
          <div className="desktop-commit-summary">
            <div className="desktop-commit-id-row">
              <strong>Source Control</strong>
              {operationLoading && <span className="desktop-head-badge">{operationLoading}</span>}
            </div>
            <p>{workspace.path}</p>
          </div>

          {operationError && <div className="desktop-utility-empty danger">{operationError}</div>}

          <div className="desktop-settings-list">
            <div className="desktop-settings-row">
              <span>Staged</span>
              <strong>{stagedCount}</strong>
            </div>
            <div className="desktop-settings-row">
              <span>Changes</span>
              <strong>{workingCount}</strong>
            </div>
            <div className="desktop-settings-row">
              <span>Commits</span>
              <strong>{status?.totalCommits ?? 0}</strong>
            </div>
          </div>

          <button className="desktop-utility-icon-button" type="button" onClick={onRefresh} aria-label="Refresh Git">
            <RefreshCw size={15} className={loading ? "spin" : undefined} />
          </button>
        </div>
      </div>
    </section>
  );
}

function InitialGitRepositoryState({
  workspace,
  status,
  loading,
  operationLoading,
  operationError,
  onRefresh,
}: {
  workspace: Workspace;
  status: GitStatusSnapshot;
  loading: boolean;
  operationLoading: string | null;
  operationError: string | null;
  onRefresh: () => void;
}) {
  const stagedCount = status.stagedEntries.length;
  const workingCount = status.unstagedEntries.length + status.untrackedEntries.length;
  const branchName = displayGitBranch(status);
  const readyForCommit = stagedCount > 0;
  const hasWorkingFiles = workingCount > 0;
  const stateLabel = readyForCommit ? "Ready for first commit" : hasWorkingFiles ? "Changes not staged" : "Clean working tree";
  const stateDetail = readyForCommit
    ? "Write a message in the sidebar and commit."
    : hasWorkingFiles
      ? "Stage the files you want to include."
      : "Add files to this workspace to start history.";

  return (
    <section className="desktop-utility-view desktop-history-detail-view">
      <div className="desktop-history-detail-scroll">
        <div className="desktop-initial-repo-state">
          <div className="desktop-initial-repo-card">
            <div className="desktop-initial-repo-header">
              <span className="desktop-initial-repo-icon" aria-hidden>
                <GitBranch size={17} />
              </span>
              <div>
                <span>Repository initialized</span>
                <strong>{stateLabel}</strong>
              </div>
              <button className="desktop-utility-icon-button" type="button" onClick={onRefresh} aria-label="Refresh Git">
                <RefreshCw size={15} className={loading ? "spin" : undefined} />
              </button>
            </div>

            <p>
              {workspace.name} has a Git repository, but no commits have been created yet. {stateDetail}
            </p>

            <div className="desktop-initial-repo-metrics">
              <div>
                <span>Branch</span>
                <strong>{branchName}</strong>
              </div>
              <div>
                <span>Staged</span>
                <strong>{stagedCount}</strong>
              </div>
              <div>
                <span>Changes</span>
                <strong>{workingCount}</strong>
              </div>
            </div>

            {(operationLoading || operationError) && (
              <div className={`desktop-initial-repo-status ${operationError ? "danger" : ""}`}>
                {operationError ?? operationLoading}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function EmptyGitHistoryState({
  status,
  operationError,
  onRefresh,
  loading,
}: {
  status: GitStatusSnapshot | null;
  operationError: string | null;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <div className="desktop-initial-repo-state compact">
      <div className="desktop-initial-repo-card">
        <div className="desktop-initial-repo-header">
          <span className="desktop-initial-repo-icon" aria-hidden>
            <GitBranch size={17} />
          </span>
          <div>
            <span>History</span>
            <strong>No commits yet</strong>
          </div>
          <button className="desktop-utility-icon-button" type="button" onClick={onRefresh} aria-label="Refresh Git">
            <RefreshCw size={15} className={loading ? "spin" : undefined} />
          </button>
        </div>
        <p>
          {status?.isRepo
            ? `The first commit on ${displayGitBranch(status)} will appear here.`
            : "Initialize a repository to start history."}
        </p>
        {operationError && <div className="desktop-initial-repo-status danger">{operationError}</div>}
      </div>
    </div>
  );
}

function SidebarEmptyHistory({ status }: { status: GitStatusSnapshot | null }) {
  return (
    <div className="desktop-git-sidebar-empty-history">
      <GitBranch size={14} />
      <div>
        <strong>No commits</strong>
        <span>{status?.isRepo ? `${displayGitBranch(status)} has no history yet.` : "Repository not initialized."}</span>
      </div>
    </div>
  );
}

function WorkingFileDetail({
  selection,
  detail,
  loading,
  error,
  operationLoading,
  operationError,
  onStagePaths,
  onUnstagePaths,
  onDiscardPaths,
}: {
  selection: GitWorkingSelection;
  detail: GitCommitDetail | null;
  loading: boolean;
  error: string | null;
  operationLoading: string | null;
  operationError: string | null;
  onStagePaths: (paths: string[]) => Promise<boolean>;
  onUnstagePaths: (paths: string[]) => Promise<boolean>;
  onDiscardPaths: (paths: string[]) => Promise<boolean>;
}) {
  const files = detail?.files ?? [];
  const disabled = Boolean(operationLoading);

  return (
    <section className="desktop-utility-view desktop-history-detail-view">
      <div className="desktop-history-detail-scroll">
        <div className="desktop-commit-detail">
          <div className="desktop-commit-summary">
            <div className="desktop-commit-id-row">
              <strong title={selection.path}>{selection.path}</strong>
              <span className="desktop-head-badge">{selection.staged ? "STAGED" : shortGitStatus(selection.status)}</span>
            </div>
            <p>{selection.staged ? "This change is staged for commit." : "This change is in the working tree."}</p>
          </div>

          <div className="desktop-commit-stats">
            {selection.staged ? (
              <button type="button" className="secondary-action" disabled={disabled} onClick={() => void onUnstagePaths([selection.path])}>
                Unstage
              </button>
            ) : (
              <>
                <button type="button" className="secondary-action" disabled={disabled} onClick={() => void onStagePaths([selection.path])}>
                  Stage
                </button>
                <button type="button" className="danger-action" disabled={disabled} onClick={() => void onDiscardPaths([selection.path])}>
                  Discard
                </button>
              </>
            )}
          </div>

          {operationError && <div className="desktop-utility-empty danger">{operationError}</div>}
          {loading ? (
            <div className="desktop-utility-empty">Loading diff...</div>
          ) : error ? (
            <div className="desktop-utility-empty danger">{error}</div>
          ) : files.length > 0 ? (
            <div className="desktop-file-diff-list">
              {files.map((file) => (
                <FileDiffBlock file={file} key={`${file.status}:${file.oldPath ?? ""}:${file.path}`} />
              ))}
            </div>
          ) : (
            <div className="desktop-commit-empty">No textual diff available.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function FileDiffBlock({ file }: { file: GitFileDiff }) {
  return (
    <section className="desktop-file-diff">
      <div className="desktop-file-diff-header">
        <span className={`desktop-change-badge ${file.status}`}>{statusLabel(file.status)}</span>
        <FileText size={14} />
        <span className="desktop-file-diff-path" title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}>
          {file.oldPath && file.oldPath !== file.path ? `${file.oldPath} -> ` : ""}
          {file.path}
        </span>
        {file.additions != null && file.deletions != null && (
          <span className="desktop-file-diff-stat">
            <span className="added">+{file.additions}</span>
            <span className="deleted">-{file.deletions}</span>
          </span>
        )}
      </div>

      {file.binary ? (
        <div className="desktop-diff-placeholder">Binary file</div>
      ) : file.lines.length === 0 ? (
        <div className="desktop-diff-placeholder">No textual diff available</div>
      ) : (
        <div className="desktop-diff-lines">
          {file.lines.map((line, index) => (
            <DiffLineView line={line} key={index} />
          ))}
        </div>
      )}
    </section>
  );
}

function DiffLineView({ line }: { line: GitDiffLine }) {
  if (line.kind === "hunk") {
    return <div className="desktop-diff-line hunk">{line.text}</div>;
  }

  const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
  return (
    <div className={`desktop-diff-line ${line.kind}`}>
      <span className="line-number">{line.oldLine ?? ""}</span>
      <span className="line-number">{line.newLine ?? ""}</span>
      <span className="line-prefix">{prefix}</span>
      <code>{line.text || " "}</code>
    </div>
  );
}

function GitSectionHeader({
  title,
  count,
  action,
  className,
}: {
  title: string;
  count: number;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`desktop-git-section-row ${className ?? ""}`}>
      <div className="desktop-git-section-title">
        <ChevronRight size={13} className="expanded" />
        <span>{title}</span>
        <small>{count}</small>
      </div>
      {action}
    </div>
  );
}

function WorkingTreeRow({
  entry,
  staged,
  selected,
  operationLoading,
  fileIconTheme,
  onSelect,
  onStagePaths,
  onUnstagePaths,
  onDiscardPaths,
}: {
  entry: GitStatusEntry;
  staged: boolean;
  selected: boolean;
  operationLoading: string | null;
  fileIconTheme: FileIconThemeId;
  onSelect: (selection: GitWorkingSelection) => void;
  onStagePaths: (paths: string[]) => Promise<boolean>;
  onUnstagePaths: (paths: string[]) => Promise<boolean>;
  onDiscardPaths: (paths: string[]) => Promise<boolean>;
}) {
  const disabled = Boolean(operationLoading);
  const displayPath = entry.oldPath && entry.oldPath !== entry.path ? `${entry.oldPath} -> ${entry.path}` : entry.path;
  const displayParts = splitGitDisplayPath(displayPath);
  const statusCode = shortGitStatus(entry.status);

  return (
    <div className={`desktop-working-tree-row ${selected ? "active" : ""}`} title={displayPath}>
      <button
        className="desktop-working-tree-main"
        type="button"
        onClick={() => onSelect({ path: entry.path, status: entry.status, staged })}
      >
        <span className="desktop-working-tree-icon">
          <FileGlyphIcon name={entry.path} size={15} theme={fileIconTheme} />
        </span>
        <span className="desktop-working-tree-copy">
          <span className="desktop-working-tree-name">{displayParts.name}</span>
          {displayParts.directory && <span className="desktop-working-tree-dir">{displayParts.directory}</span>}
        </span>
      </button>
      <span className={`desktop-working-tree-state ${entry.status}`}>{statusCode}</span>
      <div className="desktop-working-tree-actions">
        {staged ? (
          <button
            className="desktop-tool-sidebar-icon"
            type="button"
            title="Unstage"
            aria-label={`Unstage ${entry.path}`}
            disabled={disabled}
            onClick={() => void onUnstagePaths([entry.path])}
          >
            <Minus size={13} />
          </button>
        ) : (
          <>
            <button
              className="desktop-tool-sidebar-icon"
              type="button"
              title="Stage"
              aria-label={`Stage ${entry.path}`}
              disabled={disabled}
              onClick={() => void onStagePaths([entry.path])}
            >
              <Plus size={13} />
            </button>
            <button
              className="desktop-tool-sidebar-icon danger"
              type="button"
              title="Discard"
              aria-label={`Discard ${entry.path}`}
              disabled={disabled}
              onClick={() => void onDiscardPaths([entry.path])}
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function splitGitDisplayPath(path: string) {
  if (path.includes(" -> ")) {
    const [oldPath, newPath] = path.split(" -> ");
    const oldParts = splitSimplePath(oldPath);
    const newParts = splitSimplePath(newPath);
    return {
      name: `${oldParts.name} -> ${newParts.name}`,
      directory: newParts.directory || oldParts.directory,
    };
  }

  return splitSimplePath(path);
}

function splitSimplePath(path: string) {
  const segments = path.split("/");
  const name = segments.pop() || path;
  return {
    name,
    directory: segments.join("/"),
  };
}

function UtilityEmptyState({
  icon,
  message,
  detail,
  tone,
  loading,
  onRefresh,
  action,
}: {
  icon?: ReactNode;
  message: string;
  detail?: string;
  tone?: "danger";
  loading?: boolean;
  onRefresh?: () => void;
  action?: ReactNode;
}) {
  return (
    <section className="desktop-utility-view">
      <div className={`desktop-utility-center ${tone ?? ""}`}>
        {icon}
        <strong>{message}</strong>
        {detail && <span>{detail}</span>}
        {action}
        {onRefresh && (
          <button className="desktop-utility-icon-button" type="button" onClick={onRefresh} aria-label="Refresh Git">
            <RefreshCw size={15} className={loading ? "spin" : undefined} />
          </button>
        )}
      </div>
    </section>
  );
}

function getPuppyoneRemote(status: GitStatusSnapshot | null) {
  for (const remote of status?.remotes ?? []) {
    const info = parsePuppyoneRemote(remote.fetchUrl ?? remote.pushUrl);
    if (info) return { remote, info };
  }

  return null;
}

function parsePuppyoneRemote(rawUrl: string | null) {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const accessPointMatch = url.pathname.match(/^\/git\/ap\/([^/]+)\.git$/);
    if (accessPointMatch) {
      return {
        kind: "access-point" as const,
        host: url.host,
        displayId: maskSecret(accessPointMatch[1]),
      };
    }

    const projectMatch = url.pathname.match(/^\/git\/([^/]+)\.git$/);
    if (projectMatch) {
      return {
        kind: "project" as const,
        host: url.host,
        displayId: projectMatch[1],
      };
    }
  } catch {
    return null;
  }

  return null;
}

function maskRemoteUrl(rawUrl: string) {
  let masked = rawUrl.replace(/\/git\/ap\/([^/]+)\.git/g, (_match, accessKey: string) => {
    return `/git/ap/${maskSecret(accessKey)}.git`;
  });

  try {
    const url = new URL(masked);
    if (url.password) url.password = "••••";
    if (url.username) url.username = maskSecret(url.username);
    masked = url.toString();
  } catch {
    // Non-URL remotes, such as scp-like SSH remotes, are displayed as-is.
  }

  return masked;
}

function maskSecret(value: string) {
  if (value.length <= 10) return "••••";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function remoteKindLabel(rawUrl: string | null) {
  if (!rawUrl) return "git";
  const normalized = rawUrl.toLowerCase();
  if (normalized.includes("puppyone")) return "puppyone";
  if (normalized.includes("github.com")) return "GitHub";
  if (normalized.includes("gitlab.com")) return "GitLab";
  if (normalized.includes("bitbucket.org")) return "Bitbucket";
  if (/^[\w.-]+@[\w.-]+:/.test(rawUrl)) return "SSH";
  return "git";
}

async function writeClipboardText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard write failed.");
  }
}

function getChangeTotals(changes: Array<{ additions: number | null; deletions: number | null }>) {
  return changes.reduce<{ files: number; additions: number; deletions: number }>(
    (totals, change) => ({
      files: totals.files + 1,
      additions: totals.additions + (change.additions ?? 0),
      deletions: totals.deletions + (change.deletions ?? 0),
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}

function shortGitStatus(status: string) {
  if (status === "untracked") return "U";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "renamed") return "R";
  if (status === "modified") return "M";
  return "C";
}

function statusLabel(status: string) {
  if (status === "untracked") return "Untracked";
  if (status === "added") return "Added";
  if (status === "deleted") return "Deleted";
  if (status === "renamed") return "Renamed";
  if (status === "copied") return "Copied";
  if (status === "modified") return "Modified";
  return "Changed";
}

function isEmptyGitRepository(status: GitStatusSnapshot) {
  return status.isRepo && !status.headCommitId && status.totalCommits === 0;
}

function displayGitBranch(status: GitStatusSnapshot) {
  return status.branch && status.branch !== "detached" ? status.branch : "initial branch";
}

function shortCommit(commitId: string) {
  return commitId.slice(0, 8);
}

function formatRelativeTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

function formatFullTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
