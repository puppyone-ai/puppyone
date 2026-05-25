/**
 * ETL API - Now forwards to unified Ingest API
 *
 * This file is kept for backward compatibility.
 * All new code should use ingestApi.ts directly.
 */

import { getAccessToken } from './apiClient';

// ============= Types =============

export type ETLStatus =
  | 'pending'
  | 'processing'  // Unified status (replaces mineru_parsing, llm_processing)
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ETLTaskStatus {
  task_id: string;
  source_type: 'file';
  ingest_type: string;
  status: ETLStatus;
  progress: number;
  message?: string;
  content_path?: string;
  error?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  filename?: string;
  // Legacy fields (for compatibility)
  user_id?: string;
  project_id?: string;
  rule_id?: string;
  result?: {
    output_path?: string;
    output_size?: number;
    processing_time?: number;
  };
  metadata?: Record<string, any>;
}

export interface BatchETLTaskStatusResponse {
  tasks: ETLTaskStatus[];
  total: number;
}

export interface UploadAndSubmitItem {
  task_id: string;
  source_type: 'file';
  ingest_type: string;
  status: ETLStatus;
  filename?: string;
  s3_key?: string;
  error?: string;
}

export interface UploadAndSubmitResponse {
  items: UploadAndSubmitItem[];
  total: number;
}

export interface UploadAndSubmitParams {
  projectId: number | string;
  files: File[];
  ruleId?: number;
  path?: string;
  jsonPath?: string;
  /** Parent folder path in the MUT tree */
  parentPath?: string;
  /** Parent node ID for organizing uploaded files */
  parentId?: string;
  /** Processing mode: 'ocr_parse' (Smart Parse) or 'raw' (Raw Storage) */
  mode?: 'ocr_parse' | 'raw';
  /**
   * Upload progress callback. `loaded` and `total` are bytes;
   * `percent` is `0..100` rounded. Fired on the underlying
   * `XMLHttpRequest.upload`'s `progress` event, so it tracks the
   * client-side outbound transfer (not server-side processing).
   * Per-file progress is not available because the whole batch
   * goes in one multipart POST — every placeholder in a batch
   * shares the same percent.
   */
  onProgress?: (loaded: number, total: number, percent: number) => void;
  /**
   * Optional AbortSignal. Aborting it kills the in-flight XHR;
   * the returned promise rejects with a "cancelled" error so
   * callers can mark their placeholders as cancelled vs. failed.
   */
  signal?: AbortSignal;
}

export interface ETLHealthResponse {
  status: string;
  file_worker: {
    queue_size: number;
    task_count: number;
    worker_count: number;
  };
}

// ============= Helper Functions =============

export function isTerminalStatus(status: ETLStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function getStatusDisplayText(status: ETLStatus | 'uploading'): string {
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

// ============= API Functions =============

/**
 * Get ETL Service Health (via unified ingest endpoint)
 */
export async function getETLHealth(): Promise<ETLHealthResponse> {
  const accessToken = await getAccessToken();
  
  const response = await fetch('/api/ingest?path=health', {
    method: 'GET',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  if (!response.ok) {
    throw new Error('Failed to check ETL health');
  }

  return await response.json();
}

/**
 * Upload and submit file ingest task (via Next.js proxy → backend ingest endpoint).
 *
 * The request is routed through /api/ingest (same-origin) to avoid CORS and
 * system-proxy issues that can break cross-origin multipart uploads.
 */
export async function uploadAndSubmit(
  params: UploadAndSubmitParams,
  accessToken?: string
): Promise<UploadAndSubmitResponse> {
  const token = accessToken || (await getAccessToken());
  if (!token) {
    throw new Error('Not authenticated');
  }

  const formData = new FormData();
  formData.append('project_id', params.projectId.toString());

  if (params.ruleId !== undefined) {
    formData.append('rule_id', params.ruleId.toString());
  }
  if (params.path !== undefined) {
    formData.append('path', params.path);
  }
  if (params.jsonPath !== undefined) {
    formData.append('json_path', params.jsonPath);
  }
  const parentPath = params.parentPath ?? params.parentId ?? params.path;
  if (parentPath !== undefined) {
    formData.append('parent_path', parentPath);
  }
  if (params.mode) {
    formData.append('mode', params.mode);
  }

  for (const file of params.files) {
    formData.append('files', file);
  }

  // Route through same-origin Next.js proxy to avoid CORS / system-proxy issues
  const response = await fetch('/api/ingest?path=submit/file', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload and submit failed: ${errorText}`);
  }

  return await response.json();
}

/**
 * Batch query ETL task status (via unified ingest endpoint)
 */
export async function batchGetETLTaskStatus(
  taskIds: string[],
  accessToken?: string
): Promise<BatchETLTaskStatusResponse> {
  const token = accessToken || (await getAccessToken());
  if (!token) {
    throw new Error('Not authenticated');
  }

  const tasks = taskIds.map((task_id) => ({ task_id, source_type: 'file' }));

  const response = await fetch('/api/ingest?path=tasks/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tasks }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Batch query failed: ${errorText}`);
  }

  return await response.json();
}

/**
 * Get single ETL task status (via unified ingest endpoint)
 */
export async function getETLTaskStatus(
  taskId: string,
  accessToken?: string
): Promise<ETLTaskStatus> {
  const token = accessToken || (await getAccessToken());
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`/api/ingest?path=tasks/${taskId}&source_type=file`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Get task failed: ${errorText}`);
  }

  return await response.json();
}

/**
 * Cancel an in-flight ETL task.
 *
 * Backend currently only supports cancellation for `source_type=file`
 * (see `backend/src/ingest/service.py::cancel_task`). SaaS tasks
 * (notion / github / gmail / …) silently no-op server-side, so callers
 * that want a cancel-or-dismiss UX should fall back to local removal
 * via `removeTaskById` when this returns `false`.
 */
export async function cancelETLTask(
  taskId: string,
  sourceType: 'file' | string = 'file',
  accessToken?: string,
): Promise<boolean> {
  const token = accessToken || (await getAccessToken());
  if (!token) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(
    `/api/ingest?path=tasks/${taskId}&source_type=${sourceType}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (response.status === 404) {
    // Task already terminal / unknown — treat as "nothing to cancel"
    return false;
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cancel task failed: ${errorText}`);
  }
  return true;
}
