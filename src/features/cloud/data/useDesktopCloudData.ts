import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCloudProject,
  type DesktopCloudAccessSurface,
  type DesktopCloudDashboard,
  type DesktopCloudMcpEndpoint,
  type DesktopCloudProject,
  type DesktopCloudRepoIdentity,
  type DesktopCloudScope,
  type DesktopCloudSession,
  type DesktopCloudTree,
} from "../../../lib/cloudApi";
import type { DesktopCloudHistory } from "../../../lib/cloudHistoryApi";
import type { CloudEnvironment } from "../environment";
import {
  CLOUD_PROJECT_DETAIL_RESOURCES,
  loadCloudProjectDetails,
  type CloudProjectDetailResource,
} from "./cloudProjectDetails";
import { cloudMessage, type CloudMessageDescriptor } from "../cloudPresentation";


export type DesktopCloudDataState = {
  projectId: string | null;
  project: DesktopCloudProject | null;
  dashboard: DesktopCloudDashboard | null;
  tree: DesktopCloudTree | null;
  history: DesktopCloudHistory | null;
  scopes: DesktopCloudScope[];
  connectors: DesktopCloudAccessSurface[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  identity: DesktopCloudRepoIdentity | null;
  initializing: boolean;
  loading: boolean;
  error: CloudMessageDescriptor | null;
  warning: CloudMessageDescriptor | null;
  reload: () => Promise<void>;
};

type DesktopCloudDataInternalState = Omit<DesktopCloudDataState, "reload"> & {
  contextKey: string | null;
};

export function useDesktopCloudData({
  session,
  cloudEnvironment,
  projectId,
  onSessionChange,
  workspaceRevisionKey = null,
  loadProjectDetails = true,
  projectDetailResources = CLOUD_PROJECT_DETAIL_RESOURCES,
}: {
  session: DesktopCloudSession | null;
  cloudEnvironment: CloudEnvironment;
  /** Exact Project identity resolved from the current repository's canonical remote. */
  projectId: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  workspaceRevisionKey?: string | null;
  loadProjectDetails?: boolean;
  /** Route-owned resource plan; omitted resources do not issue requests. */
  projectDetailResources?: readonly CloudProjectDetailResource[];
}): DesktopCloudDataState {
  const cloudApiBaseUrl = cloudEnvironment.apiBaseUrl;
  const normalizedProjectId = projectId?.trim() || null;
  const projectDetailResourceKey = [...new Set(projectDetailResources)].sort().join(",");
  const contextKey = createCloudDataContextKey({
    session,
    cloudEnvironment,
    projectId: normalizedProjectId,
    projectDetailResourceKey,
  });
  const [state, setState] = useState<DesktopCloudDataInternalState>(() => createCloudDataState());
  const activeRequestRef = useRef(0);
  const sessionRef = useRef(session);
  const onSessionChangeRef = useRef(onSessionChange);
  sessionRef.current = session;
  onSessionChangeRef.current = onSessionChange;
  const hasCurrentContext = state.contextKey === contextKey;

  const load = useCallback(async () => {
    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;
    const activeSession = sessionRef.current;
    if (!activeSession || !normalizedProjectId) {
      setState(createCloudDataState({
        projectId: normalizedProjectId,
        initializing: false,
        loading: false,
        contextKey,
      }));
      return;
    }

    setState((current) => (
      current.contextKey === contextKey
        ? {
            ...current,
            initializing: false,
            loading: true,
            error: null,
            warning: null,
          }
        : createCloudDataState({
            projectId: normalizedProjectId,
            initializing: true,
            loading: true,
            contextKey,
          })
    ));

    try {
      const project = await getCloudProject(
        activeSession,
        normalizedProjectId,
        onSessionChangeRef.current,
        cloudApiBaseUrl,
      );
      if (activeRequestRef.current !== requestId) return;

      // Repository-context resolution owns identity and authorization. This
      // hook only loads data for that exact Project.
      if (!loadProjectDetails) {
        setState(createCloudDataState({
          projectId: normalizedProjectId,
          project,
          initializing: false,
          loading: false,
          contextKey,
        }));
        return;
      }

      const details = await loadCloudProjectDetails({
        session: activeSession,
        projectId: normalizedProjectId,
        project,
        onSessionChange: onSessionChangeRef.current,
        cloudApiBaseUrl,
        resources: projectDetailResourceKey
          ? projectDetailResourceKey.split(",") as CloudProjectDetailResource[]
          : [],
      });
      if (activeRequestRef.current !== requestId) return;

      setState({
        projectId: normalizedProjectId,
        project: details.project,
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
      if (activeRequestRef.current !== requestId) return;
      setState((current) => (
        current.contextKey === contextKey
          ? {
              ...current,
              initializing: false,
              loading: false,
              error: cloudMessage(
                "cloud-data-load-failed",
                undefined,
                loadError instanceof Error ? loadError.message : undefined,
              ),
              warning: null,
            }
          : createCloudDataState({
              initializing: false,
              loading: false,
              error: cloudMessage(
                "cloud-data-load-failed",
                undefined,
                loadError instanceof Error ? loadError.message : undefined,
              ),
              contextKey,
            })
      ));
    }
  }, [
    cloudApiBaseUrl,
    contextKey,
    loadProjectDetails,
    projectDetailResourceKey,
    normalizedProjectId,
  ]);

  useEffect(() => {
    void load();
    return () => {
      activeRequestRef.current += 1;
    };
  }, [load, workspaceRevisionKey]);

  if (session && !hasCurrentContext) {
    return {
      ...toPublicCloudDataState(createCloudDataState({
        projectId: normalizedProjectId,
        initializing: true,
        loading: true,
      })),
      reload: load,
    };
  }

  return { ...toPublicCloudDataState(state), reload: load };
}

function createCloudDataContextKey({
  session,
  cloudEnvironment,
  projectId,
  projectDetailResourceKey,
}: {
  session: DesktopCloudSession | null;
  cloudEnvironment: CloudEnvironment;
  projectId: string | null;
  projectDetailResourceKey: string;
}): string {
  if (!session) return "signed-out";
  return [
    session.user_id,
    session.user_email,
    session.session_generation,
    session.api_base_url ?? "",
    cloudEnvironment.cloudRemote?.rawUrl ?? "",
    projectId ?? "",
    projectDetailResourceKey,
  ].join("\n");
}

function createCloudDataState(
  overrides: Partial<DesktopCloudDataInternalState> = {},
): DesktopCloudDataInternalState {
  return {
    projectId: null,
    project: null,
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
