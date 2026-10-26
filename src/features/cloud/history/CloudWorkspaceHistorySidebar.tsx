import { useMemo, useState } from "react";
import { ArrowLeft, RefreshCw, X } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { DesktopCloudHistoryChange } from "../../../lib/cloudHistoryApi";
import type { GitCommitSummary } from "../../../types/electron";
import { GitHistoryTimeline, useGitViewNavigationFocus } from "../../source-control";
import { formatCloudMessage } from "../cloudPresentation";
import { CloudCommitDetail } from "./CloudCommitDetail";
import type { CloudHistoryDataState } from "./useCloudHistoryData";
import { useCloudHistoryController } from "./useCloudHistoryController";
import "./history.css";
import "./workspace-sidebar.css";

export function CloudWorkspaceHistorySidebar({ session, projectId, apiBaseUrl, active, revisionKey, onSessionChange, onClose }: {
  session: DesktopCloudSession | null;
  projectId: string;
  apiBaseUrl: string;
  active: boolean;
  revisionKey: string;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const data = useCloudHistoryController({ session, projectId, apiBaseUrl, enabled: active, revisionKey, onSessionChange });
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailContext = makeHistoryContext(session, projectId, apiBaseUrl, revisionKey);
  const selected = data.history?.commits.find(commit => commit.commit_id === detailId);
  const row = data.rows.find(item => item.kind === "commit" && item.id === detailId);
  const detailVisible = Boolean(selected && row);
  const rootRef = useGitViewNavigationFocus(active, detailVisible);
  const back = () => { if (detailVisible) setDetailId(null); else onClose(); };
  const commits = useMemo<GitCommitSummary[]>(() => (data.history?.commits ?? []).map(commit => ({
    commit_id: commit.commit_id, parent_ids: commit.parent_ids, author_name: commit.who, author_email: "",
    created_at: commit.created_at, message: commit.message,
    changes: commit.changes.map(change => ({ path: change.path, oldPath: null, additions: null, deletions: null,
      status: changeStatus(change) })),
  })), [data.history]);
  return <section ref={rootRef} className="desktop-git-history-sidebar desktop-cloud-workspace-history"
    aria-label={t("source-control.history.ariaLabel")} onKeyDown={event => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.stopPropagation(); back(); }
    }}>
    <header className="desktop-git-view-header desktop-git-history-header">
      <Tooltip content={t("shared-ui.navigation.back")}><button type="button" className="desktop-git-view-back"
        aria-label={t("shared-ui.navigation.back")} onClick={back}><ArrowLeft size={15} aria-hidden="true" /></button></Tooltip>
      <span className="desktop-git-view-title">{t("source-control.history.title")}</span>
      <div className="desktop-cloud-history-header-actions">
        <Tooltip content={t("cloud.history.refresh")}><button type="button" className="desktop-git-view-back"
          aria-label={t("cloud.history.refresh")} disabled={data.loading || data.loadingMore} onClick={() => void data.reload()}>
          <RefreshCw size={14} className={data.loading ? "animate-spin" : undefined} aria-hidden="true" />
        </button></Tooltip>
        <Tooltip content={t("common.action.close")}><button type="button" className="desktop-git-view-back"
          aria-label={t("common.action.close")} onClick={onClose}><X size={15} aria-hidden="true" /></button></Tooltip>
      </div>
    </header>
    <div className="desktop-git-history-sidebar-content">
      <HistoryNotices data={data} />
      {selected && row && <div className="desktop-history-detail-scroll" data-po-scrollbar="content">
        <CloudCommitDetail projectId={projectId} commit={selected} row={row}
          context={detailContext}
          isHead={selected.commit_id === data.history?.head_commit_id} loading={data.loading} onRefresh={data.reload} />
      </div>}
      {!detailVisible && !data.loading && !data.error && commits.length === 0 && <div className="desktop-git-history-sidebar-state">
        {t("cloud.history.noCommits")}
      </div>}
      {!detailVisible && (data.loading || commits.length > 0) && <GitHistoryTimeline commits={commits}
        selectedCommitId={data.selectedCommitId} status={null} loading={data.loading}
        onSelectCommit={id => { data.selectCommit(id); setDetailId(id); }} />}
    </div>
    {!detailVisible && data.hasMore && <footer className="desktop-cloud-history-pagination">
      <button type="button" className="desktop-dialog-button" disabled={data.loading || data.loadingMore}
        onClick={() => void data.loadMore()}>{t(data.loadingMore ? "cloud.common.loading" : "cloud.common.loadMore")}</button>
    </footer>}
  </section>;
}

function changeStatus(change: DesktopCloudHistoryChange) {
  if (change.action === "add" || change.op === "added") return "added";
  if (change.action === "delete" || change.op === "deleted") return "deleted";
  return "modified";
}

function HistoryNotices({ data }: { data: CloudHistoryDataState }) {
  const { t } = useLocalization();
  return <>
      {data.error && <div className="desktop-cloud-history-notice" role="alert">
        <p>{formatCloudMessage(data.error, t)}</p>
        <button type="button" className="desktop-dialog-button" disabled={data.loading || data.loadingMore}
          onClick={() => void (data.error?.code === "history-load-more-failed" ? data.loadMore() : data.reload())}>{t("cloud.common.tryAgain")}</button>
      </div>}
      {data.warning && <p className="desktop-cloud-history-notice" role="status">{formatCloudMessage(data.warning, t)}</p>}
  </>;
}

function makeHistoryContext(session: DesktopCloudSession | null, projectId: string | null, apiBaseUrl: string | null, revisionKey?: string | null) {
  return session && projectId ? { session, projectId, apiBaseUrl, revisionKey } : undefined;
}
