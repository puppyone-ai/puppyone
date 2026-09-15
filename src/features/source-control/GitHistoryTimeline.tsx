import { ChevronDown, GitBranch } from "lucide-react";
import {
  FileGlyphIcon,
  VirtualSidebarList,
  useCssPixelCustomProperty,
  type FileIconThemeId,
} from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { useCallback, useRef, useState } from "react";
import type {
  GitCommitChange,
  GitCommitSummary,
  GitStatusSnapshot,
} from "../../types/electron";
import { displayGitBranch } from "./viewModel";
import { GitSidebarLoadingState } from "./sidebar/GitSidebarPrimitives";

const HISTORY_DATE_ROW_FALLBACK = 36;
const HISTORY_COMMIT_BASE_ROW_FALLBACK = 30;
const HISTORY_FILE_ROW_FALLBACK = 16;
const HISTORY_VISIBLE_FILE_LIMIT = 4;

export function GitHistoryTimeline({
  commits,
  selectedCommitId,
  status,
  loading,
  fileIconTheme,
  onSelectCommit,
}: {
  commits: GitCommitSummary[];
  selectedCommitId: string | null;
  status: GitStatusSnapshot | null;
  loading: boolean;
  fileIconTheme: FileIconThemeId;
  onSelectCommit: (commitId: string) => void;
}) {
  const { t, formatDate, formatRelativeTime } = useLocalization();
  const [collapsedDateKeys, setCollapsedDateKeys] = useState<Set<string>>(() => new Set());
  const virtualListRef = useRef<HTMLOListElement | null>(null);
  const dateRowSize = useCssPixelCustomProperty(
    virtualListRef,
    "--desktop-history-date-row-size",
    HISTORY_DATE_ROW_FALLBACK,
  );
  const commitBaseRowSize = useCssPixelCustomProperty(
    virtualListRef,
    "--desktop-history-commit-base-row-size",
    HISTORY_COMMIT_BASE_ROW_FALLBACK,
  );
  const fileRowSize = useCssPixelCustomProperty(
    virtualListRef,
    "--desktop-history-file-row-size",
    HISTORY_FILE_ROW_FALLBACK,
  );
  const historyIsConfirmedEmpty = status?.isRepo === true && status.totalCommits === 0;
  const rows = createHistoryRows(
    commits,
    t("source-control.history.dateUnavailable"),
    formatDate,
    formatRelativeTime,
    collapsedDateKeys,
  );
  const getHistoryRowSize = useCallback((row: GitHistoryListRow) => {
    if (row.kind === "date") return dateRowSize;
    const visibleFileCount = Math.min(row.commit.changes.length, HISTORY_VISIBLE_FILE_LIMIT);
    const overflowRowCount = row.commit.changes.length > HISTORY_VISIBLE_FILE_LIMIT ? 1 : 0;
    return commitBaseRowSize + (visibleFileCount + overflowRowCount) * fileRowSize;
  }, [commitBaseRowSize, dateRowSize, fileRowSize]);

  if (commits.length > 0) {
    return (
      <VirtualSidebarList
        className="desktop-history-list desktop-history-virtual-list"
        ariaLabel={t("source-control.history.ariaLabel")}
        items={rows}
        listRef={virtualListRef}
        rowSize={getHistoryRowSize}
        activeIndex={rows.findIndex((row) => (
          row.kind === "commit" && row.commit.commit_id === selectedCommitId
        ))}
        getKey={(row) => row.key}
        renderRow={(row) => row.kind === "date" ? (
          <div className="desktop-history-date-group" role="heading" aria-level={3}>
            <button
              type="button"
              aria-expanded={!row.collapsed}
              onClick={() => setCollapsedDateKeys((current) => {
                const next = new Set(current);
                if (next.has(row.dateKey)) next.delete(row.dateKey);
                else next.add(row.dateKey);
                return next;
              })}
            >
              <ChevronDown className="desktop-history-date-disclosure" size={13} aria-hidden="true" />
              <time dateTime={row.dateTime ?? undefined}>{row.label}</time>
              <span className="desktop-history-date-divider" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <GitHistoryRow
            commit={row.commit}
            isSelected={row.commit.commit_id === selectedCommitId}
            fileIconTheme={fileIconTheme}
            onClick={() => onSelectCommit(row.commit.commit_id)}
          />
        )}
      />
    );
  }

  if (loading) {
    return (
      <GitSidebarLoadingState
        className="desktop-git-history-loading"
        label={t("source-control.status.readingHistory")}
      />
    );
  }

  return historyIsConfirmedEmpty ? <GitHistoryEmptyState status={status} /> : null;
}

function GitHistoryRow({
  commit,
  isSelected,
  fileIconTheme,
  onClick,
}: {
  commit: GitCommitSummary;
  isSelected: boolean;
  fileIconTheme: FileIconThemeId;
  onClick: () => void;
}) {
  const { t, formatNumber } = useLocalization();
  const totals = getChangeTotals(commit.changes);
  const hasAdditions = totals.additions > 0;
  const hasDeletions = totals.deletions > 0;
  const exactStats = [
    hasAdditions ? `+${formatNumber(totals.additions)}` : null,
    hasDeletions ? `-${formatNumber(totals.deletions)}` : null,
  ].filter(Boolean).join(" ");
  const compactNumber = (value: number) => formatNumber(value, {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  });
  const visibleChanges = commit.changes.slice(0, HISTORY_VISIBLE_FILE_LIMIT);
  const hiddenChangeCount = Math.max(0, commit.changes.length - visibleChanges.length);

  return (
    <button
      className={`desktop-history-row ${isSelected ? "active" : ""}`}
      type="button"
      onClick={onClick}
      title={commit.message}
    >
      <span className="desktop-history-row-main">
        <span className="desktop-history-row-title">
          <bdi className="desktop-history-row-message">
            {commit.message || t("source-control.commit.noMessage")}
          </bdi>
          {(hasAdditions || hasDeletions) && (
            <span className="desktop-history-row-stat" title={exactStats} aria-label={exactStats}>
              {hasAdditions && <span className="added">+{compactNumber(totals.additions)}</span>}
              {hasDeletions && <span className="deleted">-{compactNumber(totals.deletions)}</span>}
            </span>
          )}
        </span>
        {visibleChanges.length > 0 && (
          <span className="desktop-history-row-files">
            {visibleChanges.map((change) => (
              <GitHistoryFilePreview
                change={change}
                fileIconTheme={fileIconTheme}
                key={`${change.status}:${change.oldPath ?? ""}:${change.path}`}
              />
            ))}
            {hiddenChangeCount > 0 && (
              <span className="desktop-history-row-file-count">
                +{t("source-control.commit.files", { count: hiddenChangeCount })}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

function GitHistoryFilePreview({
  change,
  fileIconTheme,
}: {
  change: GitCommitChange;
  fileIconTheme: FileIconThemeId;
}) {
  const { t } = useLocalization();
  const displayPath = change.status === "renamed" && change.oldPath
    ? `${change.oldPath} → ${change.path}`
    : change.path;
  const statusLabel = t(`source-control.diff.change.${change.status}`);
  const marker = change.status === "added"
    ? "+"
    : change.status === "deleted"
      ? "−"
      : null;

  return (
    <span
      className="desktop-history-row-file"
      data-status={change.status}
      title={`${statusLabel}: ${displayPath}`}
    >
      <span className="desktop-history-row-file-icon" aria-hidden="true">
        <FileGlyphIcon name={change.path} size={14} theme={fileIconTheme} />
      </span>
      {marker && <span className="desktop-history-row-file-marker" aria-hidden="true">{marker}</span>}
      <bdi>{displayPath}</bdi>
    </span>
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

function GitHistoryEmptyState({ status }: { status: GitStatusSnapshot | null }) {
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

type HistoryDateFormatter = (
  value: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
) => string;

type HistoryRelativeTimeFormatter = (
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options?: Intl.RelativeTimeFormatOptions,
) => string;

type GitHistoryListRow = Readonly<{
  kind: "date";
  key: string;
  dateKey: string;
  label: string;
  dateTime: string | null;
  collapsed: boolean;
}> | Readonly<{
  kind: "commit";
  key: string;
  commit: GitCommitSummary;
}>;

function createHistoryRows(
  commits: readonly GitCommitSummary[],
  unavailableLabel: string,
  formatDate: HistoryDateFormatter,
  formatRelativeTime: HistoryRelativeTimeFormatter,
  collapsedDateKeys: ReadonlySet<string>,
) {
  const groupsByDate = new Map<string, {
    key: string;
    date: Date | null;
    commits: GitCommitSummary[];
  }>();

  for (const commit of commits) {
    const date = parseCommitDate(commit.created_at);
    const key = date ? localDateKey(date) : "unavailable";
    const group = groupsByDate.get(key);
    if (group) {
      group.commits.push(commit);
      continue;
    }
    groupsByDate.set(key, { key, date, commits: [commit] });
  }

  const groups = Array.from(groupsByDate.values()).sort((left, right) => {
    if (!left.date) return right.date ? 1 : 0;
    if (!right.date) return -1;
    return right.date.getTime() - left.date.getTime();
  });

  const now = new Date();
  const todayKey = localDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDateKey(yesterday);

  return groups.flatMap<GitHistoryListRow>((group, groupIndex) => {
    const label = group.date
      ? group.key === todayKey
        ? formatRelativeTime(0, "day", { numeric: "auto" })
        : group.key === yesterdayKey
          ? formatRelativeTime(-1, "day", { numeric: "auto" })
          : formatHistoryDate(group.date, now, formatDate)
      : unavailableLabel;
    return [
      {
        kind: "date",
        key: `date:${group.key}:${groupIndex}`,
        dateKey: group.key,
        label,
        dateTime: group.date ? group.key : null,
        collapsed: collapsedDateKeys.has(group.key),
      },
      ...(collapsedDateKeys.has(group.key) ? [] : group.commits.map((commit) => ({
        kind: "commit" as const,
        key: commit.commit_id,
        commit,
      }))),
    ];
  });
}

function parseCommitDate(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatHistoryDate(
  date: Date,
  now: Date,
  formatDate: HistoryDateFormatter,
) {
  return formatDate(date, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}
