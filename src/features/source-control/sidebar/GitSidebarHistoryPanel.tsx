import { ChevronRight, GitBranch } from "lucide-react";
import {
  STANDARD_CONTROL_SIZE,
  VirtualSidebarList,
  useCssPixelCustomProperty,
} from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { useId, useRef } from "react";
import type { GitCommitSummary, GitStatusSnapshot } from "../../../types/electron";
import { displayGitBranch } from "../viewModel";
import { SourceControlDots } from "./GitSidebarPrimitives";

export function GitSidebarHistoryPanel({
  commits,
  selectedCommitId,
  status,
  loading,
  expanded,
  onToggle,
  onSelectCommit,
}: {
  commits: GitCommitSummary[];
  selectedCommitId: string | null;
  status: GitStatusSnapshot | null;
  loading: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelectCommit: (commitId: string) => void;
}) {
  const { t, formatNumber } = useLocalization();
  const historyContentId = useId();
  const virtualListRef = useRef<HTMLOListElement | null>(null);
  const virtualRowSize = useCssPixelCustomProperty(
    virtualListRef,
    "--desktop-sidebar-virtual-row-size",
    STANDARD_CONTROL_SIZE + 2,
  );
  const historyIsConfirmedEmpty = status?.isRepo === true && status.totalCommits === 0;

  return (
    <section className={`desktop-git-history-drawer ${expanded ? "expanded" : "collapsed"}`}>
      <button
        className="desktop-git-history-drawer-header"
        type="button"
        aria-expanded={expanded}
        aria-controls={historyContentId}
        onClick={onToggle}
      >
        <ChevronRight className={`po-disclosure-icon ${expanded ? "expanded" : ""}`} />
        <span>{t("source-control.history.title")}</span>
        <small>{formatNumber(commits.length || status?.totalCommits || 0)}</small>
      </button>

      {expanded && (
        <div id={historyContentId} className="desktop-git-history-drawer-content">
          {commits.length > 0 ? (
            <VirtualSidebarList
              className="desktop-history-list desktop-history-virtual-list"
              ariaLabel={t("source-control.history.ariaLabel")}
              items={commits}
              listRef={virtualListRef}
              rowSize={virtualRowSize}
              activeIndex={commits.findIndex((commit) => commit.commit_id === selectedCommitId)}
              getKey={(commit) => commit.commit_id}
              renderRow={(commit, index) => (
                <SidebarHistoryRow
                  commit={commit}
                  isHead={commit.commit_id === status?.headCommitId}
                  isSelected={commit.commit_id === selectedCommitId}
                  hasPrevious={index > 0}
                  hasNext={index < commits.length - 1}
                  onClick={() => onSelectCommit(commit.commit_id)}
                />
              )}
            />
          ) : loading ? (
            <div className="desktop-git-history-loading">
              <SourceControlDots />
              <span>{t("source-control.status.readingHistory")}</span>
            </div>
          ) : historyIsConfirmedEmpty ? (
            <SidebarEmptyHistory status={status} />
          ) : null}
        </div>
      )}
    </section>
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
  const { t, formatNumber } = useLocalization();
  const totals = getChangeTotals(commit.changes);
  const hasAdditions = totals.additions > 0;
  const hasDeletions = totals.deletions > 0;
  const hasStats = hasAdditions || hasDeletions;
  const exactStats = [
    hasAdditions ? `+${formatNumber(totals.additions)}` : null,
    hasDeletions ? `-${formatNumber(totals.deletions)}` : null,
  ].filter(Boolean).join(" ");
  const compactNumber = (value: number) => formatNumber(value, {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  });

  return (
    <button
      className={`desktop-history-row ${isSelected ? "active" : ""}`}
      type="button"
      onClick={onClick}
      title={commit.message}
    >
      <span className="desktop-history-graph" aria-hidden="true" dir="ltr">
        {hasPrevious && <i className="before" />}
        {hasNext && <i className="after" />}
        <i className="dot" />
      </span>
      <span className="desktop-history-row-main">
        <span className="desktop-history-row-title">
          {isHead && <span className="desktop-head-badge">HEAD</span>}
          <bdi className="desktop-history-row-message">
            {commit.message || t("source-control.commit.noMessage")}
          </bdi>
        </span>
        {hasStats && (
          <span className="desktop-history-row-stat" title={exactStats} aria-label={exactStats}>
            {hasAdditions && <span className="added">+{compactNumber(totals.additions)}</span>}
            {hasDeletions && <span className="deleted">-{compactNumber(totals.deletions)}</span>}
          </span>
        )}
      </span>
    </button>
  );
}

function SidebarEmptyHistory({ status }: { status: GitStatusSnapshot | null }) {
  const { t } = useLocalization();
  return (
    <div className="desktop-git-sidebar-empty-history">
      <GitBranch size={14} />
      <div>
        <strong>{t("source-control.history.noCommits")}</strong>
        <span>{status?.isRepo
          ? t("source-control.history.branchEmpty", { branch: bidiIsolate(displayGitBranch(status, t("source-control.branch.initial"))) })
          : t("source-control.history.notInitialized")}</span>
      </div>
    </div>
  );
}

function getChangeTotals(changes: Array<{ additions: number | null; deletions: number | null }>) {
  return changes.reduce<{ additions: number; deletions: number }>(
    (totals, change) => ({
      additions: totals.additions + (change.additions ?? 0),
      deletions: totals.deletions + (change.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );
}
