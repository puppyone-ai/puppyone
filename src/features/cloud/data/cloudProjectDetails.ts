import {
  getCloudDashboard,
  getCloudRepoIdentity,
  listAccessSurfaces,
  listCloudMcpEndpoints,
  listCloudRoot,
  listCloudScopes,
  type DesktopCloudAccessSurface,
  type DesktopCloudDashboard,
  type DesktopCloudMcpEndpoint,
  type DesktopCloudProject,
  type DesktopCloudRepoIdentity,
  type DesktopCloudScope,
  type DesktopCloudSession,
  type DesktopCloudTree,
} from "../../../lib/cloudApi";
import {
  getCloudHistory,
  type DesktopCloudHistory,
} from "../../../lib/cloudHistoryApi";
import { unwrapSettled } from "../utils";
import { cloudMessage, type CloudMessageDescriptor } from "../cloudPresentation";

export type CloudProjectDetailsData = {
  project: DesktopCloudProject | null;
  dashboard: DesktopCloudDashboard | null;
  tree: DesktopCloudTree | null;
  history: DesktopCloudHistory | null;
  scopes: DesktopCloudScope[];
  connectors: DesktopCloudAccessSurface[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  identity: DesktopCloudRepoIdentity | null;
  warning: CloudMessageDescriptor | null;
};

export const CLOUD_PROJECT_DETAIL_RESOURCES = [
  "dashboard",
  "tree",
  "history",
  "scopes",
  "connectors",
  "mcp-endpoints",
  "identity",
] as const;

export type CloudProjectDetailResource = (typeof CLOUD_PROJECT_DETAIL_RESOURCES)[number];

export async function loadCloudProjectDetails({
  session,
  projectId,
  project,
  onSessionChange,
  cloudApiBaseUrl,
  resources = CLOUD_PROJECT_DETAIL_RESOURCES,
}: {
  session: DesktopCloudSession;
  projectId: string;
  project: DesktopCloudProject;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  cloudApiBaseUrl: string | null;
  resources?: readonly CloudProjectDetailResource[];
}): Promise<CloudProjectDetailsData> {
  const requested = new Set(resources);
  const [
    dashboardResult,
    treeResult,
    historyResult,
    scopesResult,
    connectorsResult,
    mcpResult,
    identityResult,
  ] = await Promise.allSettled([
    requested.has("dashboard")
      ? getCloudDashboard(session, projectId, onSessionChange, cloudApiBaseUrl)
      : Promise.resolve(null),
    requested.has("tree")
      ? listCloudRoot(session, projectId, onSessionChange, cloudApiBaseUrl)
      : Promise.resolve(null),
    requested.has("history")
      ? getCloudHistory(session, projectId, 20, onSessionChange, cloudApiBaseUrl)
      : Promise.resolve(null),
    requested.has("scopes")
      ? listCloudScopes(session, projectId, onSessionChange, cloudApiBaseUrl)
      : Promise.resolve(null),
    requested.has("connectors")
      ? listAccessSurfaces(session, projectId, onSessionChange, cloudApiBaseUrl)
      : Promise.resolve(null),
    requested.has("mcp-endpoints")
      ? listCloudMcpEndpoints(session, projectId, onSessionChange, cloudApiBaseUrl)
      : Promise.resolve(null),
    requested.has("identity")
      ? getCloudRepoIdentity(session, projectId, onSessionChange, cloudApiBaseUrl)
      : Promise.resolve(null),
  ]);

  const dashboard = unwrapSettled(dashboardResult);
  const resolvedProject = project.id === projectId
    ? project
    : dashboard?.project
      ? { id: dashboard.project.id, name: dashboard.project.name, description: dashboard.project.description ?? null }
      : null;
  const sectionErrors = [
    ["dashboard", dashboardResult],
    ["tree", treeResult],
    ["history", historyResult],
    ["scopes", scopesResult],
    ["connectors", connectorsResult],
    ["mcp-endpoints", mcpResult],
    ["identity", identityResult],
  ].filter(([resource, result]) => requested.has(resource as CloudProjectDetailResource)
    && (result as PromiseSettledResult<unknown>).status === "rejected");

  return {
    project: resolvedProject,
    dashboard,
    tree: unwrapSettled(treeResult),
    history: unwrapSettled(historyResult),
    scopes: unwrapSettled(scopesResult) ?? [],
    connectors: unwrapSettled(connectorsResult) ?? [],
    mcpEndpoints: unwrapSettled(mcpResult) ?? [],
    identity: unwrapSettled(identityResult),
    warning: sectionErrors.length > 0 ? cloudMessage("project-details-partial") : null,
  };
}
