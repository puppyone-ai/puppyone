import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import type { GitCommitDetail, GitStatusSnapshot } from "../../types/electron";
import type { GitWorkingSelection } from "./types";
import { WorkingFileDetail } from "./WorkingFileDetail";
import { VersionControlSetupState } from "./VersionControlSetupState";

type GitStatusViewProps = {
  status: GitStatusSnapshot | null;
  selectedWorkingFile: GitWorkingSelection | null;
  workingFileDiff: GitCommitDetail | null;
  workingFileDiffLoading: boolean;
  workingFileDiffError: string | null;
  operationLoading: string | null;
  operationError: string | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onStagePaths: (paths: string[]) => Promise<boolean>;
  onUnstagePaths: (paths: string[]) => Promise<boolean>;
  onDiscardPaths: (paths: string[]) => Promise<boolean>;
  onOpenWorkingFile: (path: string) => void;
  onInitializeRepository: () => Promise<boolean>;
};

export function GitStatusView({
  status,
  selectedWorkingFile,
  workingFileDiff,
  workingFileDiffLoading,
  workingFileDiffError,
  operationLoading,
  operationError,
  loading,
  error,
  onRefresh,
  onStagePaths,
  onUnstagePaths,
  onDiscardPaths,
  onOpenWorkingFile,
  onInitializeRepository,
}: GitStatusViewProps) {
  const { t } = useLocalization();
  if (error) {
    return <UtilityEmptyState tone="danger" message={error} onRefresh={onRefresh} loading={loading} />;
  }

  if (status && !status.isRepo) {
    return (
      <VersionControlSetupState
        operationError={operationError}
        enabling={Boolean(operationLoading)}
        onEnable={() => void onInitializeRepository()}
      />
    );
  }

  if (selectedWorkingFile) {
    return (
      <WorkingFileDetail
        selection={selectedWorkingFile}
        detail={workingFileDiff}
        loading={workingFileDiffLoading}
        error={workingFileDiffError}
        operationLoading={operationLoading}
        operationError={operationError}
        onStagePaths={onStagePaths}
        onUnstagePaths={onUnstagePaths}
        onDiscardPaths={onDiscardPaths}
        onOpenFile={onOpenWorkingFile}
      />
    );
  }

  return <GitPreviewEmptyState />;
}

function GitPreviewEmptyState() {
  const { t } = useLocalization();

  return (
    <section className="desktop-utility-view desktop-history-detail-view">
      <div className="empty-preview">
        <span>{t("source-control.overview.selectChange")}</span>
      </div>
    </section>
  );
}

function UtilityEmptyState({
  icon,
  message,
  detail,
  tone,
  loading,
  onRefresh,
  action,
}: {
  icon?: ReactNode;
  message: string;
  detail?: string;
  tone?: "danger";
  loading?: boolean;
  onRefresh?: () => void;
  action?: ReactNode;
}) {
  const { t } = useLocalization();
  return (
    <section className="desktop-utility-view">
      <div className={`desktop-utility-center ${tone ?? ""}`}>
        {icon}
        <strong>{message}</strong>
        {detail && <span>{detail}</span>}
        {action}
        {onRefresh && (
          <button className="desktop-utility-icon-button" type="button" onClick={onRefresh} aria-label={t("source-control.action.refreshGit")}>
            <RefreshCw size={15} className={loading ? "spin" : undefined} />
          </button>
        )}
      </div>
    </section>
  );
}
