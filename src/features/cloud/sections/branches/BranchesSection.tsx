import { Fragment, useRef, type CSSProperties } from "react";
import { ExternalLink, GitBranch, RefreshCw } from "lucide-react";
import {
  STANDARD_CONTROL_SIZE,
  useCssPixelCustomProperty,
  type Workspace,
} from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import "./branches.css";
import type { DesktopCloudSession } from "../../../../lib/cloudApi";
import type { GitStatusSnapshot } from "../../../../types/electron";
import { PageLoading } from "../../../../components/loading";
import { openCloudApp } from "../../../../lib/cloudApi";
import type { CloudWorkspaceSection } from "../../types";
import { CloudWebEmpty } from "../../components/shared";
import { useCloudBranchesGitStatus } from "../../data";
import { useCloudHistoryData } from "../../history/useCloudHistoryData";
import {
  buildCloudBranchGraphRows,
  getCloudBranchGraphDiagnostics,
  type CloudBranchGraphLine,
  type CloudBranchGraphRefMarker,
  type CloudBranchGraphRow,
  type CloudBranchGraphStats,
} from "../../graph/model";
import { formatRelativeTime, shortCommit } from "../../utils";
import {
  formatCloudGraphAuthor,
  formatCloudGraphLabel,
  formatCloudGraphRowMessage,
  formatCloudGraphWarning,
  formatCloudMessage,
} from "../../cloudPresentation";

const GRAPH_LANE_WIDTH = 16;
const GRAPH_LEFT_PAD = 10;
const GRAPH_RIGHT_PAD = 12;
const GRAPH_CONTINUATION_HEIGHT = 8;
const GRAPH_STROKE_WIDTH = 2.2;

export function CloudBranchesSection({
  projectId,
  workspace,
  cloudSession,
  apiBaseUrl,
  status,
  loading,
  onCloudSessionChange,
  onOpenProject,
}: {
  projectId: string;
  workspace: Workspace;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  status: GitStatusSnapshot | null;
  loading: boolean;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  onOpenProject: (projectId: string, section?: CloudWorkspaceSection) => void;
}) {
  const { formatNumber, t } = useLocalization();
  const sectionRef = useRef<HTMLElement>(null);
  const graphRowHeight = useCssPixelCustomProperty(
    sectionRef,
    "--cloud-branches-row-height",
    STANDARD_CONTROL_SIZE,
  );
  const gitGraphStatus = useCloudBranchesGitStatus({
    rootPath: workspace.path,
    fallbackStatus: status,
  });
  const effectiveStatus = gitGraphStatus.status ?? status;
  const localCommits = effectiveStatus?.allCommits?.length ? effectiveStatus.allCommits : effectiveStatus?.commits ?? [];
  const hasLocalGraph = localCommits.length > 0;
  const branchData = useCloudHistoryData({
    session: cloudSession,
    projectId,
    apiBaseUrl,
    enabled: !hasLocalGraph,
    revisionKey: effectiveStatus?.headCommitId ?? null,
    onSessionChange: onCloudSessionChange,
  });
  const graphRows = buildCloudBranchGraphRows({
    status: effectiveStatus,
    history: branchData.history,
  });
  const diagnostics = getCloudBranchGraphDiagnostics(
    effectiveStatus,
    graphRows,
    branchData.history,
  );
  const branches = effectiveStatus?.branches ?? [];
  const branchCount = branches.length || (graphRows.length > 0 ? 1 : 0);
  const localBranchCount = branches.filter((branch) => !branch.remote).length;
  const remoteBranchCount = branches.filter((branch) => branch.remote).length;
  const commitCount = graphRows.filter((row) => row.kind === "commit").length;
  const refOnlyCount = graphRows.filter((row) => row.kind === "ref").length;
  const currentBranchName = branches.find((branch) => branch.current)?.name ?? effectiveStatus?.branch ?? null;
  const graphLaneCount = Math.max(
    1,
    ...graphRows.flatMap((row) => [
      row.laneCount,
      row.nodeLane + 1,
      ...row.refMarkers.map((marker) => marker.lane + 1),
      ...row.continuationLines.map((line) => line.laneCount),
    ]),
  );
  const graphWidth = GRAPH_LEFT_PAD + graphLaneCount * GRAPH_LANE_WIDTH + GRAPH_RIGHT_PAD;
  const graphLoading = loading || (gitGraphStatus.loading && graphRows.length === 0) || (branchData.loading && graphRows.length === 0);
  const branchError = gitGraphStatus.error
    ? formatCloudMessage(gitGraphStatus.error, t)
    : branchData.error
      ? formatCloudMessage(branchData.error, t)
      : formatCloudGraphWarning(diagnostics, t);

  return (
    <section ref={sectionRef} className="desktop-cloud-branches-page">
      <header className="desktop-cloud-branches-header">
        <div>
          <span>{t("cloud.route.branches.title")}</span>
          <small>{graphLoading ? t("cloud.common.loading") : formatNumber(branchCount)}</small>
        </div>
        <div className="desktop-cloud-branches-toolbar" data-po-scrollbar="hidden">
          {currentBranchName && (
            <span className="desktop-cloud-branches-token current" title={currentBranchName}>
              {currentBranchName}
            </span>
          )}
          <span className="desktop-cloud-branches-token">{t("cloud.branches.commitCount", { count: commitCount })}</span>
          {localBranchCount > 0 && <span className="desktop-cloud-branches-token local">{t("cloud.branches.localCount", { count: localBranchCount })}</span>}
          {remoteBranchCount > 0 && <span className="desktop-cloud-branches-token remote">{t("cloud.branches.remoteCount", { count: remoteBranchCount })}</span>}
          {refOnlyCount > 0 && <span className="desktop-cloud-branches-token muted">{t("cloud.branches.refOnlyCount", { count: refOnlyCount })}</span>}
          {diagnostics.source === "git-topology" && <span className="desktop-cloud-branches-token ready">{t("cloud.branches.gitTopology")}</span>}
          {diagnostics.source === "missing-topology" && <span className="desktop-cloud-branches-token warning">{t("cloud.branches.linearFallback")}</span>}
          <button
            className="desktop-cloud-row-action"
            type="button"
            onClick={() => void (hasLocalGraph ? gitGraphStatus.reload() : branchData.reload())}
            disabled={gitGraphStatus.loading || branchData.loading}
            title={t(hasLocalGraph ? "cloud.branches.refreshLocal" : "cloud.branches.refreshCloud")}
          >
            <RefreshCw size={13} className={(gitGraphStatus.loading || branchData.loading) ? "spin" : undefined} />
            <span>{t("cloud.common.refresh")}</span>
          </button>
          <button className="desktop-cloud-row-action" type="button" onClick={() => onOpenProject(projectId, "branches")}>
            <ExternalLink size={13} />
            <span>{t("cloud.common.openWeb")}</span>
          </button>
        </div>
      </header>

      <div className="desktop-cloud-branches-body" data-po-scrollbar="content">
        {graphLoading ? (
          <PageLoading variant="fill" label={t("cloud.common.loading")} className="desktop-cloud-web-loading" />
        ) : branchError && graphRows.length === 0 ? (
          <CloudWebEmpty
            icon={GitBranch}
            title={t("cloud.branches.unavailable")}
            detail={branchError}
          />
        ) : graphRows.length === 0 ? (
          <CloudWebEmpty
            icon={GitBranch}
            title={t("cloud.branches.none")}
            detail={t("cloud.branches.noneDetail")}
          />
        ) : (
          <>
            {branchError && <div className="desktop-cloud-branches-warning">{branchError}</div>}
            <div className="desktop-cloud-branches-graph" role="list" aria-label={t("cloud.branches.allHistory")}>
              {graphRows.map((row) => (
                <Fragment key={row.id}>
                  <BranchGraphRow
                    projectId={projectId}
                    row={row}
                    graphWidth={graphWidth}
                    rowHeight={graphRowHeight}
                  />
                  {row.continuationLines.map((line, index) => (
                    <BranchGraphContinuationLine
                      key={`${row.id}:continuation:${index}`}
                      line={line}
                      graphWidth={graphWidth}
                    />
                  ))}
                </Fragment>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function BranchGraphRow({
  projectId,
  row,
  graphWidth,
  rowHeight,
}: {
  projectId: string;
  row: CloudBranchGraphRow;
  graphWidth: number;
  rowHeight: number;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const isCurrentHead = row.labels.some((label) => label.current);
  const message = formatCloudGraphRowMessage(row, t);
  const author = formatCloudGraphAuthor(row, t);
  const content = (
    <>
      <span className="desktop-cloud-branch-graph-cell" style={{ width: graphWidth }} aria-hidden="true" dir="ltr">
        <BranchGraphVisual
          graphWidth={graphWidth}
          height={rowHeight}
          line={row}
          refMarkers={row.refMarkers}
          node={row.kind === "commit"
            ? {
                lane: row.nodeLane,
                color: row.nodeColor,
                current: isCurrentHead,
              }
            : undefined}
        />
      </span>

      <span className="desktop-cloud-branch-graph-message">
        <strong dir="auto">{message}</strong>
        {row.kind === "commit" && (
          <code className="desktop-cloud-branch-graph-sha" dir="ltr">{shortCommit(row.id)}</code>
        )}
        {row.labels.map((label) => (
          <span
            className={`desktop-cloud-branch-label ${label.kind} ${label.current ? "current" : ""}`}
            key={`${row.id}:${label.kind}:${label.nameCode ?? label.name}`}
          >
            <bdi>{formatCloudGraphLabel(label, t)}</bdi>
          </span>
        ))}
        {row.stats && <BranchGraphStats stats={row.stats} />}
        <span className="desktop-cloud-branch-graph-author" title={author} dir="auto">{author}</span>
        <time className="desktop-cloud-branch-graph-date">{row.createdAt ? formatRelativeTime(row.createdAt, localization) : t("cloud.status.unknown")}</time>
      </span>
    </>
  );

  if (row.kind === "ref") {
    return (
      <div
        className="desktop-cloud-branch-graph-row ref-only"
        role="listitem"
        title={message}
      >
        {content}
      </div>
    );
  }

  return (
    <button
      className="desktop-cloud-branch-graph-row"
      type="button"
      role="listitem"
      title={`${message} (${shortCommit(row.id)})`}
      onClick={() => openCloudApp(`/projects/${projectId}/changes?commit=${encodeURIComponent(row.id)}`)}
    >
      {content}
    </button>
  );
}

function BranchGraphContinuationLine({
  line,
  graphWidth,
}: {
  line: CloudBranchGraphLine;
  graphWidth: number;
}) {
  return (
    <div className="desktop-cloud-branch-graph-continuation" aria-hidden="true">
      <span className="desktop-cloud-branch-graph-cell" style={{ width: graphWidth }} dir="ltr">
        <BranchGraphVisual
          graphWidth={graphWidth}
          height={GRAPH_CONTINUATION_HEIGHT}
          line={line}
        />
      </span>
      <span />
    </div>
  );
}

function BranchGraphVisual({
  graphWidth,
  height,
  line,
  refMarkers = [],
  node,
}: {
  graphWidth: number;
  height: number;
  line: CloudBranchGraphLine;
  refMarkers?: CloudBranchGraphRefMarker[];
  node?: { lane: number; color: string; current: boolean };
}) {
  const nodeX = node ? getGraphLaneX(node.lane) : 0;
  const middleY = height / 2;

  return (
    <span className="desktop-cloud-branch-graph-visual" dir="ltr" style={{ width: graphWidth, height }}>
      <svg
        className="desktop-cloud-branch-graph-svg"
        width={graphWidth}
        height={height}
        viewBox={`0 0 ${graphWidth} ${height}`}
        focusable="false"
      >
        {line.segments.map((segment, index) => (
          <path
            className="desktop-cloud-branch-graph-segment"
            // Segment order in the Git prefix is the stable draw order for a single row.
            key={`${index}:${segment.fromLane}:${segment.toLane}:${segment.from}:${segment.to}`}
            d={buildGraphSegmentPath(segment, height)}
            style={{ stroke: segment.color } as CSSProperties}
          />
        ))}
        {refMarkers.map((marker) => {
          const markerX = getGraphLaneX(marker.lane);
          return (
            <g
              className={`desktop-cloud-branch-graph-ref ${marker.kind}`}
              key={`${marker.lane}:${marker.label}`}
              transform={`translate(${markerX} ${middleY})`}
            >
              <rect
                x="-5.5"
                y="-5.5"
                width="11"
                height="11"
                rx="3"
                style={{ fill: marker.color } as CSSProperties}
              />
              {marker.count > 1 && (
                <text
                  className="desktop-cloud-branch-graph-ref-count"
                  x="0"
                  y="0"
                >
                  {marker.count}
                </text>
              )}
            </g>
          );
        })}
        {node && (
          <g
            className={`desktop-cloud-branch-graph-node-mark ${node.current ? "current" : ""}`}
            transform={`translate(${nodeX} ${middleY})`}
          >
            <circle
              className="desktop-cloud-branch-graph-node-halo"
              r={node.current ? 7.2 : 6.2}
            />
            <circle
              className="desktop-cloud-branch-graph-node-circle"
              r={node.current ? 5 : 4.7}
              style={{
                fill: node.current ? node.color : "var(--po-canvas)",
                stroke: node.color,
              } as CSSProperties}
            />
            {node.current && (
              <circle
                className="desktop-cloud-branch-graph-node-core"
                r="2.1"
                style={{ fill: "var(--po-canvas)" } as CSSProperties}
              />
            )}
          </g>
        )}
      </svg>
    </span>
  );
}

function getGraphLaneX(lane: number): number {
  return GRAPH_LEFT_PAD + lane * GRAPH_LANE_WIDTH;
}

function getGraphY(position: CloudBranchGraphLine["segments"][number]["from"], height: number): number {
  if (position === "top") return 0;
  if (position === "bottom") return height;
  return height / 2;
}

function buildGraphSegmentPath(segment: CloudBranchGraphLine["segments"][number], height: number): string {
  const startX = getGraphLaneX(segment.fromLane);
  const endX = getGraphLaneX(segment.toLane);
  const startY = getGraphY(segment.from, height);
  const endY = getGraphY(segment.to, height);

  if (startX === endX || startY === endY) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }

  const controlY = startY + (endY - startY) / 2;
  return `M ${startX} ${startY} C ${startX} ${controlY}, ${endX} ${controlY}, ${endX} ${endY}`;
}

function BranchGraphStats({ stats }: { stats: CloudBranchGraphStats }) {
  const { formatNumber, t } = useLocalization();
  if (stats.files === 0) {
    return <span className="desktop-cloud-branch-graph-stats muted">{t("cloud.git.noChanges")}</span>;
  }

  return (
    <span className="desktop-cloud-branch-graph-stats">
      <span>{t("cloud.history.fileCount", { count: stats.files })}</span>
      {stats.addedFiles > 0 && <span className="added" dir="ltr">+{formatNumber(stats.addedFiles)}</span>}
      {stats.deletedFiles > 0 && <span className="deleted" dir="ltr">-{formatNumber(stats.deletedFiles)}</span>}
      {(stats.additions > 0 || stats.deletions > 0) && (
        <span className="lines">
          {stats.additions > 0 && <em dir="ltr">+{formatNumber(stats.additions)}</em>}
          {stats.deletions > 0 && <em dir="ltr">-{formatNumber(stats.deletions)}</em>}
        </span>
      )}
    </span>
  );
}
