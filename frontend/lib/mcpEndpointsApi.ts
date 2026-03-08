import { get, post, put, del } from './apiClient';

export interface McpEndpoint {
  id: string;
  project_id: string;
  node_id: string | null;
  name: string;
  description: string | null;
  api_key: string;
  tools_config: { tool_id: string; enabled: boolean }[];
  accesses: { node_id: string; json_path: string; readonly: boolean }[];
  config: Record<string, unknown>;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function listMcpEndpoints(projectId: string): Promise<McpEndpoint[]> {
  return get<McpEndpoint[]>(`/api/v1/mcp-endpoints?project_id=${projectId}`);
}

export async function getMcpEndpoint(id: string): Promise<McpEndpoint> {
  return get<McpEndpoint>(`/api/v1/mcp-endpoints/${id}`);
}

export async function getMcpEndpointByNode(nodeId: string): Promise<McpEndpoint | null> {
  try {
    return await get<McpEndpoint>(`/api/v1/mcp-endpoints/by-node/${nodeId}`);
  } catch {
    return null;
  }
}

export async function createMcpEndpoint(params: {
  project_id: string;
  name?: string;
  node_id?: string;
  description?: string;
  accesses?: { node_id: string; json_path?: string; readonly?: boolean }[];
  tools_config?: { tool_id: string; enabled?: boolean }[];
}): Promise<McpEndpoint> {
  return post<McpEndpoint>('/api/v1/mcp-endpoints', params);
}

export async function updateMcpEndpoint(id: string, params: Partial<{
  name: string;
  description: string;
  node_id: string;
  status: string;
  accesses: { node_id: string; json_path?: string; readonly?: boolean }[];
  tools_config: { tool_id: string; enabled?: boolean }[];
}>): Promise<McpEndpoint> {
  return put<McpEndpoint>(`/api/v1/mcp-endpoints/${id}`, params);
}

export async function deleteMcpEndpoint(id: string): Promise<void> {
  await del(`/api/v1/mcp-endpoints/${id}`);
}

export async function regenerateMcpEndpointKey(id: string): Promise<McpEndpoint> {
  return post<McpEndpoint>(`/api/v1/mcp-endpoints/${id}/regenerate-key`, {});
}
