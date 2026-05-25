import { get, post } from './apiClient';

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

/**
 * Union of every "thing you can attach to a project" exposed by
 * ``GET /api/v1/access/types``. The fields below ``category`` are only
 * populated for datasource connectors; agent/mcp/sandbox entries omit
 * them entirely. Mark them optional so callers narrow on ``category``
 * before reading the sync-specific bits.
 */
export interface ConnectorSpec {
  provider: string;
  display_name: string;
  description: string | null;
  auth: 'none' | 'oauth' | 'api_key' | 'access_key';
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
  target_folder_path: string;
  credentials_ref?: string;
  direction?: string;
  conflict_strategy?: string;
  sync_mode?: 'import_once' | 'manual' | 'scheduled';
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

export async function getConnectorSpecs(): Promise<ConnectorSpec[]> {
  return get<ConnectorSpec[]>('/api/v1/sync/connectors');
}

export async function getConnectionTypes(): Promise<ConnectorSpec[]> {
  return get<ConnectorSpec[]>('/api/v1/access/types');
}

export async function createSyncConnection(
  body: CreateSyncRequest,
): Promise<CreateSyncResult> {
  return post<CreateSyncResult>('/api/v1/sync/syncs', body);
}

/**
 * Row shape returned by ``GET /api/v1/sync/failed-runs?project_id=…``.
 * Mirrors the backend ``FailedSyncRunItem`` model — newest-first,
 * limited; includes the access-point name/path so the Needs Action
 * row can render without a second fetch.
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
    `/api/v1/sync/failed-runs?project_id=${encodeURIComponent(projectId)}&limit=${limit}`,
  );
}

export async function retrySyncAccessPoint(syncId: string): Promise<unknown> {
  // The backend exposes "resume" as the closest semantic verb — it
  // un-pauses + kicks off a run (see ``/sync/syncs/{id}/resume``). For
  // a failed-but-still-active sync the call also re-queues.
  return post<unknown>(`/api/v1/sync/syncs/${encodeURIComponent(syncId)}/resume`, {});
}
