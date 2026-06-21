import {
  Check,
  ChevronRight,
  Copy,
  FileText,
  GitBranch,
  Minus,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  Unlink,
} from "lucide-react";
import { FileGlyphIcon, type Workspace } from "@puppyone/shared-ui";
import { useState, type ReactNode } from "react";
import type {
  GitCommitDetail,
  GitCommitSummary,
  GitDiffLine,
  GitFileDiff,
  GitStatusEntry,
  GitStatusSnapshot,
} from "../types/electron";
import type { ThemeMode } from "../App";

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

export type SettingsSection = "workspace" | "git" | "appearance" | "advanced";

type SettingsViewProps = {
  workspace: Workspace;
  activeSection: SettingsSection;
  gitStatus: GitStatusSnapshot | null;
  gitStatusLoading: boolean;
  gitStatusError: string | null;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  onUnlinkWorkspace: () => Promise<void>;
  onRefreshGitStatus: () => void;
};

type SettingsSidebarProps = {
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
};

type GitSidebarProps = {
  status: GitStatusSnapshot | null;
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
                )}
              </>
            ) : (
              <>
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
                        onSelect={onSelectWorkingFile}
                        onStagePaths={onStagePaths}
                        onUnstagePaths={onUnstagePaths}
                        onDiscardPaths={onDiscardPaths}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
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
  onThemeModeChange,
  onUnlinkWorkspace,
  onRefreshGitStatus,
}: SettingsViewProps) {
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [copiedRemoteKey, setCopiedRemoteKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

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
    { id: "advanced", label: "Advanced", icon: SlidersHorizontal, disabled: true },
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
  onSelect,
  onStagePaths,
  onUnstagePaths,
  onDiscardPaths,
}: {
  entry: GitStatusEntry;
  staged: boolean;
  selected: boolean;
  operationLoading: string | null;
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
          <FileGlyphIcon name={entry.path} size={15} />
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
