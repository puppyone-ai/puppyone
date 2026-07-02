import { useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { FileText, GitBranch, GripVertical, RefreshCw } from "lucide-react";
import type { Workspace } from "@puppyone/shared-ui";
import type { GitCommitDetail, GitCommitSummary, GitDiffLine, GitFileDiff, GitStatusSnapshot } from "../../types/electron";
import type { GitMainPanel, GitWorkingSelection } from "./types";
import { displayGitBranch } from "./viewModel";

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
  onSelectCommit: (commitId: string) => void;
  onStagePaths: (paths: string[]) => Promise<boolean>;
  onUnstagePaths: (paths: string[]) => Promise<boolean>;
  onDiscardPaths: (paths: string[]) => Promise<boolean>;
  onInitializeRepository: () => Promise<boolean>;
};

const HISTORY_TREE_MIN_WIDTH = 180;
const HISTORY_TREE_DEFAULT_WIDTH = 320;
const HISTORY_TREE_MAX_WIDTH = 520;

function clampHistoryTreeWidth(width: number) {
  return Math.min(Math.max(width, HISTORY_TREE_MIN_WIDTH), HISTORY_TREE_MAX_WIDTH);
}

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
  onSelectCommit,
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
    return (
      <GitHistoryPanel
        commits={historyCommits}
        selectedCommit={selectedCommit}
        selectedCommitId={selectedCommitId ?? selectedCommit?.commit_id ?? null}
        headCommitId={status?.headCommitId ?? null}
        commitDetail={commitDetail}
        commitDetailLoading={commitDetailLoading}
        commitDetailError={commitDetailError}
        status={status}
        operationError={operationError}
        loading={loading}
        onRefresh={onRefresh}
        onSelectCommit={onSelectCommit}
      />
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

function GitHistoryPanel({
  commits,
  selectedCommit,
  selectedCommitId,
  headCommitId,
  commitDetail,
  commitDetailLoading,
  commitDetailError,
  status,
  operationError,
  loading,
  onRefresh,
  onSelectCommit,
}: {
  commits: GitCommitSummary[];
  selectedCommit: GitCommitSummary | null;
  selectedCommitId: string | null;
  headCommitId: string | null;
  commitDetail: GitCommitDetail | null;
  commitDetailLoading: boolean;
  commitDetailError: string | null;
  status: GitStatusSnapshot | null;
  operationError: string | null;
  loading: boolean;
  onRefresh: () => void;
  onSelectCommit: (commitId: string) => void;
}) {
  const [treeWidth, setTreeWidth] = useState<number | null>(null);

  const handleTreeResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();
    const treeElement = event.currentTarget.parentElement;
    const startWidth = treeElement?.getBoundingClientRect().width ?? treeWidth ?? HISTORY_TREE_DEFAULT_WIDTH;
    const startX = event.clientX;
    const maxWidth = Math.min(HISTORY_TREE_MAX_WIDTH, Math.max(HISTORY_TREE_MIN_WIDTH, window.innerWidth * 0.55));

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(Math.max(startWidth + moveEvent.clientX - startX, HISTORY_TREE_MIN_WIDTH), maxWidth);
      setTreeWidth(Math.round(nextWidth));
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove("desktop-history-resizing");
    };

    document.body.classList.add("desktop-history-resizing");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
  };

  const handleTreeResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -16 : 16;
    setTreeWidth((width) => clampHistoryTreeWidth((width ?? HISTORY_TREE_DEFAULT_WIDTH) + delta));
  };

  if (commits.length === 0) {
    return (
      <section className="desktop-utility-view desktop-history-detail-view">
        <div className="desktop-history-detail-scroll">
          <EmptyGitHistoryState status={status} operationError={operationError} onRefresh={onRefresh} loading={loading} />
        </div>
      </section>
    );
  }

  return (
    <section className="desktop-utility-view desktop-history-detail-view desktop-history-panel">
      <aside
        className="desktop-history-panel-tree"
        style={treeWidth === null ? undefined : { width: treeWidth, minWidth: treeWidth }}
        aria-label="Git history"
      >
        <div className="desktop-history-list">
          {commits.map((commit, index) => (
            <SidebarHistoryRow
              key={commit.commit_id}
              commit={commit}
              isHead={commit.commit_id === headCommitId}
              isSelected={commit.commit_id === selectedCommitId}
              hasPrevious={index > 0}
              hasNext={index < commits.length - 1}
              onClick={() => onSelectCommit(commit.commit_id)}
            />
          ))}
        </div>
        <div
          className="desktop-history-panel-tree-resizer"
          role="separator"
          aria-label="Resize history list"
          aria-orientation="vertical"
          aria-valuemin={HISTORY_TREE_MIN_WIDTH}
          aria-valuemax={HISTORY_TREE_MAX_WIDTH}
          aria-valuenow={treeWidth ?? HISTORY_TREE_DEFAULT_WIDTH}
          tabIndex={0}
          title="Drag to resize history"
          onPointerDown={handleTreeResizeStart}
          onKeyDown={handleTreeResizeKeyDown}
          onDoubleClick={() => setTreeWidth(null)}
        >
          <GripVertical size={12} />
        </div>
      </aside>
      <div className="desktop-history-panel-detail">
        <div className="desktop-history-detail-scroll">
          {selectedCommit ? (
            <CommitDetail
              commit={selectedCommit}
              detail={commitDetail}
              loading={commitDetailLoading}
              error={commitDetailError}
              isHead={selectedCommit.commit_id === headCommitId}
            />
          ) : (
            <EmptyGitHistoryState status={status} operationError={operationError} onRefresh={onRefresh} loading={loading} />
          )}
        </div>
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

  const sourceControl = status?.sourceControl ?? null;
  const groups = sourceControl?.groups ?? [];
  const stagedCount = groups.find((group) => group.id === "index")?.resources.length ?? status?.stagedEntries.length ?? 0;
  const workingCount = (
    (groups.find((group) => group.id === "workingTree")?.resources.length ?? status?.unstagedEntries.length ?? 0) +
    (groups.find((group) => group.id === "untracked")?.resources.length ?? status?.untrackedEntries.length ?? 0)
  );
  const mergeCount = groups.find((group) => group.id === "merge")?.resources.length ?? 0;
  const remote = sourceControl?.remote ?? null;
  const incomingCount = remote?.behind ?? 0;
  const committedCount = remote?.ahead ?? 0;
  const hasChanges = incomingCount + committedCount + stagedCount + workingCount + mergeCount > 0;

  return (
    <section className="desktop-utility-view desktop-history-detail-view">
      <div className="desktop-git-default-state">
        <div className="desktop-git-default-copy">
          <span>{hasChanges ? "Select a change to preview" : "PuppyOne backs up your changes"}</span>
        </div>
        {(operationLoading || operationError) && (
          <div className={`desktop-git-default-status ${operationError ? "danger" : ""}`}>
            {operationError ?? operationLoading}
          </div>
        )}
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
  const remote = selection.origin === "remote";
  const committed = selection.origin === "committed";
  const readOnly = remote || committed;

  return (
    <section className="desktop-utility-view desktop-history-detail-view">
      <div className="desktop-history-detail-scroll">
        <div className="desktop-commit-detail">
          <div className="desktop-commit-summary">
            <div className="desktop-commit-id-row">
              <strong title={selection.path}>{selection.path}</strong>
              <span className="desktop-head-badge">{remote ? "REMOTE" : committed ? "COMMITTED" : selection.staged ? "STAGED" : shortGitStatus(selection.status)}</span>
              {!readOnly && (
                <div className="desktop-working-file-actions">
                  {selection.staged ? (
                    <button type="button" className="secondary-action" disabled={disabled} onClick={() => void onUnstagePaths([selection.path])}>
                      Unstage
                    </button>
                  ) : (
                    <>
                      <button type="button" className="danger-action" disabled={disabled} onClick={() => void onDiscardPaths([selection.path])}>
                        Discard
                      </button>
                      <button type="button" className="secondary-action" disabled={disabled} onClick={() => void onStagePaths([selection.path])}>
                        Stage
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
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
