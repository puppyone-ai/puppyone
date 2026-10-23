import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { useLocalization } from "@puppyone/localization/react";
import {
  CloudProjectHistorySidebar,
  CloudProjectHistoryView,
} from "../history";
import { useCloudHistoryController } from "../history/useCloudHistoryController";
import { formatCloudMessage } from "../cloudPresentation";

export function CloudHistorySection({
  projectId,
  projectName,
  cloudSession,
  apiBaseUrl,
  onSessionChange,
  revisionKey,
}: {
  projectId: string;
  projectName: string;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  revisionKey?: string | null;
}) {
  const { t } = useLocalization();
  const history = useCloudHistoryController({
    session: cloudSession,
    projectId,
    apiBaseUrl,
    enabled: true,
    revisionKey,
    onSessionChange,
  });
  const sidebarProps = {
    rows: history.rows,
    selectedCommitId: history.selectedCommitId,
    loading: history.loading,
    loadingMore: history.loadingMore,
    hasMore: history.hasMore,
    error: history.error ? formatCloudMessage(history.error, t) : null,
    warning: history.warning ? formatCloudMessage(history.warning, t) : null,
    onSelectCommit: history.selectCommit,
    onLoadMore: history.loadMore,
  };

  return (
    <section className="desktop-cloud-history-surface" aria-label={t("cloud.history.commitHistoryAria")}>
      <CloudProjectHistorySidebar {...sidebarProps} />
      <CloudProjectHistoryView
        {...sidebarProps}
        projectId={projectId}
        context={{ session: cloudSession, projectId, apiBaseUrl, revisionKey }}
        projectName={projectName}
        history={history.history}
        onRefresh={history.reload}
      />
    </section>
  );
}
