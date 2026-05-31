import useSWR from 'swr';
import {
  getProjectImportJobs,
  isImportJobTerminal,
  type ImportJob,
} from '@/lib/importApi';

const DEFAULT_IMPORT_JOB_POLL_MS = 3000;

export function useProjectImportJobs(projectId?: string | null) {
  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR(
    projectId ? ['import-jobs', projectId] : null,
    () => getProjectImportJobs(projectId!, { limit: 20 }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      refreshInterval: (latest) => {
        const jobs = latest?.jobs ?? [];
        return jobs.some(job => !isImportJobTerminal(job.status))
          ? DEFAULT_IMPORT_JOB_POLL_MS
          : 0;
      },
    },
  );

  const jobs = data?.jobs ?? [];
  const activeJob = jobs.find(job => !isImportJobTerminal(job.status)) ?? null;
  const latestJob = jobs[0] ?? null;

  return {
    jobs,
    activeJob,
    latestJob,
    isLoading,
    error,
    refresh: mutate,
    upsertJob: (job: ImportJob) => mutate(
      (current) => {
        const currentJobs = current?.jobs ?? [];
        const nextJobs = [
          job,
          ...currentJobs.filter(existing => existing.id !== job.id),
        ];
        return { jobs: nextJobs, total: nextJobs.length };
      },
      { revalidate: true },
    ),
  };
}
