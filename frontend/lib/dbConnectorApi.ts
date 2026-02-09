/**
 * DB Connector API Client
 */

import { apiRequest } from './apiClient';

// === Types ===

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

// === API Functions ===

export async function createConnection(
  projectId: string,
  data: { name: string; provider: string; project_url: string; service_role_key: string }
): Promise<{ connection: DBConnection; database_info: Record<string, unknown> }> {
  const res = await apiRequest<{ data: { connection: DBConnection; database_info: Record<string, unknown> } }>(
    `/api/v1/db-connector/connections?project_id=${projectId}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
  );
  return res.data;
}

export async function listConnections(projectId: string): Promise<DBConnection[]> {
  const res = await apiRequest<{ data: DBConnection[] }>(
    `/api/v1/db-connector/connections?project_id=${projectId}`
  );
  return res.data;
}

export async function deleteConnection(connectionId: string): Promise<void> {
  await apiRequest(`/api/v1/db-connector/connections/${connectionId}`, { method: 'DELETE' });
}

export async function listTables(connectionId: string): Promise<TableInfo[]> {
  const res = await apiRequest<{ data: TableInfo[] }>(
    `/api/v1/db-connector/connections/${connectionId}/tables`
  );
  return res.data;
}

export async function previewTable(connectionId: string, tableName: string, limit: number = 50): Promise<TablePreview> {
  const res = await apiRequest<{ data: TablePreview }>(
    `/api/v1/db-connector/connections/${connectionId}/tables/${tableName}/preview?limit=${limit}`
  );
  return res.data;
}

export async function saveTable(
  connectionId: string,
  projectId: string,
  data: { name: string; table: string; limit?: number }
): Promise<SaveResult> {
  const res = await apiRequest<{ data: SaveResult }>(
    `/api/v1/db-connector/connections/${connectionId}/save?project_id=${projectId}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
  );
  return res.data;
}
