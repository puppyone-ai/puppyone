import { ArrowLeft, History } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { GitCommitDetail } from "../../types/electron";
import { GitSidebar, type GitSidebarProps } from "./SourceControlSidebar";
import { WorkingFileDetail } from "./WorkingFileDetail";

export type GitChangesSidebarProps = GitSidebarProps & Readonly<{
  workingFileDiff: GitCommitDetail | null;
  workingFileDiffLoading: boolean;
  workingFileDiffError: string | null;
  onOpenFile: (path: string) => void;
  onOpenHistory: () => void;
}>;

/**
 * Current-work Changes is a complete right-sidebar surface. Selecting a file
 * replaces the list with its diff inside this surface so the editor remains
 * untouched; Back restores the established Git list and commit workflow.
 */
export function GitChangesSidebar({
  repository,
  view,
  actions,
  cloudBackup,
  workingFileDiff,
  workingFileDiffLoading,
  workingFileDiffError,
  onOpenFile,
  onOpenHistory,
}: GitChangesSidebarProps) {
  const { t } = useLocalization();
  const [detailVisible, setDetailVisible] = useState(false);

  useEffect(() => {
    if (!view.selectedWorkingFile) setDetailVisible(false);
  }, [view.selectedWorkingFile]);

  const closeDetail = () => setDetailVisible(false);

  return (
    <section
      className="desktop-git-changes-sidebar"
      aria-label={t("source-control.label.changes")}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !detailVisible) return;
        event.stopPropagation();
        closeDetail();
      }}
    >
      <div className="desktop-git-changes-sidebar-content">
        {detailVisible && view.selectedWorkingFile ? (
          <div className="desktop-git-changes-detail">
            <button
              className="desktop-history-detail-back"
              type="button"
              aria-label={t("shared-ui.navigation.back")}
              title={t("shared-ui.navigation.back")}
              onClick={closeDetail}
            >
              <ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <WorkingFileDetail
              selection={view.selectedWorkingFile}
              detail={workingFileDiff}
              loading={workingFileDiffLoading}
              error={workingFileDiffError}
              operationLoading={view.operationLoading}
              operationError={view.operationError}
              onStagePaths={actions.stagePaths}
              onUnstagePaths={actions.unstagePaths}
              onDiscardPaths={actions.discardPaths}
              onOpenFile={onOpenFile}
            />
          </div>
        ) : (
          <>
            <header className="desktop-git-view-header">
              <span className="desktop-git-view-title">
                {t("source-control.label.changes")}
              </span>
              <button
                className="desktop-git-view-action"
                type="button"
                title={t("source-control.history.title")}
                aria-label={t("source-control.history.title")}
                onClick={onOpenHistory}
              >
                <History size={14} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </header>
            <GitSidebar
              repository={repository}
              view={view}
              actions={{
                ...actions,
                selectWorkingFile: (selection) => {
                  actions.selectWorkingFile(selection);
                  setDetailVisible(true);
                },
              }}
              cloudBackup={cloudBackup}
            />
          </>
        )}
      </div>
    </section>
  );
}
