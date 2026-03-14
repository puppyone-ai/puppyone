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

export interface ConnectorSpec {
  provider: string;
  display_name: string;
  description: string | null;
  auth: 'none' | 'oauth' | 'api_key' | 'access_key';
  oauth_type: string | null;
  oauth_ui_type: string | null;
  default_node_type: string;
  supported_sync_modes: string[];
  default_sync_mode: string;
  creation_mode: 'direct' | 'bootstrap';
  supported_directions: string[];
  accept_types: string[];
  config_fields: ConnectorConfigField[];
  icon: string | null;
}

export interface CreateSyncRequest {
  project_id: string;
  provider: string;
  config: Record<string, unknown>;
  target_folder_node_id: string;
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
    node_id: string | null;
    direction: string;
    provider: string;
    config: Record<string, unknown>;
    status: string;
    last_sync_version: number;
    error_message?: string | null;
  };
  execution_result?: {
    sync_id: string;
    node_id: string;
    provider: string;
    version: number;
    status: string;
    summary?: string;
    run_id?: string | null;
  } | null;
}

export async function getConnectorSpecs(): Promise<ConnectorSpec[]> {
  return get<ConnectorSpec[]>('/api/v1/sync/connectors');
}

export async function createSyncConnection(
  body: CreateSyncRequest,
): Promise<CreateSyncResult> {
  return post<CreateSyncResult>('/api/v1/sync/syncs', body);
}
