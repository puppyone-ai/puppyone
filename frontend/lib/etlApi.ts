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
  tableId?: number;
  jsonPath?: string;
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
      return '正在上传...';
    case 'pending':
      return '等待处理';
    case 'mineru_parsing':
      return '正在识别文档...';
    case 'llm_processing':
      return '正在提取结构化信息...';
    case 'completed':
      return '已完成';
    case 'failed':
      return '处理失败';
    case 'cancelled':
      return '已取消';
    default:
      return '未知状态';
  }
}

// ============= API Functions =============

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
  if (params.tableId !== undefined) {
    formData.append('table_id', params.tableId.toString());
  }
  if (params.jsonPath !== undefined) {
    formData.append('json_path', params.jsonPath);
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
