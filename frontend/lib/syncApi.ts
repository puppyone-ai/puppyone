import { del, get, patch, post } from './apiClient';

const INTEGRATIONS_BASE = '/api/v1/integrations';

export interface ConnectorConfigField {
  key: string;
  label: string;
  type: 'text' | 'select' | 'number' | 'url';
  required: boolean;
  default: string | number | null;
  options: { value: string; label: string }[] | null;
  placeholder: string | null;
  hint: string | null;
}

export interface ConnectorSpec {
  provider: string;
  display_name: string;
  description: string | null;
  auth: 'none' | 'oauth' | 'optional_oauth' | 'api_key' | 'access_key';
  creation_mode: 'direct' | 'bootstrap';
  category: 'datasource' | 'agent' | 'endpoint';
  icon: string | null;
  // Datasource-only:
  oauth_type?: string | null;
  oauth_ui_type?: string | null;
  default_node_type?: string;
  supported_sync_modes?: string[];
  default_sync_mode?: string;
  supported_directions?: string[];
  accept_types?: string[];
  config_fields?: ConnectorConfigField[];
  icon_url?: string | null;
}

export interface CreateSyncRequest {
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

export interface CreateSyncResult {
  sync: {
    id: string;
    project_id: string;
    path: string | null;
    direction: string;
    provider: string;
    config: Record<string, unknown>;
    status: string;
    last_sync_commit_id: string;
    error_message?: string | null;
  };
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

export type IntegrationSpec = ConnectorSpec;
export type CreateIntegrationRequest = CreateSyncRequest;
export type CreateIntegrationResult = CreateSyncResult;

export interface IntegrationFailedRunRow {
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

export type FailedIntegrationRunRow = IntegrationFailedRunRow;

export interface IntegrationConnection {
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

export interface IntegrationStatusItem {
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

export interface IntegrationStatusResponse {
  syncs: IntegrationStatusItem[];
  uploads: unknown[];
}

export interface IntegrationPullResponse {
  synced: number;
  results: Array<Record<string, unknown>>;
}

export async function getConnectorSpecs(): Promise<ConnectorSpec[]> {
  return get<ConnectorSpec[]>(`${INTEGRATIONS_BASE}/connectors`);
}

export async function getConnectionTypes(): Promise<ConnectorSpec[]> {
  return get<ConnectorSpec[]>('/api/v1/access/types');
}

export async function createSyncConnection(
  body: CreateSyncRequest,
): Promise<CreateSyncResult> {
  return post<CreateSyncResult>(`${INTEGRATIONS_BASE}/connections`, body);
}

export async function listIntegrationConnections(
  projectId: string,
): Promise<IntegrationConnection[]> {
  return get<IntegrationConnection[]>(
    `${INTEGRATIONS_BASE}/connections?project_id=${encodeURIComponent(projectId)}`,
  );
}

export async function getIntegrationStatus(
  projectId: string,
): Promise<IntegrationStatusResponse> {
  return get<IntegrationStatusResponse>(
    `${INTEGRATIONS_BASE}/status?project_id=${encodeURIComponent(projectId)}`,
  );
}

export async function refreshIntegrationConnection(
  connectionId: string,
): Promise<IntegrationPullResponse> {
  return post<IntegrationPullResponse>(
    `${INTEGRATIONS_BASE}/connections/${encodeURIComponent(connectionId)}/refresh`,
    {},
  );
}

export async function pauseIntegrationConnection(connectionId: string): Promise<unknown> {
  return post<unknown>(
    `${INTEGRATIONS_BASE}/connections/${encodeURIComponent(connectionId)}/pause`,
    {},
  );
}

export async function resumeIntegrationConnection(connectionId: string): Promise<unknown> {
  return post<unknown>(
    `${INTEGRATIONS_BASE}/connections/${encodeURIComponent(connectionId)}/resume`,
    {},
  );
}

export async function deleteIntegrationConnection(connectionId: string): Promise<unknown> {
  return del<unknown>(
    `${INTEGRATIONS_BASE}/connections/${encodeURIComponent(connectionId)}`,
  );
}

export async function updateIntegrationTrigger(
  connectionId: string,
  body: { sync_mode: string; trigger?: Record<string, unknown> },
): Promise<unknown> {
  return patch<unknown>(
    `${INTEGRATIONS_BASE}/connections/${encodeURIComponent(connectionId)}/trigger`,
    body,
  );
}

/**
 * Raw backend compatibility shape returned by failed-runs.
 * Prefer listIntegrationFailedRuns for Integration UI code; it maps
 * legacy access_point_* fields onto connection_* and target_path.
 */
export interface FailedSyncRunRow {
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

export async function listFailedSyncRuns(
  projectId: string,
  limit: number = 50,
): Promise<FailedSyncRunRow[]> {
  return get<FailedSyncRunRow[]>(
    `${INTEGRATIONS_BASE}/failed-runs?project_id=${encodeURIComponent(projectId)}&limit=${limit}`,
  );
}

export async function listIntegrationFailedRuns(
  projectId: string,
  limit: number = 50,
): Promise<IntegrationFailedRunRow[]> {
  const rows = await listFailedSyncRuns(projectId, limit);
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

export async function retrySyncAccessPoint(syncId: string): Promise<unknown> {
  // The backend exposes "resume" as the closest semantic verb — it
  // un-pauses + kicks off a run. For a failed-but-still-active
  // integration the call also re-queues.
  return post<unknown>(
    `${INTEGRATIONS_BASE}/connections/${encodeURIComponent(syncId)}/resume`,
    {},
  );
}
