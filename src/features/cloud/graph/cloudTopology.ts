import type { DesktopCloudHistory } from "../../../lib/cloudHistoryApi";
import {
  buildBranchRefMarkers,
  buildCloudCommitStats,
  buildRefOnlyGraphRows,
  CLOUD_GRAPH_COLORS,
  sortCloudBranchLabels,
  type RefOnlyGroup,
} from "./shared";
import type {
  CloudBranchGraphLabel,
  CloudBranchGraphRow,
  CloudBranchGraphSegment,
} from "./types";

type CloudTopologyLane = {
  commitId: string;
  color: string;
};

export function buildCloudTopologyGraphRows(
  history: DesktopCloudHistory,
): CloudBranchGraphRow[] {
  const commitMap = new Map(history.commits.map((commit) => [commit.commit_id, commit]));
  const labelsByCommit = new Map<string, CloudBranchGraphLabel[]>();
  const refOnlyGroups = new Map<string, RefOnlyGroup>();

  for (const ref of history.refs) {
    const label: CloudBranchGraphLabel = {
      name: formatCloudHistoryRefName(ref.ref_name),
      kind: ref.ref_type === "tag" ? "tag" : "cloud",
      current: ref.ref_name === "refs/heads/main" && ref.commit_id === history.head_commit_id,
    };
    if (commitMap.has(ref.commit_id)) {
      const labels = labelsByCommit.get(ref.commit_id) ?? [];
      labels.push(label);
      labelsByCommit.set(ref.commit_id, sortCloudBranchLabels(labels));
      continue;
    }
    const group = refOnlyGroups.get(ref.commit_id) ?? {
      commitId: ref.commit_id,
      message: "",
      messageCode: "branch-head-outside-loaded-history",
      createdAt: null,
      labels: [],
    };
    group.labels.push(label);
    refOnlyGroups.set(ref.commit_id, group);
  }

  const headCommitId = history.head_commit_id;
  if (headCommitId && commitMap.has(headCommitId)) {
    const labels = labelsByCommit.get(headCommitId) ?? [];
    if (!labels.some((label) => label.current)) {
      labels.push({ name: "HEAD", kind: "cloud", current: true });
      labelsByCommit.set(headCommitId, sortCloudBranchLabels(labels));
    }
  }

  let lanes: CloudTopologyLane[] = [];
  let nextColorIndex = 0;
  const nextColor = () => CLOUD_GRAPH_COLORS[nextColorIndex++ % CLOUD_GRAPH_COLORS.length];
  const rows = history.commits.map((commit): CloudBranchGraphRow => {
    const labels = sortCloudBranchLabels(labelsByCommit.get(commit.commit_id) ?? []);
    const incomingLaneByCommit = new Map(
      lanes.map((lane, index) => [lane.commitId, index] as const),
    );
    let nodeLane = incomingLaneByCommit.get(commit.commit_id) ?? -1;
    const nodeHadIncomingLane = nodeLane >= 0;
    if (!nodeHadIncomingLane) {
      nodeLane = lanes.length;
      lanes = [...lanes, { commitId: commit.commit_id, color: nextColor() }];
    }

    const incomingLanes = lanes;
    const nodeColor = incomingLanes[nodeLane]?.color ?? nextColor();
    const parentIds = [...new Set(commit.parent_ids)].filter(isCloudGraphCommitId);
    const outgoingLanes = incomingLanes.filter((_lane, index) => index !== nodeLane);

    parentIds.forEach((parentId, parentIndex) => {
      const existingLane = outgoingLanes.findIndex((lane) => lane.commitId === parentId);
      if (existingLane >= 0) {
        if (parentIndex === 0) {
          outgoingLanes[existingLane] = { commitId: parentId, color: nodeColor };
        }
        return;
      }
      const insertionLane = Math.min(nodeLane + parentIndex, outgoingLanes.length);
      outgoingLanes.splice(insertionLane, 0, {
        commitId: parentId,
        color: parentIndex === 0 ? nodeColor : nextColor(),
      });
    });
    const outgoingLaneByCommit = new Map(
      outgoingLanes.map((lane, index) => [lane.commitId, index] as const),
    );

    const segments: CloudBranchGraphSegment[] = [];
    incomingLanes.forEach((lane, incomingLane) => {
      if (incomingLane === nodeLane) return;
      const outgoingLane = outgoingLaneByCommit.get(lane.commitId);
      if (outgoingLane === undefined) return;
      segments.push({
        fromLane: incomingLane,
        toLane: outgoingLane,
        color: lane.color,
        from: "top",
        to: "bottom",
        kind: "lane",
      });
    });
    if (nodeHadIncomingLane) {
      segments.push({
        fromLane: nodeLane,
        toLane: nodeLane,
        color: nodeColor,
        from: "top",
        to: "middle",
        kind: "lane",
      });
    }
    parentIds.forEach((parentId) => {
      const outgoingLane = outgoingLaneByCommit.get(parentId);
      if (outgoingLane === undefined) return;
      segments.push({
        fromLane: nodeLane,
        toLane: outgoingLane,
        color: outgoingLanes[outgoingLane]?.color ?? nodeColor,
        from: "middle",
        to: "bottom",
        kind: "lane",
      });
    });

    const graphLaneCount = Math.max(incomingLanes.length, outgoingLanes.length, nodeLane + 1, 1);
    const refMarkers = buildBranchRefMarkers(labels, graphLaneCount, nodeLane);
    const refSegments = refMarkers.map((marker): CloudBranchGraphSegment => ({
      fromLane: nodeLane,
      toLane: marker.lane,
      color: marker.color,
      from: "middle",
      to: "middle",
      kind: "lane",
    }));
    lanes = outgoingLanes;

    return {
      id: commit.commit_id,
      kind: "commit",
      message: commit.message,
      messageCode: commit.message ? undefined : "update-workspace",
      createdAt: commit.created_at,
      stats: commit.changes_loaded === false ? null : buildCloudCommitStats(commit.changes),
      authorName: commit.who,
      authorCode: commit.who ? undefined : "cloud",
      labels,
      prefix: "*",
      laneCount: Math.max(graphLaneCount, ...refMarkers.map((marker) => marker.lane + 1)),
      nodeLane,
      nodeColor,
      segments: [...segments, ...refSegments],
      refMarkers,
      continuationLines: [],
    };
  });

  return [...rows, ...buildRefOnlyGraphRows([...refOnlyGroups.values()])];
}

function formatCloudHistoryRefName(refName: string): string {
  return refName.replace(/^refs\/heads\//, "").replace(/^refs\/tags\//, "");
}

function isCloudGraphCommitId(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}
