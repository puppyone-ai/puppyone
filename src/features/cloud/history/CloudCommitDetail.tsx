import { Tooltip } from "@puppyone/shared-ui";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { openCloudApp } from "../../../lib/cloudApi";
import type {
  DesktopCloudHistoryChange,
  DesktopCloudHistoryCommit,
} from "../../../lib/cloudHistoryApi";
import type { GitFileDiff } from "../../../types/electron";
import { GitFileDiffSurface } from "../../source-control/diff/GitFileDiffSurface";
import type { CloudBranchGraphRow } from "../graph/model";
import { formatCloudGraphAuthor, formatCloudGraphLabel } from "../cloudPresentation";
import { formatRelativeTime, shortCommit } from "../utils";

export function CloudCommitDetail({
  projectId,
  commit,
  row,
  isHead,
  loading,
  onRefresh,
}: {
  projectId: string | null;
  commit: DesktopCloudHistoryCommit;
  row: CloudBranchGraphRow;
  isHead: boolean;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
}) {
  const localization = useLocalization();
  const { formatDate, formatNumber, t } = localization;
  const changes = commit.changes;
  const exactTime = commit.created_at ? formatDate(commit.created_at, {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }) : "";
  const author = commit.who || formatCloudGraphAuthor(row, t);
  const additions = row.stats?.additions ?? 0;
  const deletions = row.stats?.deletions ?? 0;

  return (
    <article className="desktop-commit-detail desktop-cloud-commit-detail">
      <div className="desktop-commit-summary desktop-cloud-commit-summary">
        <div className="desktop-commit-id-row desktop-cloud-commit-id-row">
          <Tooltip content={commit.commit_id}><strong dir="ltr">{shortCommit(commit.commit_id)}</strong></Tooltip>
          {isHead && <span className="desktop-head-badge">HEAD</span>}
          {row.labels.filter((label) => (
            !(isHead && formatCloudGraphLabel(label, t) === "HEAD")
          )).map((label) => (
            <span
              className={`desktop-cloud-history-ref-badge ${label.kind}`}
              key={`${label.kind}:${label.nameCode ?? label.name}`}
            >
              <bdi>{formatCloudGraphLabel(label, t)}</bdi>
            </span>
          ))}
          <div className="desktop-cloud-commit-actions">
            <Tooltip content={t("cloud.history.refresh")}><button
              type="button"
              aria-label={t("cloud.history.refresh")}
              disabled={loading}
              onClick={() => void onRefresh()}
                                                          >
              <RefreshCw size={13} className={loading ? "spin" : undefined} aria-hidden="true" />
            </button></Tooltip>
            {projectId && (
              <Tooltip content={t("cloud.history.viewCodeChanges")}><button
                type="button"
                aria-label={t("cloud.history.viewCodeChanges")}
                onClick={() => openCloudApp(`/projects/${projectId}/changes?commit=${encodeURIComponent(commit.commit_id)}`)}
                                                                    >
                <ExternalLink size={13} aria-hidden="true" />
              </button></Tooltip>
            )}
          </div>
        </div>
        <p><bdi>{commit.message || t("cloud.history.updateWorkspace")}</bdi></p>
        <div className="desktop-commit-meta">
          <bdi>{author}</bdi>
          <Tooltip content={exactTime || undefined}><span>
            {commit.created_at
              ? formatRelativeTime(commit.created_at, localization)
              : t("cloud.history.timeUnavailable")}
          </span></Tooltip>
          <span>{t("source-control.commit.parentCount", { count: commit.parent_ids.length })}</span>
        </div>
      </div>

      <div className="desktop-commit-stats desktop-cloud-commit-stats">
        <span>{t("cloud.history.fileChangeCount", { count: changes.length })}</span>
        <span className="added">+{formatNumber(additions)}</span>
        <span className="deleted">-{formatNumber(deletions)}</span>
      </div>

      {changes.length > 0 ? (
        <div className="desktop-file-diff-list desktop-cloud-commit-file-diff-list" aria-label={t("cloud.history.filesChangedAria")}>
          {changes.map((change, index) => (
            <GitFileDiffSurface
              file={toCloudGitFileDiff(change)}
              contentMode="metadata"
              key={`${change.path}:${getCloudHistoryChangeKind(change)}:${index}`}
            />
          ))}
        </div>
      ) : (
        <div className="desktop-commit-empty">{t("cloud.history.noPathChanges")}</div>
      )}
    </article>
  );
}

function toCloudGitFileDiff(change: DesktopCloudHistoryChange): GitFileDiff {
  return {
    path: change.path,
    oldPath: null,
    status: getCloudHistoryChangeKind(change),
    additions: null,
    deletions: null,
    binary: true,
    lines: [],
  };
}

function getCloudHistoryChangeKind(change: DesktopCloudHistoryChange): "added" | "modified" | "deleted" {
  if (change.action === "add" || change.op === "added") return "added";
  if (change.action === "delete" || change.op === "deleted") return "deleted";
  return "modified";
}
