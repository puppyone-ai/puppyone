/**
 * ETL API 调用封装
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ============= Types =============

export type ETLStatus =
  | 'pending'
  | 'mineru_parsing'
  | 'llm_processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ETLTaskStatus {
  task_id: string;
  user_id: string;
  project_id: string;
  filename: string;
  rule_id: string;
  status: ETLStatus;
  progress: number;
  created_at: string;
  updated_at: string;
  result?: {
    output_path: string;
    output_size: number;
    processing_time: number;
    mineru_task_id?: string;
  };
  error?: string;
  metadata: Record<string, any>;
}

export interface BatchETLTaskStatusResponse {
  tasks: ETLTaskStatus[];
  total: number;
}

/** upload_and_submit 单个文件的返回结果 */
export interface UploadAndSubmitItem {
  filename: string;
  task_id: number;
  status: ETLStatus;
  s3_key: string | null;
  error: string | null;
}

/** upload_and_submit 响应 */
export interface UploadAndSubmitResponse {
  items: UploadAndSubmitItem[];
  total: number;
}

/** upload_and_submit 请求参数 */
export interface UploadAndSubmitParams {
  projectId: number;
  files: File[];
  ruleId?: number;
  nodeId?: string;  // 改为 nodeId，类型为 UUID 字符串
  jsonPath?: string;
  mode?: 'smart' | 'raw' | 'structured';
}

export interface ETLHealthResponse {
  status: string;
  queue_size: number;
  task_count: number;
  worker_count: number;
}

// ============= Helper Functions =============

/**
 * 判断任务状态是否为终态（不再变化）
 */
export function isTerminalStatus(status: ETLStatus): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  );
}

/**
 * 获取状态的用户友好显示文本
 */
export function getStatusDisplayText(status: ETLStatus | 'uploading'): string {
  switch (status) {
    case 'uploading':
      return 'Uploading...';
    case 'pending':
      return 'Pending';
    case 'mineru_parsing':
      return 'Processing document (OCR)...';
    case 'llm_processing':
      return 'Extracting structured data...';
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
 * Get ETL Service Health
 */
export async function getETLHealth(): Promise<ETLHealthResponse> {
  const response = await fetch(`${API_URL}/api/v1/etl/health`, {
    method: 'GET',
  });
  if (!response.ok) {
    throw new Error('Failed to check ETL health');
  }
  return await response.json();
}

/**
 * 一体化上传并提交 ETL 任务（新接口）
 *
 * 替代旧的 /etl/upload + /projects/.../import-folder 流程
 */
export async function uploadAndSubmit(
  params: UploadAndSubmitParams,
  accessToken: string
): Promise<UploadAndSubmitResponse> {
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

  // 添加所有文件
  for (const file of params.files) {
    formData.append('files', file);
  }

  const response = await fetch(`${API_URL}/api/v1/etl/upload_and_submit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
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
 * 批量查询 ETL 任务状态
 */
export async function batchGetETLTaskStatus(
  taskIds: string[],
  accessToken: string
): Promise<BatchETLTaskStatusResponse> {
  const response = await fetch(
    `${API_URL}/api/v1/etl/tasks/batch?task_ids=${taskIds.join(',')}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch ETL task status: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * 查询单个 ETL 任务状态
 */
export async function getETLTaskStatus(
  taskId: string,
  accessToken: string
): Promise<ETLTaskStatus> {
  const response = await fetch(`${API_URL}/api/v1/etl/tasks/${taskId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ETL task status: ${response.statusText}`);
  }

  return await response.json();
}
