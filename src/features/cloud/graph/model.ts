import type { DesktopCloudHistory } from "../../../lib/cloudHistoryApi";
import type { GitBranchGraphSnapshot } from "../../../types/electron";
import { buildCloudTopologyGraphRows } from "./cloudTopology";
import { buildLocalGitGraphRows, hasStructuralGitPrefix } from "./gitTopology";
import { buildCloudCommitStats, CLOUD_GRAPH_COLORS } from "./shared";
import type {
  CloudBranchGraphDiagnostics,
  CloudBranchGraphRow,
} from "./types";

export type {
  CloudBranchGraphDiagnostics,
  CloudBranchGraphLabel,
  CloudBranchGraphLine,
  CloudBranchGraphRefMarker,
  CloudBranchGraphRow,
  CloudBranchGraphSegment,
  CloudBranchGraphStats,
} from "./types";

export function buildCloudBranchGraphRows({
  status = null,
  history = null,
}: {
  status?: GitBranchGraphSnapshot | null;
  history?: DesktopCloudHistory | null;
}): CloudBranchGraphRow[] {
  const localCommits = status?.allCommits?.length
    ? status.allCommits
    : status?.commits ?? [];
  if (status && localCommits.length > 0) {
    return buildLocalGitGraphRows(status, localCommits);
  }
  if (!history?.commits.length) return [];
  return history.topology_available
    ? buildCloudTopologyGraphRows(history)
    : buildLinearCloudRows(history);
}

export function getCloudBranchGraphDiagnostics(
  status: GitBranchGraphSnapshot | null,
  rows: CloudBranchGraphRow[],
  history: DesktopCloudHistory | null = null,
): CloudBranchGraphDiagnostics {
  const localCommits = status?.allCommits?.length
    ? status.allCommits
    : status?.commits ?? [];
  const commitCount = rows.filter((row) => row.kind === "commit").length;
  const structuralPrefixCount = rows.filter((row) => (
    hasStructuralGitPrefix(row.prefix)
    || row.continuationLines.some((line) => hasStructuralGitPrefix(line.prefix))
  )).length;

  if (localCommits.length === 0) {
    return {
      source: history?.topology_available ? "cloud-topology" : "linear-cloud",
      commitCount,
      mergeCommitCount: history?.commits.filter((commit) => commit.parent_ids.length > 1).length ?? 0,
      branchCount: history?.refs.filter((ref) => ref.ref_type === "branch").length ?? 0,
      structuralPrefixCount: 0,
      warning: history && !history.topology_available
        ? null
        : null,
      warningCode: history && !history.topology_available ? "cloud-ancestry-missing" : undefined,
    };
  }

  const mergeCommitCount = localCommits.filter((commit) => commit.parent_ids.length > 1).length;
  const branchCount = status?.branches.length ?? 0;
  if (structuralPrefixCount > 0) {
    return {
      source: "git-topology",
      commitCount,
      mergeCommitCount,
      branchCount,
      structuralPrefixCount,
      warning: null,
    };
  }
  if (mergeCommitCount > 0 || branchCount > 1) {
    return {
      source: "missing-topology",
      commitCount,
      mergeCommitCount,
      branchCount,
      structuralPrefixCount,
      warning: null,
      warningCode: "git-topology-missing",
    };
  }
  return {
    source: "linear-git",
    commitCount,
    mergeCommitCount,
    branchCount,
    structuralPrefixCount,
    warning: null,
  };
}

function buildLinearCloudRows(history: DesktopCloudHistory): CloudBranchGraphRow[] {
  return history.commits.map((commit, index, commits) => ({
    id: commit.commit_id,
    kind: "commit" as const,
    message: commit.message,
    messageCode: commit.message ? undefined : "update-workspace",
    createdAt: commit.created_at,
    stats: commit.changes_loaded === false ? null : buildCloudCommitStats(commit.changes),
    authorName: commit.who,
    authorCode: commit.who ? undefined : "cloud",
    labels: commit.commit_id === history.head_commit_id || (!history.head_commit_id && index === 0)
      ? [{ name: "", nameCode: "cloud-history" as const, kind: "cloud" as const, current: true }]
      : [],
    prefix: "*",
    laneCount: 1,
    nodeLane: 0,
    nodeColor: CLOUD_GRAPH_COLORS[0],
    segments: [
      ...(index > 0 ? [{
        fromLane: 0,
        toLane: 0,
        color: CLOUD_GRAPH_COLORS[0],
        from: "top" as const,
        to: "middle" as const,
        kind: "lane" as const,
      }] : []),
      ...(index < commits.length - 1 ? [{
        fromLane: 0,
        toLane: 0,
        color: CLOUD_GRAPH_COLORS[0],
        from: "middle" as const,
        to: "bottom" as const,
        kind: "lane" as const,
      }] : []),
    ],
    refMarkers: [],
    continuationLines: [],
  }));
}
