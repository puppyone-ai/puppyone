import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { FileIconThemeId } from "@puppyone/shared-ui";
import type {
  GitCommitDetail as GitCommitDetailModel,
  GitStatusSnapshot,
} from "../../types/electron";
import { GitCommitDetail } from "./GitCommitDetail";
import { GitHistoryTimeline } from "./GitHistoryTimeline";
import { GitRepositorySetupAction } from "./GitRepositorySetupAction";

export type GitHistorySidebarProps = Readonly<{
  status: GitStatusSnapshot | null;
  statusLoading: boolean;
  statusError: string | null;
  selectedCommitId: string | null;
  commitDetail: GitCommitDetailModel | null;
  commitDetailLoading: boolean;
  commitDetailError: string | null;
  historyLoading: boolean;
  fileIconTheme: FileIconThemeId;
  initializing: boolean;
  onInitialize: () => Promise<boolean>;
  onSelectCommit: (commitId: string) => void;
}>;

export function GitHistorySidebar({
  status,
  statusLoading,
  statusError,
  selectedCommitId,
  commitDetail,
  commitDetailLoading,
  commitDetailError,
  historyLoading,
  fileIconTheme,
  initializing,
  onInitialize,
  onSelectCommit,
}: GitHistorySidebarProps) {
  const { t } = useLocalization();
  const [detailVisible, setDetailVisible] = useState(false);
  const commits = status?.allCommits ?? status?.commits ?? [];
  const selectedCommit = commits.find(
    (commit) => commit.commit_id === selectedCommitId,
  ) ?? null;
  useEffect(() => {
    if (!selectedCommit) setDetailVisible(false);
  }, [selectedCommit]);

  return (
    <section
      className="desktop-git-history-sidebar"
      aria-label={t("source-control.history.ariaLabel")}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !detailVisible) return;
        event.stopPropagation();
        setDetailVisible(false);
      }}
    >
      <div className="desktop-git-history-sidebar-content">
        {detailVisible && selectedCommit ? (
          <div className="desktop-history-detail-scroll" data-po-scrollbar="content">
            <button
              className="desktop-history-detail-back"
              type="button"
              aria-label={t("shared-ui.navigation.back")}
              title={t("shared-ui.navigation.back")}
              onClick={() => setDetailVisible(false)}
            >
              <ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <GitCommitDetail
              commit={selectedCommit}
              detail={commitDetail}
              loading={commitDetailLoading}
              error={commitDetailError}
              isHead={selectedCommit.commit_id === status?.headCommitId}
            />
          </div>
        ) : statusError ? (
          <div className="desktop-git-history-sidebar-state danger" role="alert">
            {statusError}
          </div>
        ) : status && !status.isRepo ? (
          <GitRepositorySetupAction
            title={t("source-control.history.inactive")}
            label={t("source-control.history.create")}
            pendingLabel={t("source-control.setup.enabling")}
            pending={initializing}
            onEnable={onInitialize}
          />
        ) : (
          <GitHistoryTimeline
            commits={commits}
            selectedCommitId={selectedCommitId}
            status={status}
            loading={historyLoading || (statusLoading && !status)}
            fileIconTheme={fileIconTheme}
            onSelectCommit={(commitId) => {
              onSelectCommit(commitId);
              setDetailVisible(true);
            }}
          />
        )}
      </div>
    </section>
  );
}
