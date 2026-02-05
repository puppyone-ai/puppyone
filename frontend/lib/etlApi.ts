/**
 * ETL API - Now forwards to unified Ingest API
 *
 * This file is kept for backward compatibility.
 * All new code should use ingestApi.ts directly.
 */

import { getAccessToken } from './apiClient';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
  content_node_id?: string;
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
  nodeId?: string;
  jsonPath?: string;
  /** Processing mode: 'ocr_parse' (Smart Parse) or 'raw' (Raw Storage) */
  mode?: 'ocr_parse' | 'raw';
}

export interface ETLHealthResponse {
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
  
  const response = await fetch(`${API_URL}/api/v1/ingest/health`, {
    method: 'GET',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  if (!response.ok) {
    throw new Error('Failed to check ETL health');
  }

  return await response.json();
}

/**
 * Upload and submit file ingest task (via unified ingest endpoint)
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
  if (params.nodeId !== undefined) {
    formData.append('node_id', params.nodeId);
  }
  if (params.jsonPath !== undefined) {
    formData.append('json_path', params.jsonPath);
  }
  if (params.mode) {
    formData.append('mode', params.mode);
  }

  for (const file of params.files) {
    formData.append('files', file);
  }

  const response = await fetch(`${API_URL}/api/v1/ingest/submit/file`, {
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

  const response = await fetch(`${API_URL}/api/v1/ingest/tasks/batch`, {
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

  const response = await fetch(`${API_URL}/api/v1/ingest/tasks/${taskId}?source_type=file`, {
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
