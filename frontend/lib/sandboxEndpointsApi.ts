import { get, post, put, del } from './apiClient';

export interface SandboxMountPermissions {
  read: boolean;
  write: boolean;
  exec: boolean;
}

export interface SandboxMount {
  node_id: string;
  mount_path: string;
  permissions: SandboxMountPermissions;
}

export interface SandboxResourceLimits {
  memory_mb: number;
  cpu_shares: number;
}

export interface SandboxEndpoint {
  id: string;
  project_id: string;
  node_id: string | null;
  name: string;
  description: string | null;
  access_key: string;
  mounts: SandboxMount[];
  runtime: 'alpine' | 'python' | 'node';
  provider: 'docker' | 'e2b';
  timeout_seconds: number;
  resource_limits: SandboxResourceLimits;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export async function listSandboxEndpoints(projectId: string): Promise<SandboxEndpoint[]> {
  const resp = await get<ApiResponse<SandboxEndpoint[]>>(`/api/v1/sandbox-endpoints?project_id=${projectId}`);
  return resp.data ?? [];
}

export async function getSandboxEndpoint(id: string): Promise<SandboxEndpoint> {
  const resp = await get<ApiResponse<SandboxEndpoint>>(`/api/v1/sandbox-endpoints/${id}`);
  return resp.data;
}

export async function getSandboxEndpointByNode(nodeId: string): Promise<SandboxEndpoint | null> {
  try {
    const resp = await get<ApiResponse<SandboxEndpoint>>(`/api/v1/sandbox-endpoints/by-node/${nodeId}`);
    return resp.data;
  } catch {
    return null;
  }
}

export async function createSandboxEndpoint(params: {
  project_id: string;
  name?: string;
  node_id?: string;
  description?: string;
  mounts?: { node_id: string; mount_path?: string; permissions?: Partial<SandboxMountPermissions> }[];
  runtime?: 'alpine' | 'python' | 'node';
  provider?: 'docker' | 'e2b';
  timeout_seconds?: number;
  resource_limits?: Partial<SandboxResourceLimits>;
}): Promise<SandboxEndpoint> {
  const resp = await post<ApiResponse<SandboxEndpoint>>('/api/v1/sandbox-endpoints', params);
  return resp.data;
}

export async function updateSandboxEndpoint(id: string, params: Partial<{
  name: string;
  description: string;
  node_id: string;
  status: string;
  mounts: { node_id: string; mount_path?: string; permissions?: Partial<SandboxMountPermissions> }[];
  runtime: 'alpine' | 'python' | 'node';
  provider: 'docker' | 'e2b';
  timeout_seconds: number;
  resource_limits: Partial<SandboxResourceLimits>;
}>): Promise<SandboxEndpoint> {
  const resp = await put<ApiResponse<SandboxEndpoint>>(`/api/v1/sandbox-endpoints/${id}`, params);
  return resp.data;
}

export async function deleteSandboxEndpoint(id: string): Promise<void> {
  await del(`/api/v1/sandbox-endpoints/${id}`);
}

export async function regenerateSandboxEndpointKey(id: string): Promise<SandboxEndpoint> {
  const resp = await post<ApiResponse<SandboxEndpoint>>(`/api/v1/sandbox-endpoints/${id}/regenerate-key`, {});
  return resp.data;
}
