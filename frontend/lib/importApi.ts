/**
 * Import API - Now forwards to unified Ingest API
 *
 * This file is kept for backward compatibility.
 * All new code should use ingestApi.ts directly.
 */

import { getAccessToken } from './apiClient';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// === Enums ===

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

// === Request Types ===

export interface ImportSubmitRequest {
  project_id: string;
  name?: string;
  url?: string;
  file_key?: string;
  etl_rule_id?: number;
  crawl_options?: CrawlOptions;
  sync_config?: Record<string, unknown>;
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
  source_type: 'saas' | 'url';
  ingest_type: ImportType;
  status: ImportStatus;
  progress: number;
  message?: string;
  content_node_id?: string;
  items_count?: number;
  error?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface ImportParseResponse {
  url: string;
  import_type: ImportType;
  title?: string;
  description?: string;
  fields: Array<{ name: string; type: string }>;
  sample_data: Record<string, any>[];
  total_items: number;
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

/**
 * Submit an import task (via unified ingest endpoint)
 */
export async function submitImport(
  request: ImportSubmitRequest
): Promise<ImportSubmitResponse> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  const formData = new FormData();
  formData.append('project_id', request.project_id);
  if (request.url) {
    formData.append('url', request.url);
  }
  if (request.name) {
    formData.append('name', request.name);
  }

  const response = await fetch(`${API_URL}/api/v1/ingest/submit/saas`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Import submit failed: ${errorText}`);
  }

  const data = await response.json();
  // Convert unified response to legacy format
  const item = data.items?.[0];
  return {
    task_id: item?.task_id || data.task_id,
    status: item?.status || 'pending',
    import_type: item?.ingest_type || 'url',
  };
}

/**
 * Get import task status (via unified ingest endpoint)
 */
export async function getImportTask(taskId: string): Promise<ImportTaskResponse> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${API_URL}/api/v1/ingest/tasks/${taskId}?source_type=saas`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Get task failed: ${errorText}`);
  }

  return await response.json();
}

/**
 * List import tasks (not directly supported by new API)
 * @deprecated Use batchGetIngestTasks with specific task IDs
 */
export async function listImportTasks(
  projectId?: string,
  limit: number = 50
): Promise<ImportTaskResponse[]> {
  // This endpoint is not directly supported in the new unified API
  // For now, return empty array - callers should migrate to task-specific queries
  console.warn('listImportTasks is deprecated - use specific task queries');
  return [];
}

/**
 * Cancel an import task (via unified ingest endpoint)
 */
export async function cancelImportTask(taskId: string): Promise<void> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${API_URL}/api/v1/ingest/tasks/${taskId}?source_type=saas`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cancel task failed: ${errorText}`);
  }
}

/**
 * Parse URL for preview
 * Note: This endpoint may need to be added to the unified API
 */
export async function parseImportUrl(
  url: string,
  crawlOptions?: CrawlOptions
): Promise<ImportParseResponse> {
  // For now, return a stub response - actual implementation depends on backend
  console.warn('parseImportUrl may need backend implementation');
  return {
    url,
    import_type: detectImportType(url),
    title: undefined,
    description: undefined,
    fields: [],
    sample_data: [],
    total_items: 0,
  };
}

/**
 * Detect import type from URL
 */
function detectImportType(url: string): ImportType {
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

// === Polling Helper ===

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
