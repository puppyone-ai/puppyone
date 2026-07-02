import type { LucideIcon } from "lucide-react";
import type {
  DesktopCloudConnector,
  DesktopCloudHistory,
  DesktopCloudHistoryChange,
  DesktopCloudMcpEndpoint,
  DesktopCloudScope,
} from "../../lib/cloudApi";
import type { GitBranchGraphSnapshot, GitCommitChange, GitCommitSummary } from "../../types/electron";
import {
  formatProviderLabel,
  getScopeDisplayName,
  isCloudIntegrationConnector,
  isConnectorActiveStatus,
  shellQuote,
} from "./utils";

export type CloudAuthView = "main" | "signin" | "signup" | "signedIn";
export type CloudLoginMethod = "google" | "github" | "email" | "password";
export type CloudLoginFeature = {
  label: string;
  icon: LucideIcon;
};

export type CloudBranchGraphLabel = {
  name: string;
  kind: "local" | "remote" | "cloud";
  current: boolean;
};

export type CloudBranchGraphSegment = {
  fromLane: number;
  toLane: number;
  color: string;
  from: "top" | "middle" | "bottom";
  to: "top" | "middle" | "bottom";
  kind: "lane";
};

export type CloudBranchGraphLine = {
  prefix: string;
  laneCount: number;
  segments: CloudBranchGraphSegment[];
};

export type CloudBranchGraphRefMarker = {
  lane: number;
  color: string;
  label: string;
  kind: CloudBranchGraphLabel["kind"];
  count: number;
};

export type CloudBranchGraphStats = {
  files: number;
  addedFiles: number;
  deletedFiles: number;
  modifiedFiles: number;
  additions: number;
  deletions: number;
};

export type CloudBranchGraphRow = {
  id: string;
  kind: "commit" | "ref";
  prefix: string;
  message: string;
  createdAt: string | null;
  stats: CloudBranchGraphStats | null;
  authorName: string;
  labels: CloudBranchGraphLabel[];
  laneCount: number;
  nodeLane: number;
  nodeColor: string;
  segments: CloudBranchGraphSegment[];
  refMarkers: CloudBranchGraphRefMarker[];
  continuationLines: CloudBranchGraphLine[];
};

export type CloudBranchGraphDiagnostics = {
  source: "git-topology" | "linear-git" | "linear-cloud" | "missing-topology";
  commitCount: number;
  mergeCommitCount: number;
  branchCount: number;
  structuralPrefixCount: number;
  warning: string | null;
};

export type CloudAccessSurface = {
  id: string;
  provider: string;
  title: string;
  subtitle: string;
  status: string;
  statusLabel: string;
  prompt?: string;
  commands?: Array<{ label: string; value: string; disabled?: boolean }>;
  endpoint?: DesktopCloudMcpEndpoint;
  connector?: DesktopCloudConnector;
};

const CLOUD_GRAPH_COLORS = [
  "#4d9fff",
  "#ff7a1a",
  "#b45cff",
  "#ff4fa3",
  "#ffd21f",
  "#4fd6c2",
  "#6bd46b",
  "#ff5c5c",
];

const CLOUD_REF_MARKER_COLORS = {
  local: "#b45cff",
  remote: "#ff7a1a",
  cloud: "#4fd6c2",
} satisfies Record<CloudBranchGraphLabel["kind"], string>;

export function buildCloudBranchGraphRows(
  status: GitBranchGraphSnapshot | null,
  history: DesktopCloudHistory | null,
): CloudBranchGraphRow[] {
  const localCommits = status?.allCommits?.length ? status.allCommits : status?.commits ?? [];
  if (localCommits.length > 0) {
    const commitMap = new Map(localCommits.map((commit) => [commit.commit_id, commit]));
    const branchLabelsByCommit = new Map<string, CloudBranchGraphLabel[]>();
    const refOnlyGroups = new Map<string, {
      commitId: string;
      message: string;
      createdAt: string | null;
      labels: CloudBranchGraphLabel[];
    }>();

    for (const branch of status?.branches ?? []) {
      const label = {
        name: branch.name,
        kind: branch.remote ? "remote" as const : "local" as const,
        current: branch.current,
      };
      const branchCommitId = resolveBranchHeadCommitId(
        branch.lastCommitId || (branch.current ? status?.headCommitId ?? null : null),
        commitMap,
      );
      if (!branchCommitId) {
        const unresolvedCommitId = branch.lastCommitId || `${branch.remote ? "remote" : "local"}:${branch.name}`;
        const group = refOnlyGroups.get(unresolvedCommitId) ?? {
          commitId: unresolvedCommitId,
          message: branch.lastCommitMessage || "Branch head outside visible history",
          createdAt: branch.lastCommitDate,
          labels: [],
        };
        group.labels.push(label);
        refOnlyGroups.set(unresolvedCommitId, group);
        continue;
      }
      const labels = branchLabelsByCommit.get(branchCommitId) ?? [];
      labels.push(label);
      branchLabelsByCommit.set(branchCommitId, sortCloudBranchLabels(labels));
    }

    const headCommitId = resolveBranchHeadCommitId(status?.headCommitId ?? null, commitMap);
    if (headCommitId) {
      const labels = branchLabelsByCommit.get(headCommitId) ?? [];
      if (!labels.some((label) => label.current)) {
        labels.push({
          name: status?.branch === "detached" ? "detached" : "HEAD",
          kind: "local",
          current: true,
        });
        branchLabelsByCommit.set(headCommitId, sortCloudBranchLabels(labels));
      }
    }

    return [
      ...buildGitTopologyGraphRows(localCommits, branchLabelsByCommit),
      ...buildRefOnlyGraphRows([...refOnlyGroups.values()]),
    ];
  }

  return (history?.commits ?? []).slice(0, 20).map((commit, index, commits) => ({
    id: commit.commit_id,
    kind: "commit" as const,
    message: commit.message || "Update workspace",
    createdAt: commit.created_at ?? null,
    stats: buildCloudCommitStats(commit.changes ?? []),
    authorName: commit.who || "Cloud",
    labels: index === 0 ? [{ name: "Cloud history", kind: "cloud", current: false }] : [],
    prefix: "*",
    laneCount: 1,
    nodeLane: 0,
    nodeColor: CLOUD_GRAPH_COLORS[0],
    segments: [
      ...(index > 0
        ? [{ fromLane: 0, toLane: 0, color: CLOUD_GRAPH_COLORS[0], from: "top" as const, to: "middle" as const }]
        : []),
      ...(index < commits.length - 1
        ? [{ fromLane: 0, toLane: 0, color: CLOUD_GRAPH_COLORS[0], from: "middle" as const, to: "bottom" as const }]
        : []),
    ].map((segment) => ({ ...segment, kind: "lane" as const })),
    refMarkers: [],
    continuationLines: [],
  }));
}

export function getCloudBranchGraphDiagnostics(
  status: GitBranchGraphSnapshot | null,
  rows: CloudBranchGraphRow[],
): CloudBranchGraphDiagnostics {
  const localCommits = status?.allCommits?.length ? status.allCommits : status?.commits ?? [];
  const commitCount = rows.filter((row) => row.kind === "commit").length;
  const mergeCommitCount = localCommits.filter((commit) => commit.parent_ids.length > 1).length;
  const branchCount = status?.branches.length ?? 0;
  const structuralPrefixCount = rows.filter((row) => (
    hasStructuralGitPrefix(row.prefix) ||
    row.continuationLines.some((line) => hasStructuralGitPrefix(line.prefix))
  )).length;

  if (localCommits.length === 0) {
    return {
      source: "linear-cloud",
      commitCount,
      mergeCommitCount: 0,
      branchCount: 0,
      structuralPrefixCount: 0,
      warning: null,
    };
  }

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
      warning: "The loaded Git status has branches or merge commits but no structural graph prefixes, so this view is showing branch heads on a linear fallback. Refresh Git topology or fetch all refs.",
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

function buildGitTopologyGraphRows(
  commits: GitCommitSummary[],
  branchLabelsByCommit: Map<string, CloudBranchGraphLabel[]>,
): CloudBranchGraphRow[] {
  const colorByLane = new Map<number, string>();
  let nextColorIndex = 0;

  const getColor = (lane: number) => {
    const existing = colorByLane.get(lane);
    if (existing) return existing;
    const color = CLOUD_GRAPH_COLORS[nextColorIndex++ % CLOUD_GRAPH_COLORS.length];
    colorByLane.set(lane, color);
    return color;
  };

  return commits.map((commit) => {
    const labels = sortCloudBranchLabels(branchLabelsByCommit.get(commit.commit_id) ?? []);
    const graphPrefix = commit.graph_prefix || "*";
    const graphLine = buildGitGraphLine(graphPrefix, getColor);
    const nodeLane = findGitGraphNodeLane(graphPrefix);
    const nodeColor = labels.some((label) => label.current) ? CLOUD_GRAPH_COLORS[0] : getColor(nodeLane);
    const refMarkers = buildBranchRefMarkers(labels, graphLine.laneCount, nodeLane);
    const refSegments = refMarkers.map((marker) => ({
      fromLane: nodeLane,
      toLane: marker.lane,
      color: marker.color,
      from: "middle" as const,
      to: "middle" as const,
      kind: "lane" as const,
    }));
    const continuationLines = (commit.graph_continuation_prefixes ?? [])
      .map((prefix) => buildGitGraphLine(prefix, getColor))
      .filter((line) => line.laneCount > 0 || line.segments.length > 0);
    const laneCount = Math.max(
      graphLine.laneCount,
      nodeLane + 1,
      ...refMarkers.map((marker) => marker.lane + 1),
      ...continuationLines.map((line) => line.laneCount),
      1,
    );

    return {
      id: commit.commit_id,
      kind: "commit",
      message: commit.message || "Update workspace",
      createdAt: commit.created_at,
      stats: buildGitCommitStats(commit.changes),
      authorName: commit.author_name || "Unknown",
      labels,
      prefix: graphLine.prefix,
      laneCount,
      nodeLane,
      nodeColor,
      segments: [...graphLine.segments, ...refSegments],
      refMarkers,
      continuationLines,
    };
  });
}

function buildRefOnlyGraphRows(groups: Array<{
  commitId: string;
  message: string;
  createdAt: string | null;
  labels: CloudBranchGraphLabel[];
}>): CloudBranchGraphRow[] {
  return groups
    .filter((group) => group.labels.length > 0)
    .sort((left, right) => {
      const leftTime = left.createdAt ? Date.parse(left.createdAt) || 0 : 0;
      const rightTime = right.createdAt ? Date.parse(right.createdAt) || 0 : 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return left.labels[0]?.name.localeCompare(right.labels[0]?.name ?? "") ?? 0;
    })
    .map((group) => {
      const refMarkers = buildStandaloneRefMarkers(group.labels);
      const laneCount = Math.max(1, ...refMarkers.map((marker) => marker.lane + 1));
      return {
        id: `ref:${group.commitId}:${group.labels.map((label) => label.name).join("|")}`,
        kind: "ref" as const,
        message: group.message,
        createdAt: group.createdAt,
        stats: null,
        authorName: shortGraphCommitId(group.commitId),
        labels: group.labels,
        prefix: "▣",
        laneCount,
        nodeLane: 0,
        nodeColor: refMarkers[0]?.color ?? CLOUD_REF_MARKER_COLORS.local,
        segments: [],
        refMarkers,
        continuationLines: [],
      };
    });
}

function buildBranchRefMarkers(
  labels: CloudBranchGraphLabel[],
  graphLaneCount: number,
  nodeLane: number,
): CloudBranchGraphRefMarker[] {
  const markerLabels = labels.filter((label) => !label.current);
  if (markerLabels.length === 0) return [];

  const firstMarkerLane = Math.max(graphLaneCount, nodeLane + 1);
  return buildGroupedRefMarkers(markerLabels, firstMarkerLane);
}

function buildStandaloneRefMarkers(labels: CloudBranchGraphLabel[]): CloudBranchGraphRefMarker[] {
  return buildGroupedRefMarkers(labels, 0);
}

function buildGroupedRefMarkers(
  labels: CloudBranchGraphLabel[],
  firstLane: number,
): CloudBranchGraphRefMarker[] {
  const markerGroups = (["local", "remote", "cloud"] as const)
    .map((kind) => ({
      kind,
      labels: labels.filter((label) => label.kind === kind),
    }))
    .filter((group) => group.labels.length > 0);

  return markerGroups.map((group, index) => ({
    lane: firstLane + index,
    color: CLOUD_REF_MARKER_COLORS[group.kind],
    label: group.labels.map((label) => label.name).join(", "),
    kind: group.kind,
    count: group.labels.length,
  }));
}

function sortCloudBranchLabels(labels: CloudBranchGraphLabel[]): CloudBranchGraphLabel[] {
  const kindRank: Record<CloudBranchGraphLabel["kind"], number> = {
    local: 0,
    remote: 1,
    cloud: 2,
  };
  return [...labels].sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1;
    if (kindRank[left.kind] !== kindRank[right.kind]) return kindRank[left.kind] - kindRank[right.kind];
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

function shortGraphCommitId(commitId: string): string {
  return /^[0-9a-f]{7,40}$/i.test(commitId) ? commitId.slice(0, 8) : "ref only";
}

function hasStructuralGitPrefix(prefix: string): boolean {
  return /[|/\\_]/.test(prefix);
}

type GitGraphColorResolver = (lane: number) => string;

function buildGitGraphLine(prefix: string, getColor: GitGraphColorResolver): CloudBranchGraphLine {
  const normalized = prefix.replace(/\s+$/, "") || "*";
  const segments: CloudBranchGraphSegment[] = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const token = normalized[index];
    const lane = gitGraphTokenLane(index);

    if (token === "|" || token === "*") {
      segments.push({
        fromLane: lane,
        toLane: lane,
        color: getColor(lane),
        from: "top",
        to: "bottom",
        kind: "lane",
      });
      continue;
    }

    if (token === "/") {
      const { leftLane, rightLane } = gitGraphEdgeLanes(index);
      segments.push({
        fromLane: rightLane,
        toLane: leftLane,
        color: getColor(rightLane),
        from: "top",
        to: "bottom",
        kind: "lane",
      });
      continue;
    }

    if (token === "\\") {
      const { leftLane, rightLane } = gitGraphEdgeLanes(index);
      segments.push({
        fromLane: leftLane,
        toLane: rightLane,
        color: getColor(leftLane),
        from: "top",
        to: "bottom",
        kind: "lane",
      });
      continue;
    }

    if (token === "_" || token === "-") {
      const { leftLane, rightLane } = gitGraphEdgeLanes(index);
      segments.push({
        fromLane: leftLane,
        toLane: rightLane,
        color: getColor(leftLane),
        from: "middle",
        to: "middle",
        kind: "lane",
      });
    }
  }

  const maxSegmentLane = segments.reduce((maxLane, segment) => (
    Math.max(maxLane, segment.fromLane, segment.toLane)
  ), 0);
  const maxTokenLane = [...normalized].reduce((maxLane, token, index) => (
    token === " " ? maxLane : Math.max(maxLane, gitGraphTokenLane(index))
  ), 0);

  return {
    prefix: normalized,
    laneCount: Math.max(maxSegmentLane + 1, maxTokenLane + 1, 1),
    segments,
  };
}

function findGitGraphNodeLane(prefix: string): number {
  const nodeLane = prefix.indexOf("*");
  if (nodeLane >= 0) return gitGraphTokenLane(nodeLane);

  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] && prefix[index] !== " ") return gitGraphTokenLane(index);
  }

  return 0;
}

function gitGraphTokenLane(index: number): number {
  return Math.max(0, Math.floor(index / 2));
}

function gitGraphEdgeLanes(index: number): { leftLane: number; rightLane: number } {
  const leftLane = Math.max(0, Math.floor((index - 1) / 2));
  const rightLane = Math.max(leftLane + 1, Math.floor((index + 1) / 2));
  return { leftLane, rightLane };
}

function resolveBranchHeadCommitId(
  branchCommitId: string | null,
  commitMap: Map<string, unknown>,
): string | null {
  if (!branchCommitId) return null;
  if (commitMap.has(branchCommitId)) return branchCommitId;
  return [...commitMap.keys()].find((commitId) => commitId.startsWith(branchCommitId)) ?? null;
}

function buildGitCommitStats(changes: GitCommitChange[]): CloudBranchGraphStats {
  return {
    files: changes.length,
    addedFiles: changes.filter((change) => change.status === "added").length,
    deletedFiles: changes.filter((change) => change.status === "deleted").length,
    modifiedFiles: changes.filter((change) => change.status !== "added" && change.status !== "deleted").length,
    additions: changes.reduce((total, change) => total + (change.additions ?? 0), 0),
    deletions: changes.reduce((total, change) => total + (change.deletions ?? 0), 0),
  };
}

function buildCloudCommitStats(changes: DesktopCloudHistoryChange[]): CloudBranchGraphStats {
  const isAdded = (change: DesktopCloudHistoryChange) => change.action === "add" || change.op === "added";
  const isDeleted = (change: DesktopCloudHistoryChange) => change.action === "delete" || change.op === "deleted";
  return {
    files: changes.length,
    addedFiles: changes.filter(isAdded).length,
    deletedFiles: changes.filter(isDeleted).length,
    modifiedFiles: changes.filter((change) => !isAdded(change) && !isDeleted(change)).length,
    additions: 0,
    deletions: 0,
  };
}

export function buildCloudAccessSurfaces({
  scope,
  connectors,
  mcpEndpoints,
  apiBase,
  gitUrl,
  cliCommand,
  profileName,
}: {
  scope: DesktopCloudScope;
  connectors: DesktopCloudConnector[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  apiBase: string;
  gitUrl: string;
  cliCommand: string;
  profileName: string;
}): CloudAccessSurface[] {
  const cliConnector = connectors.find((connector) => connector.provider === "cli");
  const gitConnector = connectors.find((connector) => connector.provider === "filesystem" || connector.provider === "git" || connector.provider === "git_remote");
  const thirdPartyConnectors = connectors.filter(isCloudIntegrationConnector);
  const scopeName = getScopeDisplayName(scope);

  return [
    {
      id: `builtin:cli:${scope.id}`,
      provider: "cli",
      title: "Puppyone CLI",
      subtitle: "Direct terminal access",
      status: cliConnector?.status ?? (scope.access_key ? "active" : "missing"),
      statusLabel: cliConnector?.status ?? (scope.access_key ? "Active" : "Needs key"),
      prompt: `Use PuppyOne CLI to read and write ${scopeName} from any terminal.`,
      commands: [
        { label: "Login", value: cliCommand || "Open Cloud Access and regenerate an access key.", disabled: !cliCommand },
        { label: "Explore", value: `puppyone fs tree / --profile ${shellQuote(profileName)}\npuppyone fs ls / --profile ${shellQuote(profileName)}`, disabled: !cliCommand },
      ],
    },
    {
      id: `builtin:git:${scope.id}`,
      provider: "filesystem",
      title: "Git Remote",
      subtitle: "Native Git clone / push",
      status: gitConnector?.status ?? (gitUrl ? "active" : "missing"),
      statusLabel: gitConnector?.status ?? (gitUrl ? "Active" : "Needs key"),
      prompt: "This workspace is Git-native. PuppyOne Cloud stays the source of truth.",
      commands: [
        { label: "Existing folder", value: `git remote add puppyone ${gitUrl || "<git-url>"}\ngit fetch puppyone`, disabled: !gitUrl },
        { label: "Clone", value: `git clone ${gitUrl || "<git-url>"} ${shellQuote(scopeName)}`, disabled: !gitUrl },
      ],
    },
    ...mcpEndpoints.map((endpoint): CloudAccessSurface => {
      const accessLabel = endpoint.accesses?.length
        ? endpoint.accesses.map((access) => access.path || "/").join(", ")
        : endpoint.path || "/";
      const serverUrl = endpoint.api_key && apiBase ? `${apiBase}/api/v1/mcp/server/${endpoint.api_key}` : "";
      return {
        id: `mcp:${endpoint.id}`,
        provider: "mcp",
        title: endpoint.name || "MCP endpoint",
        subtitle: accessLabel,
        status: endpoint.status || "active",
        statusLabel: endpoint.status || "active",
        endpoint,
        commands: serverUrl ? [{ label: "Server URL", value: serverUrl }] : [],
      };
    }),
    ...thirdPartyConnectors.map((connector): CloudAccessSurface => ({
      id: `connector:${connector.id}`,
      provider: connector.provider,
      title: connector.name || formatProviderLabel(connector.provider),
      subtitle: `${formatProviderLabel(connector.provider)} · ${connector.direction || "manual"}`,
      status: connector.status,
      statusLabel: connector.status,
      connector,
    })),
  ];
}

export function getCloudAccessAggregate(surfaces: CloudAccessSurface[]) {
  if (surfaces.some((surface) => surface.status === "error")) return { label: "Error", tone: "warning" };
  if (surfaces.some((surface) => surface.status === "syncing")) return { label: "Syncing", tone: "ready" };
  if (surfaces.every((surface) => isConnectorActiveStatus(surface.status))) return { label: "Active", tone: "ready" };
  if (surfaces.some((surface) => isConnectorActiveStatus(surface.status))) return { label: "Mixed", tone: "warning" };
  return { label: "Paused", tone: "" };
}
