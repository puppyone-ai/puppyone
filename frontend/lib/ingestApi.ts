/**
 * Ingest API Client (Unified)
 *
 * Single entry point for all data ingestion:
 * - File upload → File Worker (OCR, extraction)
 * - SaaS sync → SaaS Worker (GitHub, Notion, Gmail, etc.)
 * - URL crawl → SaaS Worker (Firecrawl)
 *
 * Backend: /api/v1/ingest/*
 */

import { apiRequest, getAccessToken } from './apiClient';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090';

// === Enums ===

export type SourceType = 'file' | 'saas' | 'url';

export type IngestType =
  | 'pdf'
  | 'image'
  | 'document'
  | 'text'
  | 'github'
  | 'notion'
  | 'gmail'
  | 'google_drive'
  | 'google_sheets'
  | 'google_docs'
  | 'google_calendar'
  | 'airtable'
  | 'linear'
  | 'web_page';

export type IngestStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type IngestMode = 'smart' | 'raw' | 'structured';

// === Request/Response Types ===

export interface IngestSubmitItem {
  task_id: string;
  source_type: SourceType;
  ingest_type: IngestType;
  status: IngestStatus;
  filename?: string;
  s3_key?: string;
  error?: string;
}

export interface IngestSubmitResponse {
  items: IngestSubmitItem[];
  total: number;
}

export interface IngestTaskResponse {
  task_id: string;
  source_type: SourceType;
  ingest_type: IngestType;
  status: IngestStatus;
  progress: number;
  message?: string;
  content_node_id?: string;
  items_count?: number;
  error?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  filename?: string;
}

export interface BatchTaskQuery {
  task_id: string;
  source_type: SourceType;
}

export interface BatchTaskResponse {
  tasks: IngestTaskResponse[];
  total: number;
}

export interface IngestHealthResponse {
  status: string;
  file_worker: {
    queue_size: number;
    task_count: number;
    worker_count: number;
  };
  saas_worker: {
    status: string;
  };
}

// === File Upload Params ===

export interface FileIngestParams {
  projectId: string;
  files: File[];
  mode?: IngestMode;
  ruleId?: number;
  nodeId?: string;
  jsonPath?: string;
}

// === SaaS Import Params ===

export interface SaaSIngestParams {
  projectId: string;
  url: string;
  name?: string;
}

// === Utility Functions ===

/**
 * Check if status is terminal (completed, failed, or cancelled)
 */
export function isTerminalStatus(status: IngestStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Get display info for ingest status
 */
export function getStatusInfo(status: IngestStatus): {
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
 * Get display info for ingest type
 */
export function getIngestTypeInfo(ingestType: IngestType): {
  label: string;
  icon: string;
} {
  switch (ingestType) {
    case 'pdf':
      return { label: 'PDF', icon: '📄' };
    case 'image':
      return { label: 'Image', icon: '🖼️' };
    case 'document':
      return { label: 'Document', icon: '📝' };
    case 'text':
      return { label: 'Text', icon: '📃' };
    case 'github':
      return { label: 'GitHub', icon: '🐙' };
    case 'notion':
      return { label: 'Notion', icon: '📝' };
    case 'gmail':
      return { label: 'Gmail', icon: '📧' };
    case 'google_drive':
      return { label: 'Google Drive', icon: '📁' };
    case 'google_sheets':
      return { label: 'Google Sheets', icon: '📗' };
    case 'google_docs':
      return { label: 'Google Docs', icon: '📘' };
    case 'google_calendar':
      return { label: 'Google Calendar', icon: '📅' };
    case 'airtable':
      return { label: 'Airtable', icon: '📊' };
    case 'linear':
      return { label: 'Linear', icon: '📐' };
    case 'web_page':
      return { label: 'Web Page', icon: '🌐' };
    default:
      return { label: ingestType, icon: '📦' };
  }
}

/**
 * Get status display text
 */
export function getStatusDisplayText(status: IngestStatus | 'uploading'): string {
  switch (status) {
    case 'uploading':
      return 'Uploading...';
    case 'pending':
      return 'Pending';
    case 'processing':
      return 'Processing...';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Unknown Status';
  }
}

// === API Functions ===

/**
 * Get ingest service health status
 */
export async function getIngestHealth(): Promise<IngestHealthResponse> {
  return apiRequest<IngestHealthResponse>('/api/v1/ingest/health');
}

/**
 * Submit file ingest task
 */
export async function submitFileIngest(
  params: FileIngestParams
): Promise<IngestSubmitResponse> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  const formData = new FormData();
  formData.append('project_id', params.projectId);

  if (params.mode) {
    formData.append('mode', params.mode);
  }
  if (params.ruleId !== undefined) {
    formData.append('rule_id', params.ruleId.toString());
  }
  if (params.nodeId !== undefined) {
    formData.append('node_id', params.nodeId);
  }
  if (params.jsonPath !== undefined) {
    formData.append('json_path', params.jsonPath);
  }

  for (const file of params.files) {
    formData.append('files', file);
  }

  const response = await fetch(`${API_URL}/api/v1/ingest/submit/file`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`File upload failed: ${errorText}`);
  }

  return await response.json();
}

/**
 * Submit SaaS/URL ingest task
 */
export async function submitSaaSIngest(
  params: SaaSIngestParams
): Promise<IngestSubmitResponse> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error('Not authenticated');
  }

  const formData = new FormData();
  formData.append('project_id', params.projectId);
  formData.append('url', params.url);
  if (params.name) {
    formData.append('name', params.name);
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
    throw new Error(`SaaS import failed: ${errorText}`);
  }

  return await response.json();
}

/**
 * Get ingest task status
 */
export async function getIngestTask(
  taskId: string,
  sourceType: SourceType
): Promise<IngestTaskResponse> {
  return apiRequest<IngestTaskResponse>(
    `/api/v1/ingest/tasks/${taskId}?source_type=${sourceType}`
  );
}

/**
 * Batch query ingest task statuses
 */
export async function batchGetIngestTasks(
  tasks: BatchTaskQuery[]
): Promise<BatchTaskResponse> {
  return apiRequest<BatchTaskResponse>('/api/v1/ingest/tasks/batch', {
    method: 'POST',
    body: JSON.stringify({ tasks }),
  });
}

/**
 * Cancel an ingest task
 */
export async function cancelIngestTask(
  taskId: string,
  sourceType: SourceType
): Promise<void> {
  await apiRequest(`/api/v1/ingest/tasks/${taskId}?source_type=${sourceType}`, {
    method: 'DELETE',
  });
}

// === Polling Helper ===

/**
 * Poll ingest task until completion
 */
export async function pollIngestTask(
  taskId: string,
  sourceType: SourceType,
  onProgress?: (task: IngestTaskResponse) => void,
  intervalMs: number = 1000
): Promise<IngestTaskResponse> {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const task = await getIngestTask(taskId, sourceType);
        onProgress?.(task);

        if (isTerminalStatus(task.status)) {
          if (task.status === 'completed') {
            resolve(task);
          } else if (task.status === 'failed') {
            reject(new Error(task.error || 'Ingest failed'));
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

// === Legacy Compatibility (maps to old API) ===

// For backward compatibility with etlApi.ts consumers
export type ETLStatus = IngestStatus;
export type ETLTaskStatus = IngestTaskResponse;
export type UploadAndSubmitResponse = IngestSubmitResponse;
export type UploadAndSubmitItem = IngestSubmitItem;
export type ETLHealthResponse = IngestHealthResponse;

export const getETLHealth = getIngestHealth;
export const uploadAndSubmit = async (
  params: FileIngestParams & { accessToken?: string }
): Promise<IngestSubmitResponse> => {
  return submitFileIngest(params);
};

