import {
  Clock3,
  RefreshCw,
} from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import "./history.css";
import { PageLoading } from "../../../components/loading";
import { CloudCommitDetail } from "./CloudCommitDetail";
import type { CloudProjectHistoryProps } from "./types";

export function CloudProjectHistoryView({
  projectId,
  projectName,
  history,
  rows,
  selectedCommitId,
  loading,
  error,
  onRefresh,
}: CloudProjectHistoryProps) {
  const { t } = useLocalization();
  const selectedRow = rows.find((row) => row.kind === "commit" && row.id === selectedCommitId) ?? null;
  const selectedCommit = history?.commits.find((commit) => commit.commit_id === selectedRow?.id) ?? null;
  const isHead = Boolean(
    selectedCommit && history?.head_commit_id && selectedCommit.commit_id === history.head_commit_id,
  );

  return (
    <section
      className="desktop-cloud-project-history-view"
      aria-label={`${t("cloud.route.history.title")} · ${projectName}`}
    >
      <div className="desktop-cloud-project-history-body" data-po-scrollbar="content">
        {loading && rows.length === 0 ? (
          <PageLoading variant="fill" label={t("cloud.history.loading")} className="desktop-cloud-project-history-loading" />
        ) : error && rows.length === 0 ? (
          <CloudProjectHistoryEmpty
            title={t("cloud.history.unavailable")}
            detail={error}
            onRefresh={onRefresh}
          />
        ) : rows.length === 0 ? (
          <CloudProjectHistoryEmpty
            title={t("cloud.history.noCommits")}
            onRefresh={onRefresh}
          />
        ) : selectedCommit && selectedRow ? (
          <CloudCommitDetail
            projectId={projectId}
            commit={selectedCommit}
            row={selectedRow}
            isHead={isHead}
            loading={loading}
            onRefresh={onRefresh}
          />
        ) : (
          <CloudProjectHistoryEmpty
            title={t("cloud.history.selectCommit")}
          />
        )}
      </div>
    </section>
  );
}

function CloudProjectHistoryEmpty({
  title,
  detail,
  onRefresh,
}: {
  title: string;
  detail?: string;
  onRefresh?: () => void | Promise<void>;
}) {
  const { t } = useLocalization();
  return (
    <div className="desktop-cloud-project-history-empty">
      <span><Clock3 size={26} aria-hidden="true" /></span>
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
      {onRefresh && (
        <button type="button" onClick={() => void onRefresh()}>
          <RefreshCw size={13} aria-hidden="true" />
          <span>{t("cloud.common.tryAgain")}</span>
        </button>
      )}
    </div>
  );
}
