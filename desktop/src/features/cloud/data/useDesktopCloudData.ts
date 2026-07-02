import { useEffect, useState } from "react";
import {
  listCloudProjects,
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
import type { CloudEnvironment } from "../environment";
import { resolveMappedCloudProjectId } from "../workspace";
import { loadCloudProjectDetails } from "./cloudProjectDetails";

export { resolveMappedCloudProjectId } from "../workspace";

export type DesktopCloudDataState = {
  projects: DesktopCloudProject[];
  mappedProjectId: string | null;
  mappedProject: DesktopCloudProject | null;
  activeProjectId: string | null;
  activeProject: DesktopCloudProject | null;
  dashboard: DesktopCloudDashboard | null;
  tree: DesktopCloudTree | null;
  history: DesktopCloudHistory | null;
  scopes: DesktopCloudScope[];
  connectors: DesktopCloudConnector[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  identity: DesktopCloudRepoIdentity | null;
  initializing: boolean;
  loading: boolean;
  error: string | null;
  warning: string | null;
  reload: () => Promise<void>;
};

type DesktopCloudDataInternalState = Omit<DesktopCloudDataState, "reload"> & {
  contextKey: string | null;
};

export function useDesktopCloudData(
  session: DesktopCloudSession | null,
  cloudEnvironment: CloudEnvironment,
  selectedProjectId: string | null,
  onSessionChange: (session: DesktopCloudSession | null) => void,
  workspaceRevisionKey?: string | null,
  loadProjectDetails = true,
): DesktopCloudDataState {
  const cloudRemote = cloudEnvironment.cloudRemote;
  const cloudApiBaseUrl = cloudEnvironment.apiBaseUrl;
  const configuredProjectId = cloudEnvironment.configuredProjectId;
  const contextKey = createCloudDataContextKey({
    session,
    cloudEnvironment,
    selectedProjectId,
    loadProjectDetails,
  });
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<DesktopCloudDataInternalState>(() => createCloudDataState());
  const hasCurrentContext = state.contextKey === contextKey;

  useEffect(() => {
    if (!session) {
      setState(createCloudDataState({
        initializing: false,
        loading: false,
        contextKey,
      }));
      return undefined;
    }

    let cancelled = false;
    const load = async () => {
      setState((current) => ({
        ...current,
        initializing: current.contextKey !== contextKey,
        loading: true,
        error: null,
        warning: null,
        contextKey,
      }));
      try {
        const projects = await listCloudProjects(session, onSessionChange, cloudApiBaseUrl);
        if (cancelled) return;
        const mappedProjectId = await resolveMappedCloudProjectId({
          session,
          projects,
          cloudRemote,
          configuredProjectId,
          onSessionChange,
          cloudApiBaseUrl,
        });
        if (cancelled) return;

        const mappedProject = mappedProjectId
          ? projects.find((project) => project.id === mappedProjectId) ?? null
          : null;
        const activeProjectId = selectedProjectId || mappedProjectId;

        if (!activeProjectId) {
          setState(createCloudDataState({
            projects,
            mappedProjectId,
            mappedProject,
            initializing: false,
            loading: false,
            contextKey,
          }));
          return;
        }

        if (!loadProjectDetails) {
          setState(createCloudDataState({
            projects,
            mappedProjectId,
            mappedProject,
            activeProjectId,
            activeProject: projects.find((project) => project.id === activeProjectId) ?? mappedProject,
            initializing: false,
            loading: false,
            contextKey,
          }));
          return;
        }

        const details = await loadCloudProjectDetails({
          session,
          projectId: activeProjectId,
          projects,
          onSessionChange,
          cloudApiBaseUrl,
        });
        if (cancelled) return;

        setState({
          projects,
          mappedProjectId,
          mappedProject,
          activeProjectId,
          activeProject: details.activeProject,
          dashboard: details.dashboard,
          tree: details.tree,
          history: details.history,
          scopes: details.scopes,
          connectors: details.connectors,
          mcpEndpoints: details.mcpEndpoints,
          identity: details.identity,
          initializing: false,
          loading: false,
          error: null,
          warning: details.warning,
          contextKey,
        });
      } catch (loadError) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            initializing: false,
            loading: false,
            error: loadError instanceof Error ? loadError.message : "Unable to load Cloud workspace.",
            warning: null,
            contextKey,
          }));
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    session,
    onSessionChange,
    configuredProjectId,
    selectedProjectId,
    cloudRemote?.rawUrl,
    cloudApiBaseUrl,
    contextKey,
    workspaceRevisionKey,
    reloadToken,
    loadProjectDetails,
  ]);

  const reload = async () => {
    setReloadToken((token) => token + 1);
  };

  if (session && !hasCurrentContext) {
    return {
      ...toPublicCloudDataState(createCloudDataState({
        initializing: true,
        loading: true,
      })),
      reload,
    };
  }

  return { ...toPublicCloudDataState(state), reload };
}

function createCloudDataContextKey({
  session,
  cloudEnvironment,
  selectedProjectId,
  loadProjectDetails,
}: {
  session: DesktopCloudSession | null;
  cloudEnvironment: CloudEnvironment;
  selectedProjectId: string | null;
  loadProjectDetails: boolean;
}): string {
  if (!session) return "signed-out";
  return [
    session.user_email,
    session.api_base_url ?? "",
    cloudEnvironment.cloudRemote?.rawUrl ?? "",
    cloudEnvironment.configuredProjectId ?? "",
    selectedProjectId ?? "",
    loadProjectDetails ? "details" : "summary",
  ].join("\n");
}

function createCloudDataState(
  overrides: Partial<DesktopCloudDataInternalState> = {},
): DesktopCloudDataInternalState {
  return {
    projects: [],
    mappedProjectId: null,
    mappedProject: null,
    activeProjectId: null,
    activeProject: null,
    dashboard: null,
    tree: null,
    history: null,
    scopes: [],
    connectors: [],
    mcpEndpoints: [],
    identity: null,
    initializing: false,
    loading: false,
    error: null,
    warning: null,
    contextKey: null,
    ...overrides,
  };
}

function toPublicCloudDataState({
  contextKey,
  ...publicState
}: DesktopCloudDataInternalState): Omit<DesktopCloudDataState, "reload"> {
  void contextKey;
  return publicState;
}
