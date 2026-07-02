import { Fragment, type CSSProperties } from "react";
import { ExternalLink, GitBranch, RefreshCw } from "lucide-react";
import type { Workspace } from "@puppyone/shared-ui";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { GitStatusSnapshot } from "../../../types/electron";
import { PageLoading } from "../../../components/loading";
import { openCloudApp } from "../../../lib/cloudApi";
import type { CloudWorkspaceSection } from "../types";
import { CloudWebEmpty } from "../components/shared";
import { useCloudBranchesData, useCloudBranchesGitStatus } from "../data";
import {
  buildCloudBranchGraphRows,
  getCloudBranchGraphDiagnostics,
  type CloudBranchGraphLine,
  type CloudBranchGraphRefMarker,
  type CloudBranchGraphRow,
  type CloudBranchGraphStats,
} from "../model";
import { formatRelativeTime, shortCommit } from "../utils";

const GRAPH_LANE_WIDTH = 16;
const GRAPH_LEFT_PAD = 10;
const GRAPH_RIGHT_PAD = 12;
const GRAPH_ROW_HEIGHT = 30;
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
  const gitGraphStatus = useCloudBranchesGitStatus({
    rootPath: workspace.path,
    fallbackStatus: status,
  });
  const effectiveStatus = gitGraphStatus.status ?? status;
  const localCommits = effectiveStatus?.allCommits?.length ? effectiveStatus.allCommits : effectiveStatus?.commits ?? [];
  const hasLocalGraph = localCommits.length > 0;
  const branchData = useCloudBranchesData({
    session: cloudSession,
    projectId,
    apiBaseUrl,
    enabled: !hasLocalGraph,
    revisionKey: effectiveStatus?.headCommitId ?? null,
    onSessionChange: onCloudSessionChange,
  });
  const graphRows = buildCloudBranchGraphRows(effectiveStatus, branchData.history);
  const diagnostics = getCloudBranchGraphDiagnostics(effectiveStatus, graphRows);
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
  const branchError = gitGraphStatus.error ?? branchData.error ?? diagnostics.warning;

  return (
    <section className="desktop-cloud-branches-page">
      <header className="desktop-cloud-branches-header">
        <div>
          <span>Branches</span>
          <small>{graphLoading ? "Loading" : branchCount}</small>
        </div>
        <div className="desktop-cloud-branches-toolbar">
          {currentBranchName && (
            <span className="desktop-cloud-branches-token current" title={currentBranchName}>
              {currentBranchName}
            </span>
          )}
          <span className="desktop-cloud-branches-token">{commitCount} commits</span>
          {localBranchCount > 0 && <span className="desktop-cloud-branches-token local">{localBranchCount} local</span>}
          {remoteBranchCount > 0 && <span className="desktop-cloud-branches-token remote">{remoteBranchCount} remote</span>}
          {refOnlyCount > 0 && <span className="desktop-cloud-branches-token muted">{refOnlyCount} ref-only</span>}
          {diagnostics.source === "git-topology" && <span className="desktop-cloud-branches-token ready">Git topology</span>}
          {diagnostics.source === "missing-topology" && <span className="desktop-cloud-branches-token warning">Linear fallback</span>}
          <button
            className="desktop-cloud-row-action"
            type="button"
            onClick={() => void (hasLocalGraph ? gitGraphStatus.reload() : branchData.reload())}
            disabled={gitGraphStatus.loading || branchData.loading}
            title={hasLocalGraph ? "Refresh local Git topology." : "Refresh Cloud history."}
          >
            <RefreshCw size={13} className={(gitGraphStatus.loading || branchData.loading) ? "spin" : undefined} />
            <span>Refresh</span>
          </button>
          <button className="desktop-cloud-row-action" type="button" onClick={() => onOpenProject(projectId, "branches")}>
            <ExternalLink size={13} />
            <span>Open Web</span>
          </button>
        </div>
      </header>

      <div className="desktop-cloud-branches-body">
        {graphLoading ? (
          <PageLoading variant="fill" label="Loading" className="desktop-cloud-web-loading" />
        ) : branchError && graphRows.length === 0 ? (
          <CloudWebEmpty
            icon={GitBranch}
            title="Branches unavailable"
            detail={branchError}
          />
        ) : graphRows.length === 0 ? (
          <CloudWebEmpty
            icon={GitBranch}
            title="No branches yet"
            detail="No local or remote Git branches are available for this workspace yet."
          />
        ) : (
          <>
            {branchError && <div className="desktop-cloud-branches-warning">{branchError}</div>}
            <div className="desktop-cloud-branches-graph" role="list" aria-label="All branch history">
              {graphRows.map((row) => (
                <Fragment key={row.id}>
                  <BranchGraphRow
                    projectId={projectId}
                    row={row}
                    graphWidth={graphWidth}
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
}: {
  projectId: string;
  row: CloudBranchGraphRow;
  graphWidth: number;
}) {
  const isCurrentHead = row.labels.some((label) => label.current);
  const content = (
    <>
      <span className="desktop-cloud-branch-graph-cell" style={{ width: graphWidth }} aria-hidden="true">
        <BranchGraphVisual
          graphWidth={graphWidth}
          height={GRAPH_ROW_HEIGHT}
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
        <strong>{row.message}</strong>
        {row.kind === "commit" && (
          <code className="desktop-cloud-branch-graph-sha">{shortCommit(row.id)}</code>
        )}
        {row.labels.map((label) => (
          <span
            className={`desktop-cloud-branch-label ${label.kind} ${label.current ? "current" : ""}`}
            key={`${row.id}:${label.name}`}
          >
            {label.name}
          </span>
        ))}
        {row.stats && <BranchGraphStats stats={row.stats} />}
        <span className="desktop-cloud-branch-graph-author" title={row.authorName}>{row.authorName}</span>
        <time className="desktop-cloud-branch-graph-date">{row.createdAt ? formatRelativeTime(row.createdAt) : "unknown"}</time>
      </span>
    </>
  );

  if (row.kind === "ref") {
    return (
      <div
        className="desktop-cloud-branch-graph-row ref-only"
        role="listitem"
        title={row.message}
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
      title={`${row.message} (${shortCommit(row.id)})`}
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
      <span className="desktop-cloud-branch-graph-cell" style={{ width: graphWidth }}>
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
    <span className="desktop-cloud-branch-graph-visual" style={{ width: graphWidth, height }}>
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
  if (stats.files === 0) {
    return <span className="desktop-cloud-branch-graph-stats muted">No changes</span>;
  }

  return (
    <span className="desktop-cloud-branch-graph-stats">
      <span>{stats.files} file{stats.files === 1 ? "" : "s"}</span>
      {stats.addedFiles > 0 && <span className="added">+{stats.addedFiles}</span>}
      {stats.deletedFiles > 0 && <span className="deleted">-{stats.deletedFiles}</span>}
      {(stats.additions > 0 || stats.deletions > 0) && (
        <span className="lines">
          {stats.additions > 0 && <em>+{stats.additions}</em>}
          {stats.deletions > 0 && <em>-{stats.deletions}</em>}
        </span>
      )}
    </span>
  );
}
