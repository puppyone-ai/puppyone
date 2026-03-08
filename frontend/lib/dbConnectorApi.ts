/**
 * DB Connector API Client
 */

import { apiRequest } from './apiClient';

// === Types ===

export type KeyType = 'anon' | 'service_role';

export interface DBConnection {
  id: string;
  name: string;
  provider: string;
  project_id: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface TableInfo {
  name: string;
  type: string;
  columns: { name: string; type: string }[];
}

export interface TablePreview {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  execution_time_ms: number;
}

export interface SaveResult {
  content_node_id: string;
  row_count: number;
}

export interface ConnectionErrorDetail {
  error_code: string | null;
  message: string;
  suggested_actions: string[];
}

export interface ErrorResponse {
  success: false;
  error: ConnectionErrorDetail;
}

// === Helper Functions ===

/**
 * Generate RLS policy SQL for users to copy and execute in Supabase
 */
export function generateRLSPolicy(tableName: string): string {
  return `-- Copy to Supabase SQL Editor and execute:

ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access for anon" ON ${tableName}
  FOR SELECT
  TO anon
  USING (true);

-- Verify the policy
SELECT * FROM ${tableName} LIMIT 1;
`;
}

// === API Functions ===

export async function createConnection(
  projectId: string,
  data: {
    name: string;
    provider: string;
    project_url: string;
    api_key: string;
    key_type?: KeyType;
  }
): Promise<{ connection: DBConnection; database_info: Record<string, unknown> }> {
  const res = await apiRequest<{ connection: DBConnection; database_info: Record<string, unknown> }>(
    `/api/v1/db-connector/connections?project_id=${projectId}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
  );
  return res;
}

export async function listConnections(projectId: string): Promise<DBConnection[]> {
  const res = await apiRequest<DBConnection[]>(
    `/api/v1/db-connector/connections?project_id=${projectId}`
  );
  return res;
}

export async function deleteConnection(connectionId: string): Promise<void> {
  await apiRequest(`/api/v1/db-connector/connections/${connectionId}`, { method: 'DELETE' });
}

export async function listTables(connectionId: string): Promise<TableInfo[]> {
  const res = await apiRequest<TableInfo[]>(
    `/api/v1/db-connector/connections/${connectionId}/tables`
  );
  return res;
}

export async function previewTable(connectionId: string, tableName: string, limit: number = 50): Promise<TablePreview> {
  const res = await apiRequest<TablePreview>(
    `/api/v1/db-connector/connections/${connectionId}/tables/${tableName}/preview?limit=${limit}`
  );
  return res;
}

export async function saveTable(
  connectionId: string,
  projectId: string,
  data: { name: string; table: string; limit?: number }
): Promise<SaveResult> {
  const res = await apiRequest<SaveResult>(
    `/api/v1/db-connector/connections/${connectionId}/save?project_id=${projectId}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
  );
  return res;
}
