import {
  ChevronDown,
  Clock3,
  RefreshCw,
} from "lucide-react";
import { useRef, type CSSProperties } from "react";
import { useLocalization } from "@puppyone/localization/react";
import {
  SidebarRoot,
  STANDARD_CONTROL_SIZE,
  VirtualSidebarList,
  useCssPixelCustomProperty,
} from "@puppyone/shared-ui";
import { PageLoading } from "../../../components/loading";
import type { CloudBranchGraphRow } from "../graph/model";
import {
  formatCloudGraphAuthor,
  formatCloudGraphLabel,
  formatCloudGraphRowMessage,
} from "../cloudPresentation";
import { formatRelativeTime, shortCommit } from "../utils";
import { HistoryGraphVisual, getHistoryGraphWidth } from "../graph/HistoryGraphVisual";
import type { CloudProjectHistoryProps } from "./types";

export function CloudProjectHistorySidebar({
  rows,
  selectedCommitId,
  loading,
  loadingMore,
  hasMore,
  error,
  warning,
  onSelectCommit,
  onLoadMore,
}: Pick<
  CloudProjectHistoryProps,
  | "rows"
  | "selectedCommitId"
  | "loading"
  | "loadingMore"
  | "hasMore"
  | "error"
  | "warning"
  | "onSelectCommit"
  | "onLoadMore"
>) {
  const { t } = useLocalization();
  const sidebarRef = useRef<HTMLElement>(null);
  const rowHeight = useCssPixelCustomProperty(
    sidebarRef,
    "--cloud-history-row-height",
    STANDARD_CONTROL_SIZE,
  );
  const graphWidth = getHistoryGraphWidth(rows);
  const notice = error ?? warning;

  return (
    <SidebarRoot ref={sidebarRef} className="desktop-cloud-history-sidebar" aria-label={t("cloud.history.projectHistory")}>
      {notice && rows.length > 0 && (
        <div className="desktop-cloud-history-sidebar-warning" role="status">
          {notice}
        </div>
      )}

      {rows.length > 0 ? (
        <VirtualSidebarList
          className="desktop-cloud-history-sidebar-list"
          ariaLabel={t("cloud.history.commitHistory")}
          items={rows}
          rowSize={rowHeight}
          activeIndex={rows.findIndex((row) => row.id === selectedCommitId)}
          getKey={(row) => row.id}
          renderRow={(row) => (
            <CloudHistorySidebarRow
              row={row}
              graphWidth={graphWidth}
              rowHeight={rowHeight}
              selected={row.id === selectedCommitId}
              onSelect={onSelectCommit}
            />
          )}
        />
      ) : (
        <ol
          className="desktop-cloud-history-sidebar-list desktop-cloud-history-sidebar-state-list"
          data-po-scrollbar="sidebar"
          aria-label={t("cloud.history.commitHistory")}
        >
          <li className="desktop-cloud-history-sidebar-state">
            {loading ? (
              <PageLoading variant="fill" label={t("cloud.history.loading")} className="desktop-cloud-history-sidebar-loading" />
            ) : (
              <CloudHistorySidebarEmpty error={error} />
            )}
          </li>
        </ol>
      )}

      {hasMore && (
        <div className="desktop-cloud-history-sidebar-load-more">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void onLoadMore()}
          >
            {loadingMore
              ? <RefreshCw size={11} className="spin" aria-hidden="true" />
              : <ChevronDown size={11} aria-hidden="true" />}
            {t("cloud.common.loadMore")}
          </button>
        </div>
      )}
    </SidebarRoot>
  );
}

function CloudHistorySidebarRow({
  row,
  graphWidth,
  rowHeight,
  selected,
  onSelect,
}: {
  row: CloudBranchGraphRow;
  graphWidth: number;
  rowHeight: number;
  selected: boolean;
  onSelect: (commitId: string) => void;
}) {
  const localization = useLocalization();
  const { formatNumber, t } = localization;
  const isCommit = row.kind === "commit";
  const isCurrentHead = row.labels.some((label) => label.current);
  const message = formatCloudGraphRowMessage(row, t);
  const author = formatCloudGraphAuthor(row, t);
  const meta = [author, row.createdAt ? formatRelativeTime(row.createdAt, localization) : null]
    .filter(Boolean)
    .join(" · ");
  const additions = row.stats?.additions ?? 0;
  const deletions = row.stats?.deletions ?? 0;
  const contents = (
    <>
      <span
        className="desktop-cloud-history-graph-cell"
        style={getCloudHistoryGraphCellStyle(graphWidth)}
        aria-hidden="true"
        dir="ltr"
      >
        <HistoryGraphVisual
          graphWidth={graphWidth}
          height={rowHeight}
          line={row}
          continuationLines={row.continuationLines}
          refMarkers={row.refMarkers}
          node={isCommit ? {
            lane: row.nodeLane,
            color: row.nodeColor,
            current: isCurrentHead,
          } : undefined}
        />
      </span>
      <span className="desktop-cloud-history-sidebar-row-main">
        <span className="desktop-cloud-history-sidebar-row-title">
          {isCurrentHead && <span className="desktop-cloud-history-inline-ref head">HEAD</span>}
          <bdi className="desktop-cloud-history-sidebar-row-message">{message}</bdi>
          {row.labels.filter((label) => (
            !(isCurrentHead && formatCloudGraphLabel(label, t) === "HEAD")
          )).map((label) => (
            <span
              className={`desktop-cloud-history-inline-ref ${label.kind}`}
              key={`${label.kind}:${label.nameCode ?? label.name}`}
            >
              <bdi>{formatCloudGraphLabel(label, t)}</bdi>
            </span>
          ))}
        </span>
        {isCommit && (
          <span
            className="desktop-cloud-history-sidebar-row-stat"
            aria-label={t("source-control.diff.changeStats", { additions, deletions })}
          >
            <span className="added">+{formatNumber(additions)}</span>
            <span className="deleted">-{formatNumber(deletions)}</span>
          </span>
        )}
        {!isCommit && (
          <small className="desktop-cloud-history-sidebar-row-ref-meta" dir="auto">
            {meta || t("cloud.history.unknownCommit")}
          </small>
        )}
      </span>
    </>
  );
  const className = `desktop-cloud-history-sidebar-row ${selected ? "active" : ""} ${isCommit ? "" : "ref-only"}`;

  return (
    <div className="desktop-cloud-history-sidebar-item" data-history-row-kind={row.kind}>
      {isCommit ? (
        <button
          className={className}
          type="button"
          aria-current={selected ? "true" : undefined}
          data-commit-id={row.id}
          title={`${message} (${shortCommit(row.id)})`}
          onClick={() => onSelect(row.id)}
        >
          {contents}
        </button>
      ) : (
        <div className={className} title={message}>
          {contents}
        </div>
      )}
    </div>
  );
}

function getCloudHistoryGraphCellStyle(graphWidth: number): CSSProperties {
  return { "--cloud-history-graph-width": `${graphWidth}px` } as CSSProperties;
}

function CloudHistorySidebarEmpty({ error }: { error: string | null }) {
  const { t } = useLocalization();
  return (
    <div className="desktop-cloud-history-sidebar-empty">
      <Clock3 size={18} aria-hidden="true" />
      <strong>{t(error ? "cloud.history.unavailable" : "cloud.history.noCommits")}</strong>
      <span>{error ?? t("cloud.history.commitsAppearHere")}</span>
    </div>
  );
}
