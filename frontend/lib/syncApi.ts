/**
 * Sync Task API Client
 * 
 * API client for managing sync tasks (GitHub, Notion, etc. imports)
 */

import { apiRequest } from './apiClient';

// Task status enum
export type SyncTaskStatus = 
  | 'pending'
  | 'downloading'
  | 'extracting'
  | 'uploading'
  | 'creating_nodes'
  | 'completed'
  | 'failed'
  | 'cancelled';

// Task type enum
export type SyncTaskType =
  | 'github_repo'
  | 'notion_database'
  | 'notion_page'
  | 'airtable_base'
  | 'google_sheet'
  | 'linear_project';

// Full task response
export interface SyncTask {
  id: number;
  user_id: string;
  project_id: string;
  task_type: SyncTaskType;
  source_url: string;
  status: SyncTaskStatus;
  progress: number;
  progress_message: string | null;
  root_node_id: string | null;
  files_total: number;
  files_processed: number;
  bytes_total: number;
  bytes_downloaded: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// Lightweight status response for polling
export interface SyncTaskStatusResponse {
  id: number;
  status: SyncTaskStatus;
  progress: number;
  progress_message: string | null;
  root_node_id: string | null;
  files_total: number;
  files_processed: number;
  bytes_total: number;
  bytes_downloaded: number;
  error: string | null;
  is_terminal: boolean;
}

// Start import request
export interface StartSyncRequest {
  url: string;
  project_id: string;
  task_type?: SyncTaskType;
}

// Check if status is terminal
export function isTerminalStatus(status: SyncTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Start a new sync import task
 */
export async function startSyncImport(request: StartSyncRequest): Promise<SyncTask> {
  return apiRequest<SyncTask>(`/api/v1/sync/import`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * Get full task details
 */
export async function getSyncTask(taskId: number): Promise<SyncTask> {
  return apiRequest<SyncTask>(`/api/v1/sync/task/${taskId}`);
}

/**
 * Get lightweight task status (for polling)
 */
export async function getSyncTaskStatus(taskId: number): Promise<SyncTaskStatusResponse> {
  return apiRequest<SyncTaskStatusResponse>(`/api/v1/sync/task/${taskId}/status`);
}

/**
 * Get status for multiple tasks at once
 */
export async function getBatchSyncStatus(
  taskIds: number[]
): Promise<Record<number, SyncTaskStatusResponse>> {
  const response = await apiRequest<{ tasks: Record<number, SyncTaskStatusResponse> }>(
    `/api/v1/sync/task/batch-status`,
    {
      method: 'POST',
      body: JSON.stringify({ task_ids: taskIds }),
    }
  );
  return response.tasks;
}

/**
 * List all tasks for the current user
 */
export async function listSyncTasks(
  includeCompleted: boolean = true,
  limit: number = 50
): Promise<SyncTask[]> {
  const params = new URLSearchParams({
    include_completed: String(includeCompleted),
    limit: String(limit),
  });
  return apiRequest<SyncTask[]>(`/api/v1/sync/tasks?${params}`);
}

/**
 * List active (non-terminal) tasks
 */
export async function listActiveSyncTasks(): Promise<SyncTaskStatusResponse[]> {
  return apiRequest<SyncTaskStatusResponse[]>(`/api/v1/sync/tasks/active`);
}

/**
 * Cancel a sync task
 */
export async function cancelSyncTask(taskId: number): Promise<void> {
  await apiRequest(`/api/v1/sync/task/${taskId}`, {
    method: 'DELETE',
  });
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

/**
 * Get status display info
 */
export function getStatusInfo(status: SyncTaskStatus): {
  label: string;
  color: string;
  bgColor: string;
} {
  switch (status) {
    case 'pending':
      return { label: 'Pending', color: 'text-gray-500', bgColor: 'bg-gray-100' };
    case 'downloading':
      return { label: 'Downloading', color: 'text-blue-600', bgColor: 'bg-blue-100' };
    case 'extracting':
      return { label: 'Extracting', color: 'text-purple-600', bgColor: 'bg-purple-100' };
    case 'uploading':
      return { label: 'Uploading', color: 'text-orange-600', bgColor: 'bg-orange-100' };
    case 'creating_nodes':
      return { label: 'Creating files', color: 'text-teal-600', bgColor: 'bg-teal-100' };
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

