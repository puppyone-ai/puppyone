import { useLocalization } from "@puppyone/localization";
import type { GitCommitDetail as GitCommitDetailModel, GitCommitSummary } from "../../types/electron";
import { GitFileDiffSurface } from "./diff/GitFileDiffSurface";
import { GitSidebarLoadingState } from "./sidebar/GitSidebarPrimitives";

export function GitCommitDetail({
  commit,
  detail,
  loading,
  error,
  isHead,
}: {
  commit: GitCommitSummary;
  detail: GitCommitDetailModel | null;
  loading: boolean;
  error: string | null;
  isHead: boolean;
}) {
  const { t, formatNumber } = useLocalization();
  const files = detail?.files ?? [];
  const totals = getChangeTotals(files.length > 0 ? files : commit.changes);

  return (
    <div className="desktop-commit-detail">
      <div className="desktop-commit-summary">
        <div className="desktop-commit-id-row">
          <strong title={commit.commit_id}>{shortCommit(commit.commit_id)}</strong>
          {isHead && <span className="desktop-head-badge">HEAD</span>}
        </div>
        <p><bdi>{commit.message || t("source-control.commit.noMessage")}</bdi></p>
      </div>

      <div className="desktop-commit-stats">
        <span>{t("source-control.commit.filesChanged", { count: totals.files })}</span>
        <span className="added">+{formatNumber(totals.additions)}</span>
        <span className="deleted">-{formatNumber(totals.deletions)}</span>
      </div>

      {loading ? (
        <GitSidebarLoadingState
          className="desktop-git-detail-loading"
          label={t("source-control.status.loadingDiff")}
        />
      ) : error ? (
        <div className="desktop-utility-empty danger">{error}</div>
      ) : files.length > 0 ? (
        <div className="desktop-file-diff-list">
          {files.map((file) => (
            <GitFileDiffSurface file={file} key={`${file.status}:${file.oldPath ?? ""}:${file.path}`} />
          ))}
        </div>
      ) : commit.changes.length > 0 ? (
        <div className="desktop-file-diff-list">
          {commit.changes.map((file) => (
            <GitFileDiffSurface
              file={{ ...file, binary: false, lines: [] }}
              key={`${file.status}:${file.oldPath ?? ""}:${file.path}`}
            />
          ))}
        </div>
      ) : (
        <div className="desktop-commit-empty">{t("source-control.commit.noFileChanges")}</div>
      )}
    </div>
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

function shortCommit(commitId: string) {
  return commitId.slice(0, 8);
}
