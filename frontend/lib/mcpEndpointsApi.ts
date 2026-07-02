import { get, post, put, del } from './apiClient';

export type McpToolsConfig =
  | {
      version?: number;
      filesystem?: {
        allowed?: string[];
        allowed_tools?: string[];
        groups?: Record<string, boolean>;
        tools?: Record<string, boolean>;
      };
      fs?: {
        allowed?: string[];
        allowed_tools?: string[];
        groups?: Record<string, boolean>;
        tools?: Record<string, boolean>;
      };
      shell?: { enabled?: boolean };
      custom_tools?: { tool_id: string; enabled?: boolean }[];
      bound_tools?: { tool_id: string; enabled?: boolean }[];
      external_tools?: { tool_id: string; enabled?: boolean }[];
    }
  | { tool_id: string; enabled?: boolean }[];

export interface McpEndpoint {
  id: string;
  project_id: string;
  path: string | null;
  name: string;
  description: string | null;
  api_key: string;
  api_key_hint?: string;
  api_key_revealed?: boolean;
  /** Canonical MCP server URL external clients connect to (auth via the api_key
   *  sent as `Authorization: Bearer <key>`). Returned by the backend; falls back
   *  to `${NEXT_PUBLIC_API_URL}/api/v1/mcp/proxy` if absent. */
  server_url?: string;
  tools_config: McpToolsConfig;
  accesses: { path: string; json_path: string; readonly: boolean }[];
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

export async function getMcpEndpointByPath(path: string): Promise<McpEndpoint | null> {
  try {
    return await get<McpEndpoint>(`/api/v1/mcp-endpoints/by-path/${path}`);
  } catch {
    return null;
  }
}

export async function createMcpEndpoint(params: {
  project_id: string;
  name?: string;
  path?: string;
  description?: string;
  accesses?: { path: string; json_path?: string; readonly?: boolean }[];
  tools_config?: McpToolsConfig;
}): Promise<McpEndpoint> {
  return post<McpEndpoint>('/api/v1/mcp-endpoints', params);
}

export async function updateMcpEndpoint(id: string, params: Partial<{
  name: string;
  description: string;
  path: string;
  status: string;
  accesses: { path: string; json_path?: string; readonly?: boolean }[];
  tools_config: McpToolsConfig;
}>): Promise<McpEndpoint> {
  return put<McpEndpoint>(`/api/v1/mcp-endpoints/${id}`, params);
}

export async function deleteMcpEndpoint(id: string): Promise<void> {
  await del(`/api/v1/mcp-endpoints/${id}`);
}

export async function regenerateMcpEndpointKey(id: string): Promise<McpEndpoint> {
  return post<McpEndpoint>(`/api/v1/mcp-endpoints/${id}/regenerate-key`, {});
}
