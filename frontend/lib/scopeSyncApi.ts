/**
 * Client for the scope-sync managed policy + settings (PUP-sync-trigger M5).
 *
 * Users pick a coarse intent (persona + auto-sync); the server resolves the
 * managed SyncPolicy. The sidecar reads the policy; the frontend shows the
 * toggle + a plain-language summary. Backend: src/platform/scope_sync/router.py.
 */

import { get, put } from './apiClient';

export type SyncPersona = 'non_dev' | 'dev' | 'reviewer';

export interface SyncSettings {
  persona: SyncPersona;
  auto_sync: boolean;
}

export interface SyncPolicyResolved {
  persona: SyncPersona;
  client_kind: string;
  scope_role: 'root' | 'sub';
  auto_sync: boolean;
  policy: {
    checkpoint_debounce_s: number;
    quiescence_publish_s: number;
    publish_on_agent_done: boolean;
    publish_on_verification: boolean;
    publish_on_disconnect: boolean;
    conflict_policy: string;
    [k: string]: unknown;
  };
}

export async function getSyncSettings(projectId: string, scopeId: string): Promise<SyncSettings> {
  const qs = new URLSearchParams({ project_id: projectId, scope_id: scopeId });
  return get<SyncSettings>(`/api/v1/scope-sync/settings?${qs.toString()}`);
}

export async function putSyncSettings(
  projectId: string,
  scopeId: string,
  patch: Partial<Pick<SyncSettings, 'persona' | 'auto_sync'>>,
): Promise<SyncSettings> {
  return put<SyncSettings>('/api/v1/scope-sync/settings', {
    project_id: projectId,
    scope_id: scopeId,
    ...patch,
  });
}

export async function getSyncPolicy(
  projectId: string,
  scopeId: string,
  persona?: SyncPersona,
): Promise<SyncPolicyResolved> {
  const qs = new URLSearchParams({ project_id: projectId, scope_id: scopeId });
  if (persona) qs.set('persona', persona);
  return get<SyncPolicyResolved>(`/api/v1/scope-sync/policy?${qs.toString()}`);
}

/** Plain-language summary of what the resolved policy does (for non-technical users). */
export function describeSyncPolicy(p: SyncPolicyResolved): string {
  if (!p.auto_sync) return 'Auto-sync is off — changes stay local until you connect and publish manually.';
  const parts: string[] = ['Your edits are checkpointed automatically (private, revertible).'];
  if (p.policy.quiescence_publish_s > 0) {
    parts.push('Published to everyone when an agent finishes a task or after a short idle.');
  } else if (p.policy.publish_on_verification) {
    parts.push('Published when you save or when tests/build pass.');
  } else {
    parts.push('Published when you explicitly save.');
  }
  return parts.join(' ');
}
