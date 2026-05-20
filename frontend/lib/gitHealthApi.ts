import { get } from '@/lib/apiClient';

export type GitViewHealth = 'empty' | 'healthy' | 'history_degraded' | 'current_corrupt';

export interface GitHealthAction {
  type: string;
  label: string;
}

export interface GitAccessPointHealth {
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

export function getGitAccessPointHealth(accessKey: string): Promise<GitAccessPointHealth> {
  return get<GitAccessPointHealth>(`/git/ap/${encodeURIComponent(accessKey)}.git/health`);
}
