import type { CSSProperties } from "react";
import type {
  CloudBranchGraphLine,
  CloudBranchGraphRefMarker,
  CloudBranchGraphRow,
} from "./model";

const HISTORY_GRAPH_LANE_WIDTH = 12;
const HISTORY_GRAPH_LEFT_PAD = 11;
const HISTORY_GRAPH_RIGHT_PAD = 3;

export function getHistoryGraphWidth(rows: CloudBranchGraphRow[]): number {
  const laneCount = Math.max(
    1,
    ...rows.flatMap((row) => [
      row.laneCount,
      row.nodeLane + 1,
      ...row.refMarkers.map((marker) => marker.lane + 1),
      ...row.continuationLines.map((line) => line.laneCount),
    ]),
  );
  return HISTORY_GRAPH_LEFT_PAD + laneCount * HISTORY_GRAPH_LANE_WIDTH + HISTORY_GRAPH_RIGHT_PAD;
}

export function HistoryGraphVisual({
  graphWidth,
  height,
  line,
  continuationLines = [],
  refMarkers = [],
  node,
}: {
  graphWidth: number;
  height: number;
  line: CloudBranchGraphLine;
  continuationLines?: CloudBranchGraphLine[];
  refMarkers?: CloudBranchGraphRefMarker[];
  node?: { lane: number; color: string; current: boolean };
}) {
  const middleY = height / 2;
  const continuationBandHeight = continuationLines.length > 0
    ? (height - middleY) / continuationLines.length
    : 0;
  const mainPositions = continuationLines.length > 0
    ? { top: 0, middle: middleY, bottom: middleY }
    : { top: 0, middle: middleY, bottom: height };
  return (
    <svg
      className="desktop-cloud-history-graph-svg"
      width={graphWidth}
      height={height}
      viewBox={`0 0 ${graphWidth} ${height}`}
      focusable="false"
    >
      {line.segments.map((segment, index) => (
        <path
          className="desktop-cloud-history-graph-segment"
          key={`${index}:${segment.fromLane}:${segment.toLane}:${segment.from}:${segment.to}`}
          d={buildHistoryGraphSegmentPath(segment, mainPositions)}
          style={{ stroke: segment.color } as CSSProperties}
        />
      ))}
      {continuationLines.flatMap((continuationLine, lineIndex) => {
        const top = middleY + continuationBandHeight * lineIndex;
        const bottom = top + continuationBandHeight;
        const positions = { top, middle: (top + bottom) / 2, bottom };
        return continuationLine.segments.map((segment, segmentIndex) => (
          <path
            className="desktop-cloud-history-graph-segment"
            key={`continuation:${lineIndex}:${segmentIndex}:${segment.fromLane}:${segment.toLane}`}
            d={buildHistoryGraphSegmentPath(segment, positions)}
            style={{ stroke: segment.color } as CSSProperties}
          />
        ));
      })}
      {refMarkers.map((marker) => (
        <g
          className={`desktop-cloud-history-graph-ref ${marker.kind}`}
          key={`${marker.lane}:${marker.label}`}
          transform={`translate(${getHistoryGraphLaneX(marker.lane)} ${middleY})`}
        >
          <rect x="-5" y="-5" width="10" height="10" rx="3" style={{ fill: marker.color } as CSSProperties} />
          {marker.count > 1 && <text x="0" y="0">{marker.count}</text>}
        </g>
      ))}
      {node && (
        <g
          className={`desktop-cloud-history-graph-node ${node.current ? "current" : ""}`}
          transform={`translate(${getHistoryGraphLaneX(node.lane)} ${middleY})`}
        >
          <rect className="halo" x="-5.5" y="-5.5" width="11" height="11" rx="3" />
          <rect
            className="node"
            x={node.current ? -4 : -3.5}
            y={node.current ? -4 : -3.5}
            width={node.current ? 8 : 7}
            height={node.current ? 8 : 7}
            rx="2"
            style={{ fill: node.current ? node.color : "var(--cloud-history-node-bg, var(--po-sidebar))", stroke: node.color } as CSSProperties}
          />
        </g>
      )}
    </svg>
  );
}

function getHistoryGraphLaneX(lane: number): number {
  return HISTORY_GRAPH_LEFT_PAD + lane * HISTORY_GRAPH_LANE_WIDTH;
}

function buildHistoryGraphSegmentPath(
  segment: CloudBranchGraphLine["segments"][number],
  positions: { top: number; middle: number; bottom: number },
): string {
  const startX = getHistoryGraphLaneX(segment.fromLane);
  const endX = getHistoryGraphLaneX(segment.toLane);
  const startY = positions[segment.from];
  const endY = positions[segment.to];
  if (startX === endX || startY === endY) return `M ${startX} ${startY} L ${endX} ${endY}`;
  const controlY = startY + (endY - startY) / 2;
  return `M ${startX} ${startY} C ${startX} ${controlY}, ${endX} ${controlY}, ${endX} ${endY}`;
}
