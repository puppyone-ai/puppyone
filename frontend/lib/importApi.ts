/**
 * Import API - durable SaaS/URL import jobs
 *
 * User-triggered imports are backend-owned jobs. The frontend creates a job,
 * then renders/polls job status; it never owns the import lifecycle.
 */

import { del, get, post } from './apiClient';

// === Types ===

export type ImportType =
  | 'github'
  | 'notion'
  | 'airtable'
  | 'google_sheets'
  | 'google_docs'
  | 'google_drive'
  | 'google_calendar'
  | 'gmail'
  | 'linear'
  | 'url'
  | 'file'
  | 'web_page';

export type ImportStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ImportSubmitRequest {
  project_id: string;
  name?: string;
  url?: string;
  crawl_options?: CrawlOptions;
}

export interface CrawlOptions {
  limit?: number;
  maxDepth?: number;
  includePaths?: string[];
  excludePaths?: string[];
  crawlEntireDomain?: boolean;
  sitemap?: 'only' | 'include' | 'skip';
  allowSubdomains?: boolean;
  allowExternalLinks?: boolean;
  delay?: number;
}

export interface ImportSubmitResponse {
  task_id: string;
  status: ImportStatus;
  import_type: ImportType;
  path?: string;
}

export type ImportJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ImportJob {
  id: string;
  org_id?: string | null;
  project_id: string;
  created_by: string;
  provider: ImportType | string;
  source_url: string;
  name?: string | null;
  target_path: string;
  config: Record<string, any>;
  status: ImportJobStatus;
  phase: string;
  progress: number;
  message?: string | null;
  result_path?: string | null;
  result_commit_id?: string | null;
  error_message?: string | null;
  worker_job_id?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportJobCreateRequest {
  project_id: string;
  source_url: string;
  provider?: string;
  name?: string;
  target_path?: string;
  crawl_options?: CrawlOptions;
  config?: Record<string, any>;
}

export interface ImportJobListResponse {
  jobs: ImportJob[];
  total: number;
}

export interface ImportTaskResponse {
  task_id: string;
  source_type: 'saas' | 'url';
  ingest_type: ImportType;
  status: ImportStatus;
  progress: number;
  message?: string;
  content_path?: string;
  path?: string;
  items_count?: number;
  error?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
}

// === Utility Functions ===

export function isTerminalStatus(status: ImportStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function getStatusInfo(status: ImportStatus): {
  label: string;
  color: string;
  bgColor: string;
} {
  switch (status) {
    case 'pending':
      return { label: 'Pending', color: 'text-[var(--po-text-subtle)]', bgColor: 'bg-[var(--po-control)]' };
    case 'processing':
      return { label: 'Processing', color: 'text-[var(--po-accent)]', bgColor: 'bg-[color-mix(in_srgb,var(--po-accent)_12%,transparent)]' };
    case 'completed':
      return { label: 'Completed', color: 'text-[var(--po-success)]', bgColor: 'bg-[color-mix(in_srgb,var(--po-success)_12%,transparent)]' };
    case 'failed':
      return { label: 'Failed', color: 'text-[var(--po-danger)]', bgColor: 'bg-[color-mix(in_srgb,var(--po-danger)_12%,transparent)]' };
    case 'cancelled':
      return { label: 'Cancelled', color: 'text-[var(--po-text-subtle)]', bgColor: 'bg-[var(--po-control)]' };
    default:
      return { label: status, color: 'text-[var(--po-text-subtle)]', bgColor: 'bg-[var(--po-control)]' };
  }
}

export function getImportTypeInfo(importType: ImportType): {
  label: string;
  icon: string;
} {
  switch (importType) {
    case 'github':
      return { label: 'GitHub', icon: '🐙' };
    case 'notion':
      return { label: 'Notion', icon: '📝' };
    case 'airtable':
      return { label: 'Airtable', icon: '📊' };
    case 'google_sheets':
      return { label: 'Google Sheets', icon: '📗' };
    case 'google_docs':
      return { label: 'Google Docs', icon: '📘' };
    case 'google_drive':
      return { label: 'Google Drive', icon: '📁' };
    case 'google_calendar':
      return { label: 'Google Calendar', icon: '📅' };
    case 'gmail':
      return { label: 'Gmail', icon: '📧' };
    case 'linear':
      return { label: 'Linear', icon: '📐' };
    case 'url':
    case 'web_page':
      return { label: 'Website', icon: '🌐' };
    case 'file':
      return { label: 'File', icon: '📄' };
    default:
      return { label: importType, icon: '📦' };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// === API Functions ===

export function isImportJobTerminal(status: ImportJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function createImportJob(request: ImportJobCreateRequest): Promise<ImportJob> {
  return post<ImportJob>('/api/v1/imports', request);
}

export function getProjectImportJobs(
  projectId: string,
  options?: { activeOnly?: boolean; limit?: number },
): Promise<ImportJobListResponse> {
  const params = new URLSearchParams({ project_id: projectId });
  if (options?.activeOnly) params.set('active_only', 'true');
  if (options?.limit) params.set('limit', String(options.limit));
  return get<ImportJobListResponse>(`/api/v1/imports?${params.toString()}`);
}

export function getImportJob(jobId: string): Promise<ImportJob> {
  return get<ImportJob>(`/api/v1/imports/${encodeURIComponent(jobId)}`);
}

export function cancelImportJob(jobId: string): Promise<ImportJob> {
  return del<ImportJob>(`/api/v1/imports/${encodeURIComponent(jobId)}`);
}

/**
 * Submit an import job.
 */
export async function submitImport(
  request: ImportSubmitRequest,
): Promise<ImportSubmitResponse> {
  const job = await createImportJob({
    project_id: request.project_id,
    source_url: request.url || '',
    name: request.name,
    crawl_options: request.crawl_options,
  });
  return {
    task_id: job.id,
    status: job.status === 'running' ? 'processing' : job.status === 'queued' ? 'pending' : job.status,
    import_type: detectImportType(job.source_url),
    path: job.result_path || undefined,
  };
}

/**
 * Legacy function name kept for non-job-aware callers. It now uses the
 * first-class Import service instead of the old Ingest compatibility route.
 */
export async function submitImportViaIngest(
  request: ImportSubmitRequest,
): Promise<ImportSubmitResponse> {
  return submitImport(request);
}

/**
 * Import from URL — returns the durable job ID.
 */
export async function importFromUrl(
  projectId: string,
  url: string,
  options?: { name?: string; crawlOptions?: CrawlOptions }
): Promise<string> {
  const job = await createImportJob({
    project_id: projectId,
    source_url: url,
    name: options?.name,
    crawl_options: options?.crawlOptions,
  });
  return job.id;
}

/**
 * Detect import type from URL (client-side).
 */
export function detectImportType(url: string): ImportType {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('github.com')) return 'github';
  if (urlLower.includes('notion.so') || urlLower.includes('notion.site')) return 'notion';
  if (urlLower.includes('airtable.com')) return 'airtable';
  if (urlLower.includes('docs.google.com/spreadsheets')) return 'google_sheets';
  if (urlLower.includes('docs.google.com/document')) return 'google_docs';
  if (urlLower.includes('drive.google.com')) return 'google_drive';
  if (urlLower.includes('calendar.google.com')) return 'google_calendar';
  if (urlLower.includes('mail.google.com') || urlLower.includes('gmail.com')) return 'gmail';
  if (urlLower.includes('linear.app')) return 'linear';
  return 'web_page';
}

export function supportsCrawlOptions(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
  } catch {
    return false;
  }

  return detectImportType(trimmed) === 'web_page';
}

// === Backward-compatible helpers ===

export async function pollImportTask(
  taskId: string,
  onProgress?: (task: ImportTaskResponse) => void,
): Promise<ImportTaskResponse> {
  const poll = async (): Promise<ImportTaskResponse> => {
    const task = await getImportTask(taskId);
    onProgress?.(task);
    if (isTerminalStatus(task.status)) return task;
    await new Promise(resolve => setTimeout(resolve, 2500));
    return poll();
  };
  return poll();
}

export async function getImportTask(taskId: string): Promise<ImportTaskResponse> {
  const job = await getImportJob(taskId);
  return {
    task_id: job.id,
    source_type: job.provider === 'url' ? 'url' : 'saas',
    ingest_type: detectImportType(job.source_url),
    status: job.status === 'queued'
      ? 'pending'
      : job.status === 'running'
        ? 'processing'
        : job.status,
    progress: job.progress,
    message: job.message || undefined,
    content_path: job.result_path || undefined,
    path: job.result_path || undefined,
    error: job.error_message || undefined,
    created_at: job.created_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at || undefined,
  };
}

export async function cancelImportTask(taskId: string): Promise<void> {
  await cancelImportJob(taskId);
}

export async function listImportTasks(): Promise<ImportTaskResponse[]> {
  return [];
}
