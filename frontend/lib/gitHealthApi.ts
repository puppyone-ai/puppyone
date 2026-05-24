import { get, post } from '@/lib/apiClient';

export type GitViewHealth = 'empty' | 'healthy' | 'history_degraded' | 'current_corrupt';

export interface GitHealthAction {
  type: string;
  label: string;
}

export interface GitViewHealthPayload {
  project_id: string;
  scope_path: string;
  scope_excludes: string[];
  health: GitViewHealth;
  git_head: string;
  canonical_head: string;
  history_cut: boolean;
  git_usable: boolean;
  clone_usable: boolean;
  fetch_usable: boolean;
  push_usable: boolean;
  read_only: boolean;
  reason: string;
  recommended_actions: GitHealthAction[];
}

// Back-compat alias: callers built against the AP-only world reference
// ``GitAccessPointHealth``. The shape is identical to project-root
// health so the alias is safe.
export type GitAccessPointHealth = GitViewHealthPayload;

export function getGitAccessPointHealth(accessKey: string): Promise<GitViewHealthPayload> {
  return get<GitViewHealthPayload>(`/git/ap/${encodeURIComponent(accessKey)}.git/health`);
}

/** Health for the project-root Git remote — the user-visible mirror of the
 * canonical project tree. Same payload shape as the AP variant. */
export function getGitProjectHealth(projectId: string): Promise<GitViewHealthPayload> {
  return get<GitViewHealthPayload>(`/git/${encodeURIComponent(projectId)}.git/health`);
}

export interface GitCacheRebuildVariant {
  view_id: string;
  project_id: string;
  scope_path: string;
  scope_excludes: string[];
  history_mode: 'full' | 'receive-boundary';
  blob_mode: 'included' | 'omitted';
  head: string;
}

export interface GitCacheRebuildResponse {
  variants: GitCacheRebuildVariant[];
}

/** Drop and rewarm the per-view Git transport cache from canonical Version
 * Engine facts. Both cache variants (full-history-with-blobs for clone/fetch
 * and receive-boundary-without-blobs for push advertisement) are rebuilt in
 * one call so the next request hits a warm cache regardless of direction.
 * Requires writable access (same gate as push). */
export function rebuildGitProjectCache(projectId: string): Promise<GitCacheRebuildResponse> {
  return post<GitCacheRebuildResponse>(
    `/git/${encodeURIComponent(projectId)}.git/rebuild-cache`,
    {},
  );
}

export function rebuildGitAccessPointCache(accessKey: string): Promise<GitCacheRebuildResponse> {
  return post<GitCacheRebuildResponse>(
    `/git/ap/${encodeURIComponent(accessKey)}.git/rebuild-cache`,
    {},
  );
}
