/**
 * ETL API 调用封装
 */

export interface ETLTaskStatus {
  task_id: number
  user_id: string
  project_id: number
  filename: string
  rule_id: number
  status: 'pending' | 'mineru_parsing' | 'llm_processing' | 'completed' | 'failed'
  progress: number
  created_at: string
  updated_at: string
  result?: {
    output_path: string
    output_size: number
    processing_time: number
    mineru_task_id?: string
  }
  error?: string
  metadata: Record<string, any>
}

export interface BatchETLTaskStatusResponse {
  tasks: ETLTaskStatus[]
  total: number
}

/**
 * 批量查询 ETL 任务状态
 */
export async function batchGetETLTaskStatus(
  taskIds: number[],
  accessToken: string
): Promise<BatchETLTaskStatusResponse> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/etl/tasks/batch?task_ids=${taskIds.join(',')}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch ETL task status: ${response.statusText}`)
  }

  return await response.json()
}

