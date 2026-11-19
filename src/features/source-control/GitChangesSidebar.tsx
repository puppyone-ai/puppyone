import { useDesktopPreference, selectFileIconTheme } from "../../preferencesStore";
import { Tooltip } from "@puppyone/shared-ui";
import { ArrowLeft, History } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { GitCommitDetail } from "../../types/electron";
import { GitSidebar, type GitSidebarProps } from "./SourceControlSidebar";
import { WorkingFileActions, WorkingFileDetail } from "./WorkingFileDetail";
import { useGitViewNavigationFocus } from "./useGitViewNavigationFocus";

export type GitChangesSidebarProps = Omit<GitSidebarProps, "repository"> & Readonly<{
  repository: Omit<GitSidebarProps["repository"], "gitDisplayMode" | "fileIconTheme">;
  workingFileDiff: GitCommitDetail | null;
  workingFileDiffLoading: boolean;
  workingFileDiffError: string | null;
  onOpenFile: (path: string) => void;
  onOpenHistory: () => void;
  focusNavigation?: boolean;
}>;

/**
 * Current-work Changes is a complete right-sidebar surface. Selecting a file
 * replaces the list with its diff inside this surface so the editor remains
 * untouched; Back restores the established Git list and commit workflow.
 */
export function GitChangesSidebar({
  repository: repositoryState,
  view,
  actions,
  cloudBackup,
  workingFileDiff,
  workingFileDiffLoading,
  workingFileDiffError,
  onOpenFile,
  onOpenHistory,
  focusNavigation = false,
}: GitChangesSidebarProps) {
  const gitDisplayMode = useDesktopPreference(s => s.gitDisplayMode);
  const fileIconTheme = useDesktopPreference(selectFileIconTheme);
  const repository = { ...repositoryState, gitDisplayMode, fileIconTheme };
  const { t } = useLocalization();
  const [detailVisible, setDetailVisible] = useState(false);
  const rootRef = useGitViewNavigationFocus(focusNavigation, detailVisible);

  useEffect(() => {
    if (!view.selectedWorkingFile) setDetailVisible(false);
  }, [view.selectedWorkingFile]);

  const closeDetail = () => setDetailVisible(false);
  const selection = view.selectedWorkingFile;

  return (
    <section
      ref={rootRef}
      className="desktop-git-changes-sidebar"
      aria-label={t("source-control.label.changes")}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !detailVisible) return;
        event.stopPropagation();
        closeDetail();
      }}
    >
      <div className="desktop-git-changes-sidebar-content">
        {detailVisible && selection ? (
          <div className="desktop-git-changes-detail">
            <header className="desktop-git-view-header desktop-git-changes-detail-header">
              <Tooltip content={t("shared-ui.navigation.back")}><button
                className="desktop-git-view-back"
                type="button"
                aria-label={t("shared-ui.navigation.back")}
                onClick={closeDetail}
              >
                <ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" />
              </button></Tooltip>
              <WorkingFileActions
                selection={selection}
                operationLoading={view.operationLoading}
                onStagePaths={actions.stagePaths}
                onUnstagePaths={actions.unstagePaths}
                onDiscardPaths={actions.discardPaths}
                onOpenFile={onOpenFile}
              />
            </header>
            <WorkingFileDetail
              selection={selection}
              detail={workingFileDiff}
              loading={workingFileDiffLoading}
              error={workingFileDiffError}
              operationError={view.operationError}
              onOpenFile={onOpenFile}
            />
          </div>
        ) : (
          <>
            <header className="desktop-git-view-header">
              <span className="desktop-git-view-title">
                {t("source-control.label.changes")}
              </span>
              <Tooltip content={t("source-control.history.title")}><button
                className="desktop-git-view-action"
                type="button"
                aria-label={t("source-control.history.title")}
                onClick={onOpenHistory}
              >
                <History size={14} strokeWidth={1.8} aria-hidden="true" />
              </button></Tooltip>
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
