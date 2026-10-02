import type {
  DesktopCloudConnector,
  DesktopCloudDashboard,
  DesktopCloudMcpEndpoint,
  DesktopCloudRepoIdentity,
  DesktopCloudScope,
  DesktopCloudTree,
  DesktopCloudTreeEntry,
} from "../../../../lib/cloudApi";
import type { DesktopCloudHistory } from "../../../../lib/cloudHistoryApi";
import {
  buildAccessPointRows,
  isAccessPointNavigationResource,
  isAccessPointReady,
} from "../../access-points/model";
import { getCloudScopeRows, normalizeCloudEntryPath } from "../../utils";

export const CLOUD_OVERVIEW_ACTIVITY_WINDOW_DAYS = 7;
const DAY_IN_MS = 86_400_000;

/**
 * Derive Access totals from the same domain rows rendered by Access.
 * Synchronize inventory is loaded separately. Summary fields must not override
 * the detail resources already loaded for this route.
 */
export function getCloudOverviewMetrics({
  scopes,
  connectors,
  mcpEndpoints,
  identity,
}: {
  scopes: DesktopCloudScope[];
  connectors: DesktopCloudConnector[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  identity: DesktopCloudRepoIdentity | null;
}) {
  const scopeRows = getCloudScopeRows(scopes, identity);
  const accessRows = buildAccessPointRows({
    scopeRows,
    connectors,
    mcpEndpoints,
    identity,
    apiBaseUrl: null,
  }).filter(isAccessPointNavigationResource);

  return {
    accessPointCount: accessRows.length,
    activeAccessPointCount: accessRows.filter((row) => isAccessPointReady(row.accessPoint)).length,
    accessRows,
  };
}

export function getRecentCloudCommitActivity(
  history: DesktopCloudHistory | null,
  now = Date.now(),
  windowDays = CLOUD_OVERVIEW_ACTIVITY_WINDOW_DAYS,
) {
  const threshold = now - windowDays * DAY_IN_MS;
  const datedCommits = (history?.commits ?? [])
    .map((commit) => Date.parse(commit.created_at ?? ""))
    .filter(Number.isFinite);
  const count = datedCommits.filter((createdAt) => createdAt >= threshold).length;
  const oldestLoadedCommit = datedCommits.length > 0 ? Math.min(...datedCommits) : null;
  const isLowerBound = Boolean(
    history?.has_more
    && oldestLoadedCommit !== null
    && oldestLoadedCommit >= threshold,
  );
  return { count, isLowerBound, windowDays };
}

export function getLatestCloudUpdateAt(
  projectUpdatedAt: string | null,
  history: DesktopCloudHistory | null,
) {
  const candidates = [
    projectUpdatedAt,
    ...(history?.commits ?? []).map((commit) => commit.created_at ?? null),
  ]
    .map((value) => value ? Date.parse(value) : Number.NaN)
    .filter(Number.isFinite);

  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates)).toISOString();
}

export function getCloudOverviewRootEntries(tree: DesktopCloudTree | null) {
  if (!tree) return [];
  const root = normalizeCloudEntryPath(tree.path);
  return tree.entries
    .filter((entry) => isDirectChild(entry, root))
    .sort((left, right) => {
      const leftFolder = left.type === "folder" ? 0 : 1;
      const rightFolder = right.type === "folder" ? 0 : 1;
      return leftFolder - rightFolder || left.name.localeCompare(right.name);
    });
}

export function getCloudOverviewEntryUpdatedAt(
  entry: DesktopCloudTreeEntry,
  history: DesktopCloudHistory | null,
) {
  const entryPath = normalizeCloudEntryPath(entry.path);
  const isFolder = entry.type === "folder";
  const timestamps = (history?.commits ?? []).flatMap((commit) => {
    const createdAt = commit.created_at ? Date.parse(commit.created_at) : Number.NaN;
    if (!Number.isFinite(createdAt)) return [];
    const scopePath = normalizeCloudEntryPath(commit.scope_path);
    const touched = commit.changes.some((change) => {
      const changePath = normalizeCloudEntryPath(change.path);
      const candidatePaths = scopePath && !changePath.startsWith(`${scopePath}/`)
        ? [changePath, `${scopePath}/${changePath}`]
        : [changePath];
      return candidatePaths.some((candidatePath) => (
        candidatePath === entryPath
        || (isFolder && candidatePath.startsWith(`${entryPath}/`))
      ));
    });
    return touched ? [createdAt] : [];
  });

  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

export type CloudOverviewStorageUsage = {
  bytes: number | null;
  limitBytes: number | null;
  percent: number | null;
  isLowerBound: boolean;
};

export function getCloudOverviewStorageUsage(
  dashboard: DesktopCloudDashboard | null,
  tree: DesktopCloudTree | null,
): CloudOverviewStorageUsage {
  const dashboardBytes = finiteNonNegative(dashboard?.nodes.storage_bytes);
  const limitBytes = finitePositive(dashboard?.nodes.storage_limit_bytes);
  const fileEntries = (tree?.entries ?? []).filter((entry) => entry.type !== "folder");
  const hasFolderEntries = (tree?.entries ?? []).some((entry) => entry.type === "folder");
  const knownFileSizes = fileEntries
    .map((entry) => finiteNonNegative(entry.size_bytes))
    .filter((value): value is number => value !== null);
  const canEstimateFromTree = Boolean(
    tree
    && (tree.entries.length === 0 || knownFileSizes.length > 0),
  );
  const bytes = dashboardBytes ?? (canEstimateFromTree
    ? knownFileSizes.reduce((total, value) => total + value, 0)
    : null);
  const isLowerBound = dashboardBytes === null
    && bytes !== null
    && (hasFolderEntries || knownFileSizes.length < fileEntries.length);
  const percent = bytes !== null && limitBytes !== null
    ? Math.min(100, Math.max(0, bytes / limitBytes * 100))
    : null;

  return { bytes, limitBytes, percent, isLowerBound };
}

function isDirectChild(entry: DesktopCloudTreeEntry, root: string) {
  const path = normalizeCloudEntryPath(entry.path);
  const relativePath = root && path.startsWith(`${root}/`)
    ? path.slice(root.length + 1)
    : path;
  return relativePath.length > 0 && !relativePath.includes("/");
}

function finiteNonNegative(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
