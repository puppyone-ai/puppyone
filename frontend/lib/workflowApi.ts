import { del, get, patch, post } from './apiClient';

// Backend route name is still in migration; Workflow is the frontend
// product resource and should be the only exported business language here.
const WORKFLOW_BACKING_BASE = '/api/v1/integrations';

export interface WorkflowConfigField {
  key: string;
  label: string;
  type: 'text' | 'select' | 'number' | 'url';
  required: boolean;
  default: string | number | null;
  options: { value: string; label: string }[] | null;
  placeholder: string | null;
  hint: string | null;
}

export interface WorkflowProviderSpec {
  provider: string;
  display_name: string;
  description: string | null;
  auth: 'none' | 'oauth' | 'optional_oauth' | 'api_key' | 'access_key';
  creation_mode: 'direct' | 'bootstrap';
  category: 'datasource' | 'agent' | 'endpoint';
  icon: string | null;
  oauth_type?: string | null;
  oauth_ui_type?: string | null;
  default_node_type?: string;
  supported_sync_modes?: string[];
  default_sync_mode?: string;
  supported_directions?: string[];
  accept_types?: string[];
  config_fields?: WorkflowConfigField[];
  icon_url?: string | null;
  materialization_schema?: WorkflowMaterializationSchema | null;
  materialization_schemas?: WorkflowMaterializationSchema[];
}

export interface WorkflowMaterializationSchema {
  id: string;
  version: number;
  provider?: string | null;
  label: string;
  description: string;
  preview_paths: string[];
  managed: boolean;
  latest?: boolean;
  latest_version?: number;
  upgrade_available?: boolean;
}

export interface WorkflowSourceResource {
  id: string;
  type: string;
  name: string;
  url?: string | null;
  subtitle?: string | null;
  icon?: string | null;
  authorized: boolean;
  metadata: Record<string, unknown>;
}

export interface WorkflowProviderResourcesResponse {
  resources: WorkflowSourceResource[];
  next_cursor?: string | null;
}

export interface CreateWorkflowRequest {
  project_id: string;
  provider: string;
  config: Record<string, unknown>;
  target_folder_path?: string;
  target_path?: string;
  credentials_ref?: string;
  direction?: string;
  conflict_strategy?: string;
  sync_mode?: 'manual' | 'scheduled' | 'realtime';
  trigger?: { type: string; schedule?: string; timezone?: string };
}

export interface CreateWorkflowResult {
  sync: WorkflowConnection;
  execution_result?: WorkflowExecutionResult | null;
}

export interface WorkflowExecutionResult {
  connection_id: string;
  path: string;
  provider: string;
  commit_id: string;
  status: string;
  summary?: string;
  run_id?: string | null;
}

export interface WorkflowConnection {
  id: string;
  project_id: string;
  path: string | null;
  direction: string;
  provider: string;
  config: Record<string, unknown>;
  status: string;
  last_sync_commit_id: string;
  error_message?: string | null;
}

export interface WorkflowStatusItem {
  id: string;
  path?: string | null;
  node_name?: string | null;
  node_type?: string | null;
  provider: string;
  direction: string;
  status: string;
  name?: string | null;
  access_key?: string | null;
  trigger?: Record<string, unknown> | null;
  last_synced_at?: string | null;
  error_message?: string | null;
}

export interface WorkflowStatusResponse {
  syncs: WorkflowStatusItem[];
  uploads: unknown[];
}

export interface WorkflowPullResponse {
  synced: number;
  results: Array<Record<string, unknown>>;
}

export interface WorkflowFailedRunRow {
  id: string;
  connection_id: string;
  connection_name?: string | null;
  target_path?: string | null;
  provider: string;
  direction: string;
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
  error?: string | null;
  result_summary?: string | null;
  trigger_type?: string | null;
}

interface WorkflowFailedRunBackendRow {
  id: string;
  access_point_id: string;
  access_point_name?: string | null;
  access_point_path?: string | null;
  provider: string;
  direction: string;
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
  error?: string | null;
  result_summary?: string | null;
  trigger_type?: string | null;
}

interface CreateWorkflowBackendResult {
  sync: WorkflowConnection;
  execution_result?: {
    access_point_id: string;
    path: string;
    provider: string;
    commit_id: string;
    status: string;
    summary?: string;
    run_id?: string | null;
  } | null;
}

export async function getWorkflowProviderSpecs(): Promise<WorkflowProviderSpec[]> {
  return get<WorkflowProviderSpec[]>(`${WORKFLOW_BACKING_BASE}/connectors`);
}

export async function listWorkflowProviderResources(
  provider: string,
  params: { q?: string; cursor?: string | null; resource_type?: string | null } = {},
): Promise<WorkflowProviderResourcesResponse> {
  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.resource_type) query.set('resource_type', params.resource_type);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return get<WorkflowProviderResourcesResponse>(
    `${WORKFLOW_BACKING_BASE}/providers/${encodeURIComponent(provider)}/resources${suffix}`,
  );
}

export async function createWorkflow(
  body: CreateWorkflowRequest,
): Promise<CreateWorkflowResult> {
  const result = await post<CreateWorkflowBackendResult>(`${WORKFLOW_BACKING_BASE}/connections`, body);
  return {
    sync: result.sync,
    execution_result: result.execution_result
      ? {
        connection_id: result.execution_result.access_point_id,
        path: result.execution_result.path,
        provider: result.execution_result.provider,
        commit_id: result.execution_result.commit_id,
        status: result.execution_result.status,
        summary: result.execution_result.summary,
        run_id: result.execution_result.run_id,
      }
      : null,
  };
}

export async function listWorkflowConnections(
  projectId: string,
): Promise<WorkflowConnection[]> {
  return get<WorkflowConnection[]>(
    `${WORKFLOW_BACKING_BASE}/connections?project_id=${encodeURIComponent(projectId)}`,
  );
}

export async function getWorkflowStatus(
  projectId: string,
): Promise<WorkflowStatusResponse> {
  return get<WorkflowStatusResponse>(
    `${WORKFLOW_BACKING_BASE}/status?project_id=${encodeURIComponent(projectId)}`,
  );
}

export async function refreshWorkflowConnection(
  connectionId: string,
): Promise<WorkflowPullResponse> {
  return post<WorkflowPullResponse>(
    `${WORKFLOW_BACKING_BASE}/connections/${encodeURIComponent(connectionId)}/refresh`,
    {},
  );
}

export async function pauseWorkflowConnection(connectionId: string): Promise<unknown> {
  return post<unknown>(
    `${WORKFLOW_BACKING_BASE}/connections/${encodeURIComponent(connectionId)}/pause`,
    {},
  );
}

export async function resumeWorkflowConnection(connectionId: string): Promise<unknown> {
  return post<unknown>(
    `${WORKFLOW_BACKING_BASE}/connections/${encodeURIComponent(connectionId)}/resume`,
    {},
  );
}

export async function deleteWorkflowConnection(connectionId: string): Promise<unknown> {
  return del<unknown>(
    `${WORKFLOW_BACKING_BASE}/connections/${encodeURIComponent(connectionId)}`,
  );
}

export async function updateWorkflowTrigger(
  connectionId: string,
  body: { sync_mode: string; trigger?: Record<string, unknown> },
): Promise<unknown> {
  return patch<unknown>(
    `${WORKFLOW_BACKING_BASE}/connections/${encodeURIComponent(connectionId)}/trigger`,
    body,
  );
}

export async function updateWorkflowConnection(
  connectionId: string,
  body: {
    config?: Record<string, unknown>;
    target_path?: string;
    direction?: string;
    conflict_strategy?: string;
  },
): Promise<WorkflowConnection> {
  return patch<WorkflowConnection>(
    `${WORKFLOW_BACKING_BASE}/connections/${encodeURIComponent(connectionId)}`,
    body,
  );
}

export async function listWorkflowFailedRuns(
  projectId: string,
  limit: number = 50,
): Promise<WorkflowFailedRunRow[]> {
  const rows = await get<WorkflowFailedRunBackendRow[]>(
    `${WORKFLOW_BACKING_BASE}/failed-runs?project_id=${encodeURIComponent(projectId)}&limit=${limit}`,
  );
  return rows.map((row) => ({
    id: row.id,
    connection_id: row.access_point_id,
    connection_name: row.access_point_name,
    target_path: row.access_point_path,
    provider: row.provider,
    direction: row.direction,
    started_at: row.started_at,
    finished_at: row.finished_at,
    duration_ms: row.duration_ms,
    error: row.error,
    result_summary: row.result_summary,
    trigger_type: row.trigger_type,
  }));
}
