import type { GitFileDiff } from "../../../types/electron";
import type { MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { FormatAwareDiff } from "./FormatAwareDiff";
import { resolveDiffViewer } from "./core/registry";

export type GitFileDiffSurfaceProps = {
  file: GitFileDiff;
  canOpenFile?: boolean;
  onOpenFile?: (path: string) => void;
  contentMode?: "diff" | "metadata";
};

/** Canonical file-level diff chrome shared by Changes and History. */
export function GitFileDiffSurface({
  file,
  canOpenFile = false,
  onOpenFile,
  contentMode = "diff",
}: GitFileDiffSurfaceProps) {
  const { formatNumber, t } = useLocalization();
  const resolvedViewer = resolveDiffViewer(file);
  const format = resolvedViewer.format;
  const displayPath = file.oldPath && file.oldPath !== file.path
    ? `${file.oldPath} → ${file.path}`
    : file.path;
  const displayName = getGitFileName(file);

  return (
    <section
      className="desktop-file-diff"
      data-change-kind={file.status}
      data-content-mode={contentMode}
    >
      <div className="desktop-file-diff-header" data-file-format={format.id}>
        <div className="desktop-file-diff-identity" title={displayPath} aria-label={displayPath} dir="ltr">
          <span className="desktop-file-diff-name">{displayName}</span>
          <span className={`desktop-change-badge ${file.status}`}>{getGitChangeLabel(file.status, t)}</span>
        </div>
        {file.additions != null && file.deletions != null && (
          <span className="desktop-file-diff-stat" aria-label={t("source-control.diff.changeStats", {
            additions: file.additions,
            deletions: file.deletions,
          })}>
            <span className="added">+{formatNumber(file.additions)}</span>
            <span className="deleted">−{formatNumber(file.deletions)}</span>
          </span>
        )}
      </div>

      {contentMode === "diff" && (
        <FormatAwareDiff
          file={file}
          canOpenFile={canOpenFile}
          onOpenFile={onOpenFile}
          resolvedViewer={resolvedViewer}
        />
      )}
    </section>
  );
}

function getGitFileName(file: GitFileDiff) {
  const current = splitGitPath(file.path);
  if (!file.oldPath || file.oldPath === file.path) return current.name;

  const previous = splitGitPath(file.oldPath);
  return previous.name === current.name
    ? current.name
    : `${previous.name} → ${current.name}`;
}

function splitGitPath(value: string) {
  const separator = value.lastIndexOf("/");
  return { name: separator < 0 ? value : value.slice(separator + 1) };
}

function getGitChangeLabel(status: GitFileDiff["status"], t: MessageFormatter) {
  if (status === "added") return t("source-control.diff.change.added");
  if (status === "deleted") return t("source-control.diff.change.deleted");
  if (status === "renamed") return t("source-control.diff.change.renamed");
  if (status === "copied") return t("source-control.diff.change.copied");
  if (status === "modified") return t("source-control.diff.change.modified");
  return t("source-control.diff.change.changed");
}
