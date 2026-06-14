/**
 * Client for the scope-sandbox "sandbox as access point" API (#9).
 *
 * A scope-keyed remote dev box reachable via VSCode Remote-SSH. `connect`
 * acquires/reuses the scope's sandbox, grants the caller a short-lived SSH key
 * (their pasted public key), and returns the connection info + a ready-to-paste
 * ~/.ssh/config block. `revoke` pulls that access (offboarding / done).
 *
 * Backend: src/platform/scope_sandbox/router.py
 * (apiClient unwraps the {code,message,data} envelope → these return `data`.)
 */

import { get, post } from './apiClient';

export type SandboxProvider = 'e2b' | 'fly';

export interface SandboxConnectInfo {
  provider: string;
  state: string;                 // running | stopped | ...
  via: string;                   // created | resumed | reused
  host: string;
  port: number;
  username: string;
  proxy_command: string | null;  // set for E2B (websocat tunnel)
  needs_websocat: boolean;       // true → user must have websocat on PATH
  workspace_path: string;        // Git working tree to open in VS Code/Cursor
  ssh_config_block: string;      // ready-to-paste ~/.ssh/config block
  expires_at: number;            // epoch seconds — when this grant expires
  connected_users: number;
}

export interface SandboxProviderInfo {
  id: SandboxProvider;
  label: string;
  configured: boolean;   // credentials present server-side
}

export interface SandboxProviders {
  default: SandboxProvider;
  providers: SandboxProviderInfo[];
}

export interface SandboxStatus {
  state: string;                 // none | running | stopped | ...
  provider?: string;
  connected: boolean;            // is THIS user currently granted/connected
  connected_users: number;
  sandbox_id?: string;
  host?: string;
  port?: number;
  username?: string;
  proxy_command?: string | null;
  needs_websocat?: boolean;
  workspace_path?: string;
  ssh_config_block?: string;
}

/** Which providers this deployment offers + the default (drives the selector). */
export async function getScopeSandboxProviders(): Promise<SandboxProviders> {
  return get<SandboxProviders>('/api/v1/scope-sandboxes/providers');
}

/** Acquire/reuse the scope's sandbox and grant the caller SSH access. */
export async function connectScopeSandbox(params: {
  projectId: string;
  scopeId: string;
  publicKey: string;
  provider?: SandboxProvider;
}): Promise<SandboxConnectInfo> {
  return post<SandboxConnectInfo>('/api/v1/scope-sandboxes/connect', {
    project_id: params.projectId,
    scope_id: params.scopeId,
    public_key: params.publicKey,
    provider: params.provider ?? null,
  });
}

/** Current session state for a scope (no side effects). */
export async function getScopeSandboxStatus(
  projectId: string,
  scopeId: string,
): Promise<SandboxStatus> {
  const qs = new URLSearchParams({ project_id: projectId, scope_id: scopeId });
  return get<SandboxStatus>(`/api/v1/scope-sandboxes/status?${qs.toString()}`);
}

/** Revoke the caller's SSH access to the scope's sandbox. Returns remaining users. */
export async function revokeScopeSandbox(
  projectId: string,
  scopeId: string,
): Promise<{ connected_users: number }> {
  return post<{ connected_users: number }>('/api/v1/scope-sandboxes/revoke', {
    project_id: projectId,
    scope_id: scopeId,
  });
}
