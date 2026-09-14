import { FileText } from "lucide-react";
import type { GitCommitDetail } from "../../types/electron";
import type { GitWorkingSelection } from "./types";
import { GitFileDiffSurface } from "./diff/GitFileDiffSurface";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { GitSidebarLoadingState } from "./sidebar/GitSidebarPrimitives";

export type WorkingFileDetailProps = {
  selection: GitWorkingSelection;
  detail: GitCommitDetail | null;
  loading: boolean;
  error: string | null;
  operationLoading: string | null;
  operationError: string | null;
  onStagePaths: (paths: string[]) => Promise<boolean>;
  onUnstagePaths: (paths: string[]) => Promise<boolean>;
  onDiscardPaths: (paths: string[]) => Promise<boolean>;
  onOpenFile: (path: string) => void;
};

export function WorkingFileDetail({
  selection,
  detail,
  loading,
  error,
  operationLoading,
  operationError,
  onStagePaths,
  onUnstagePaths,
  onDiscardPaths,
  onOpenFile,
}: WorkingFileDetailProps) {
  const { t } = useLocalization();
  const files = detail?.files ?? [];
  const disabled = Boolean(operationLoading);
  const readOnly = selection.origin === "remote" || selection.origin === "committed";
  const canOpenFile = !readOnly && selection.status !== "deleted";

  return (
    <section className="desktop-utility-view desktop-history-detail-view desktop-working-file-detail-view">
      <div className="desktop-history-detail-scroll" data-po-scrollbar="content">
        <div className="desktop-commit-detail">
          {!readOnly && (
            <div className="desktop-working-file-toolbar">
              <div className="desktop-working-file-actions">
                {canOpenFile && (
                  <button
                    type="button"
                    className="secondary-action desktop-working-file-open"
                    title={t("source-control.action.openInData")}
                    onClick={() => onOpenFile(selection.path)}
                  >
                    <FileText size={13} aria-hidden="true" />
                    <span>{t("source-control.action.openFile")}</span>
                  </button>
                )}
                {selection.staged ? (
                  <button type="button" className="secondary-action" disabled={disabled} onClick={() => void onUnstagePaths([selection.path])}>
                    {t("source-control.action.unstage")}
                  </button>
                ) : (
                  <>
                    <button type="button" className="secondary-action" disabled={disabled} onClick={() => void onStagePaths([selection.path])}>
                      {t("source-control.action.stage")}
                    </button>
                    <button type="button" className="danger-action" disabled={disabled} onClick={() => void onDiscardPaths([selection.path])}>
                      {t("source-control.action.discard")}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {operationError && <div className="desktop-utility-empty danger">{operationError}</div>}
          {loading ? (
            <GitSidebarLoadingState
              className="desktop-git-detail-loading"
              label={t("source-control.status.loadingDiffFor", { path: bidiIsolate(selection.path) })}
            />
          ) : error ? (
            <div className="desktop-utility-empty danger">{error}</div>
          ) : files.length > 0 ? (
            <div className="desktop-file-diff-list">
              {files.map((file) => (
                <GitFileDiffSurface
                  file={file}
                  canOpenFile={canOpenFile}
                  onOpenFile={onOpenFile}
                  key={`${file.status}:${file.oldPath ?? ""}:${file.path}`}
                />
              ))}
            </div>
          ) : (
            <div className="desktop-commit-empty">{t("source-control.diff.noText")}</div>
          )}
        </div>
      </div>
    </section>
  );
}
