import { IWorkspaceStore, WorkspaceBasic } from './store';
import { SERVER_ENV } from '@/lib/serverEnv';

function authHeaders(authHeader?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authHeader) headers['Authorization'] = authHeader;
  if (SERVER_ENV.SERVICE_KEY) headers['X-Service-Key'] = SERVER_ENV.SERVICE_KEY;
  return headers;
}

export class UserSystemWorkspaceStore implements IWorkspaceStore {
  private base = SERVER_ENV.USER_SYSTEM_BACKEND.replace(/\/$/, '');

  async listWorkspaces(
    userId: string,
    opts?: { authHeader?: string }
  ): Promise<WorkspaceBasic[]> {
    const url = `${this.base}/get_user_workspaces/${userId}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(opts?.authHeader),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`listWorkspaces failed: ${res.status}`);
    const json = await res.json();
    return (json.workspaces || []) as WorkspaceBasic[];
  }

  async createWorkspace(
    userId: string,
    payload: { workspace_id: string; workspace_name: string },
    opts?: { authHeader?: string }
  ): Promise<WorkspaceBasic> {
    const url = `${this.base}/create_workspace/${userId}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(opts?.authHeader),
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`createWorkspace failed: ${res.status}`);
    const json = await res.json();
    return {
      workspace_id: json.workspace_id,
      workspace_name: json.workspace_name,
    };
  }

  async deleteWorkspace(
    workspaceId: string,
    opts?: { authHeader?: string }
  ): Promise<void> {
    const url = `${this.base}/delete_workspace/${workspaceId}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: authHeaders(opts?.authHeader),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`deleteWorkspace failed: ${res.status}`);
  }

  async renameWorkspace(
    workspaceId: string,
    newName: string,
    opts?: { authHeader?: string }
  ): Promise<WorkspaceBasic> {
    const url = `${this.base}/update_workspace_name/${workspaceId}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: authHeaders(opts?.authHeader),
      credentials: 'include',
      body: JSON.stringify({ new_name: newName }),
    });
    if (!res.ok) throw new Error(`renameWorkspace failed: ${res.status}`);
    const json = await res.json();
    return {
      workspace_id: json.workspace_id,
      workspace_name: json.workspace_name,
    };
  }

  async getLatestHistory(
    workspaceId: string,
    opts?: { authHeader?: string }
  ): Promise<any | null> {
    const url = `${this.base}/get_latest_workspace_history/${workspaceId}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(opts?.authHeader),
      credentials: 'include',
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`getLatestHistory failed: ${res.status}`);
    const json = await res.json();
    return json.history ?? null;
  }

  async addHistory(
    workspaceId: string,
    data: { history: any; timestamp: string },
    opts?: { authHeader?: string }
  ): Promise<void> {
    const url = `${this.base}/add_workspace_history/${workspaceId}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(opts?.authHeader),
      credentials: 'include',
      body: JSON.stringify({
        history: data.history,
        timestamp: data.timestamp,
      }),
    });
    if (!res.ok) throw new Error(`addHistory failed: ${res.status}`);
  }
}
