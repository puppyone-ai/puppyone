import { Check, Copy } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { useEffect, useState } from "react";
import type { GitCommitDetail as GitCommitDetailModel, GitCommitSummary } from "../../types/electron";
import { writeClipboardText } from "../../lib/clipboard";
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
  const [copiedCommitId, setCopiedCommitId] = useState<string | null>(null);
  const files = detail?.files ?? [];
  const totals = getChangeTotals(files.length > 0 ? files : commit.changes);
  const copied = copiedCommitId === commit.commit_id;
  const copyLabel = copied
    ? t("source-control.commit.idCopied")
    : t("source-control.commit.copyId");
  useEffect(() => {
    if (!copied) return undefined;
    const timeout = window.setTimeout(() => {
      setCopiedCommitId((current) => current === commit.commit_id ? null : current);
    }, 1_500);
    return () => window.clearTimeout(timeout);
  }, [commit.commit_id, copied]);
  const copyCommitId = async () => {
    try {
      await writeClipboardText(commit.commit_id);
      setCopiedCommitId(commit.commit_id);
    } catch {
      setCopiedCommitId(null);
    }
  };

  return (
    <div className="desktop-commit-detail desktop-local-commit-detail">
      <div className="desktop-commit-summary">
        <div className="desktop-commit-title-row">
          <h2><bdi>{commit.message || t("source-control.commit.noMessage")}</bdi></h2>
          {isHead && <span className="desktop-head-badge">HEAD</span>}
        </div>
        <div className="desktop-commit-meta-row">
          <button
            className="desktop-commit-id-copy"
            type="button"
            title={copyLabel}
            aria-label={copyLabel}
            onClick={() => void copyCommitId()}
          >
            <span className="desktop-commit-id-label" aria-hidden="true">
              {t("source-control.commit.id")}
            </span>
            <span dir="ltr">{shortCommit(commit.commit_id)}</span>
            {copied
              ? <Check size={12} strokeWidth={2} aria-hidden="true" />
              : <Copy size={12} strokeWidth={1.8} aria-hidden="true" />}
          </button>
          <div className="desktop-commit-stats">
            <span>{t("source-control.commit.filesChanged", { count: totals.files })}</span>
            <span className="added">+{formatNumber(totals.additions)}</span>
            <span className="deleted">-{formatNumber(totals.deletions)}</span>
          </div>
        </div>
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
