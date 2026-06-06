import useSWR from 'swr';
import {
  getProjectActivity,
  isActivityItemActive,
  type ActivityItem,
  type ActivityKind,
} from '@/lib/activityApi';

const DEFAULT_ACTIVITY_POLL_MS = 3000;

/**
 * Poll the unified activity feed for a project, optionally filtered to one
 * kind. Polling stops once nothing is in-progress (mirrors useProjectImportJobs).
 */
export function useProjectActivity(
  projectId?: string | null,
  options?: { kind?: ActivityKind; limit?: number },
) {
  const kind = options?.kind;
  const limit = options?.limit ?? 20;

  const { data, error, isLoading, mutate } = useSWR(
    projectId ? ['activity', projectId, kind ?? 'all'] : null,
    () => getProjectActivity(projectId!, { kind, limit }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: (latest) => {
        const items = latest?.items ?? [];
        return items.some(isActivityItemActive) ? DEFAULT_ACTIVITY_POLL_MS : 0;
      },
    },
  );

  const items: ActivityItem[] = data?.items ?? [];
  return {
    items,
    activeItems: items.filter(isActivityItemActive),
    isLoading,
    error,
    refresh: mutate,
  };
}
