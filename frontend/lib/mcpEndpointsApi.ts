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

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export async function listMcpEndpoints(projectId: string): Promise<McpEndpoint[]> {
  const resp = await get<ApiResponse<McpEndpoint[]>>(`/api/v1/mcp-endpoints?project_id=${projectId}`);
  return resp.data ?? [];
}

export async function getMcpEndpoint(id: string): Promise<McpEndpoint> {
  const resp = await get<ApiResponse<McpEndpoint>>(`/api/v1/mcp-endpoints/${id}`);
  return resp.data;
}

export async function getMcpEndpointByNode(nodeId: string): Promise<McpEndpoint | null> {
  try {
    const resp = await get<ApiResponse<McpEndpoint>>(`/api/v1/mcp-endpoints/by-node/${nodeId}`);
    return resp.data;
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
  const resp = await post<ApiResponse<McpEndpoint>>('/api/v1/mcp-endpoints', params);
  return resp.data;
}

export async function updateMcpEndpoint(id: string, params: Partial<{
  name: string;
  description: string;
  node_id: string;
  status: string;
  accesses: { node_id: string; json_path?: string; readonly?: boolean }[];
  tools_config: { tool_id: string; enabled?: boolean }[];
}>): Promise<McpEndpoint> {
  const resp = await put<ApiResponse<McpEndpoint>>(`/api/v1/mcp-endpoints/${id}`, params);
  return resp.data;
}

export async function deleteMcpEndpoint(id: string): Promise<void> {
  await del(`/api/v1/mcp-endpoints/${id}`);
}

export async function regenerateMcpEndpointKey(id: string): Promise<McpEndpoint> {
  const resp = await post<ApiResponse<McpEndpoint>>(`/api/v1/mcp-endpoints/${id}/regenerate-key`, {});
  return resp.data;
}
