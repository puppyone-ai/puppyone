import {
  getCloudDashboard,
  getCloudHistory,
  getCloudRepoIdentity,
  listCloudConnectors,
  listCloudMcpEndpoints,
  listCloudRoot,
  listCloudScopes,
  type DesktopCloudConnector,
  type DesktopCloudDashboard,
  type DesktopCloudHistory,
  type DesktopCloudMcpEndpoint,
  type DesktopCloudProject,
  type DesktopCloudRepoIdentity,
  type DesktopCloudScope,
  type DesktopCloudSession,
  type DesktopCloudTree,
} from "../../../lib/cloudApi";
import { unwrapSettled } from "../utils";

export type CloudProjectDetailsData = {
  activeProject: DesktopCloudProject | null;
  dashboard: DesktopCloudDashboard | null;
  tree: DesktopCloudTree | null;
  history: DesktopCloudHistory | null;
  scopes: DesktopCloudScope[];
  connectors: DesktopCloudConnector[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  identity: DesktopCloudRepoIdentity | null;
  warning: string | null;
};

export async function loadCloudProjectDetails({
  session,
  projectId,
  projects,
  onSessionChange,
  cloudApiBaseUrl,
}: {
  session: DesktopCloudSession;
  projectId: string;
  projects: DesktopCloudProject[];
  onSessionChange: (session: DesktopCloudSession | null) => void;
  cloudApiBaseUrl: string | null;
}): Promise<CloudProjectDetailsData> {
  const [
    dashboardResult,
    treeResult,
    historyResult,
    scopesResult,
    connectorsResult,
    mcpResult,
    identityResult,
  ] = await Promise.allSettled([
    getCloudDashboard(session, projectId, onSessionChange, cloudApiBaseUrl),
    listCloudRoot(session, projectId, onSessionChange, cloudApiBaseUrl),
    getCloudHistory(session, projectId, 20, onSessionChange, cloudApiBaseUrl),
    listCloudScopes(session, projectId, onSessionChange, cloudApiBaseUrl),
    listCloudConnectors(session, projectId, onSessionChange, cloudApiBaseUrl),
    listCloudMcpEndpoints(session, projectId, onSessionChange, cloudApiBaseUrl),
    getCloudRepoIdentity(session, projectId, onSessionChange, cloudApiBaseUrl),
  ]);

  const dashboard = unwrapSettled(dashboardResult);
  const activeProject = projects.find((project) => project.id === projectId) ?? (
    dashboard?.project
      ? { id: dashboard.project.id, name: dashboard.project.name, description: dashboard.project.description ?? null }
      : null
  );
  const sectionErrors = [
    dashboardResult,
    treeResult,
    historyResult,
    scopesResult,
    connectorsResult,
    mcpResult,
    identityResult,
  ].filter((result) => result.status === "rejected");

  return {
    activeProject,
    dashboard,
    tree: unwrapSettled(treeResult),
    history: unwrapSettled(historyResult),
    scopes: unwrapSettled(scopesResult) ?? [],
    connectors: unwrapSettled(connectorsResult) ?? [],
    mcpEndpoints: unwrapSettled(mcpResult) ?? [],
    identity: unwrapSettled(identityResult),
    warning: sectionErrors.length > 0
      ? "Some Cloud project details could not be loaded. Refresh after checking the backend connection."
      : null,
  };
}
