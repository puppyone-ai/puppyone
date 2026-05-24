/**
 * Import API - SaaS/URL imports via Bootstrap + SyncEngine
 *
 * The backend now processes imports synchronously through the unified
 * SyncEngine pipeline. No polling needed — submit returns completed status.
 */

import { getAccessToken } from './apiClient';

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

/**
 * Submit an import (synchronous — returns completed result directly).
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
  if (request.url && request.crawl_options && supportsCrawlOptions(request.url)) {
    formData.append('crawl_options', JSON.stringify(request.crawl_options));
  }

  const response = await fetch('/api/ingest?path=submit/saas', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Import failed: ${errorText}`);
  }

  const data = await response.json();
  const item = data.items?.[0];
  return {
    task_id: item?.task_id || '',
    status: item?.status || 'completed',
    import_type: item?.ingest_type || 'url',
    path: item?.path,
  };
}

/**
 * Import from URL — returns the created path.
 */
export async function importFromUrl(
  projectId: string,
  url: string,
  options?: { name?: string; crawlOptions?: CrawlOptions }
): Promise<string> {
  const response = await submitImport({
    project_id: projectId,
    url,
    name: options?.name,
    crawl_options: options?.crawlOptions,
  });
  return response.path || response.task_id;
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

// === Deprecated stubs (kept for compatibility during migration) ===

/** @deprecated Import is now synchronous, no polling needed. */
export async function pollImportTask(
  taskId: string,
  onProgress?: (task: ImportTaskResponse) => void,
): Promise<ImportTaskResponse> {
  const result: ImportTaskResponse = {
    task_id: taskId,
    source_type: 'saas',
    ingest_type: 'url',
    status: 'completed',
    progress: 100,
  };
  onProgress?.(result);
  return result;
}

/** @deprecated Use submitImport directly. */
export async function getImportTask(taskId: string): Promise<ImportTaskResponse> {
  return {
    task_id: taskId,
    source_type: 'saas',
    ingest_type: 'url',
    status: 'completed',
    progress: 100,
  };
}

/** @deprecated No longer supported. */
export async function cancelImportTask(_taskId: string): Promise<void> {}

/** @deprecated No longer supported. */
export async function listImportTasks(): Promise<ImportTaskResponse[]> {
  return [];
}
