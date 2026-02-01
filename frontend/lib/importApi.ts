/**
 * Import API Client (Unified)
 *
 * New unified API for all imports - replaces syncApi.ts and connectApi.ts
 * Backend: /api/v1/import/*
 */

import { apiRequest } from './apiClient';

// === Enums ===

export type ImportType =
  | 'github'
  | 'notion'
  | 'airtable'
  | 'google_sheets'
  | 'linear'
  | 'url'
  | 'file';

export type ImportStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

// === Request Types ===

export interface ImportSubmitRequest {
  project_id: string;
  name?: string;
  url?: string; // SaaS URL (GitHub, Notion, etc.) or generic URL
  file_key?: string; // S3 key for uploaded file (ETL)
  etl_rule_id?: number; // ETL rule ID for file processing
  crawl_options?: CrawlOptions;
  sync_config?: Record<string, unknown>; // OAuth import config (labels, time range, etc.)
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

export interface ImportParseRequest {
  url: string;
  crawl_options?: CrawlOptions;
}

// === Response Types ===

export interface ImportSubmitResponse {
  task_id: string;
  status: ImportStatus;
  import_type: ImportType;
}

export interface ImportTaskResponse {
  task_id: string;
  status: ImportStatus;
  import_type: ImportType;
  progress: number;
  message: string | null;
  content_node_id: string | null;
  items_count: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ImportParseResponse {
  url: string;
  import_type: ImportType;
  title: string | null;
  description: string | null;
  fields: Array<{ name: string; type: string }>;
  sample_data: Record<string, any>[];
  total_items: number;
}

// === Utility Functions ===

/**
 * Check if status is terminal (completed, failed, or cancelled)
 */
export function isTerminalStatus(status: ImportStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Get display info for import status
 */
export function getStatusInfo(status: ImportStatus): {
  label: string;
  color: string;
  bgColor: string;
} {
  switch (status) {
    case 'pending':
      return { label: 'Pending', color: 'text-gray-500', bgColor: 'bg-gray-100' };
    case 'processing':
      return { label: 'Processing', color: 'text-blue-600', bgColor: 'bg-blue-100' };
    case 'completed':
      return { label: 'Completed', color: 'text-green-600', bgColor: 'bg-green-100' };
    case 'failed':
      return { label: 'Failed', color: 'text-red-600', bgColor: 'bg-red-100' };
    case 'cancelled':
      return { label: 'Cancelled', color: 'text-gray-500', bgColor: 'bg-gray-100' };
    default:
      return { label: status, color: 'text-gray-500', bgColor: 'bg-gray-100' };
  }
}

/**
 * Get display info for import type
 */
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
    case 'linear':
      return { label: 'Linear', icon: '📐' };
    case 'url':
      return { label: 'Website', icon: '🌐' };
    case 'file':
      return { label: 'File', icon: '📄' };
    default:
      return { label: importType, icon: '📦' };
  }
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// === API Functions ===

/**
 * Submit an import task
 *
 * @param request Import request with URL or file_key
 * @returns Task ID and initial status
 */
export async function submitImport(
  request: ImportSubmitRequest
): Promise<ImportSubmitResponse> {
  return apiRequest<ImportSubmitResponse>('/api/v1/import/submit', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * Get import task status
 *
 * @param taskId Task ID returned from submitImport
 * @returns Current task status and progress
 */
export async function getImportTask(taskId: string): Promise<ImportTaskResponse> {
  return apiRequest<ImportTaskResponse>(`/api/v1/import/tasks/${taskId}`);
}

/**
 * List import tasks for current user
 *
 * @param projectId Optional project ID filter
 * @param limit Max number of tasks to return
 * @returns List of import tasks
 */
export async function listImportTasks(
  projectId?: string,
  limit: number = 50
): Promise<ImportTaskResponse[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (projectId) {
    params.set('project_id', projectId);
  }
  return apiRequest<ImportTaskResponse[]>(`/api/v1/import/tasks?${params}`);
}

/**
 * Cancel an import task
 *
 * @param taskId Task ID to cancel
 */
export async function cancelImportTask(taskId: string): Promise<void> {
  await apiRequest(`/api/v1/import/tasks/${taskId}`, {
    method: 'DELETE',
  });
}

/**
 * Parse URL for preview (without importing)
 *
 * @param url URL to parse
 * @param crawlOptions Optional crawl options
 * @returns Preview information
 */
export async function parseImportUrl(
  url: string,
  crawlOptions?: CrawlOptions
): Promise<ImportParseResponse> {
  return apiRequest<ImportParseResponse>('/api/v1/import/parse', {
    method: 'POST',
    body: JSON.stringify({ url, crawl_options: crawlOptions }),
  });
}

// === Polling Helper ===

/**
 * Poll import task until completion
 *
 * @param taskId Task ID to poll
 * @param onProgress Callback for progress updates
 * @param intervalMs Polling interval in milliseconds (default: 1000)
 * @returns Final task response
 */
export async function pollImportTask(
  taskId: string,
  onProgress?: (task: ImportTaskResponse) => void,
  intervalMs: number = 1000
): Promise<ImportTaskResponse> {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const task = await getImportTask(taskId);
        onProgress?.(task);

        if (isTerminalStatus(task.status)) {
          if (task.status === 'completed') {
            resolve(task);
          } else if (task.status === 'failed') {
            reject(new Error(task.error || 'Import failed'));
          } else {
            resolve(task); // cancelled
          }
        } else {
          setTimeout(poll, intervalMs);
        }
      } catch (error) {
        reject(error);
      }
    };

    poll();
  });
}

// === Convenience Functions ===

/**
 * Import from URL (SaaS or generic)
 * Submits task and returns task ID
 */
export async function importFromUrl(
  projectId: string,
  url: string,
  options?: {
    name?: string;
    crawlOptions?: CrawlOptions;
  }
): Promise<string> {
  const response = await submitImport({
    project_id: projectId,
    url,
    name: options?.name,
    crawl_options: options?.crawlOptions,
  });
  return response.task_id;
}

/**
 * Import from uploaded file (ETL)
 * Submits task and returns task ID
 */
export async function importFromFile(
  projectId: string,
  fileKey: string,
  options?: {
    name?: string;
    etlRuleId?: number;
  }
): Promise<string> {
  const response = await submitImport({
    project_id: projectId,
    file_key: fileKey,
    name: options?.name,
    etl_rule_id: options?.etlRuleId,
  });
  return response.task_id;
}

