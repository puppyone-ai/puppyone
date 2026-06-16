/**
 * Activity API — unified upload / import / sync_run feed.
 *
 * Read-only aggregation over the backend `context_activity_items` view.
 * The frontend never owns activity lifecycle; it renders/polls status.
 * Each item keeps its own `kind` and lifecycle — this is a display feed,
 * not a write model.
 */

import { get } from './apiClient';

export type ActivityKind = 'upload' | 'import' | 'sync_run';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  project_id: string;
  created_by?: string | null;
  label?: string | null;
  status?: string | null;
  phase?: string | null;
  progress?: number | null;
  message?: string | null;
  error_message?: string | null;
  result_path?: string | null;
  result_commit_id?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
}

export interface ActivityListResponse {
  items: ActivityItem[];
  total: number;
}

const TERMINAL_ACTIVITY_STATUSES = new Set([
  'completed',
  'success',
  'failed',
  'cancelled',
  'canceled',
  'skipped',
  'conflict',
  'error',
]);

/** An item is in-progress until it has completed_at or a terminal status. */
export function isActivityItemActive(item: ActivityItem): boolean {
  const status = (item.status || '').toLowerCase();
  const phase = (item.phase || '').toLowerCase();
  return !item.completed_at
    && !TERMINAL_ACTIVITY_STATUSES.has(status)
    && !TERMINAL_ACTIVITY_STATUSES.has(phase);
}

export function getProjectActivity(
  projectId: string,
  options?: { kind?: ActivityKind; activeOnly?: boolean; limit?: number },
): Promise<ActivityListResponse> {
  const params = new URLSearchParams({ project_id: projectId });
  if (options?.kind) params.set('kind', options.kind);
  if (options?.activeOnly) params.set('active_only', 'true');
  if (options?.limit) params.set('limit', String(options.limit));
  return get<ActivityListResponse>(`/api/v1/activity?${params.toString()}`);
}
