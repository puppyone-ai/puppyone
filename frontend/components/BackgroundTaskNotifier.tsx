'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../app/supabase/SupabaseAuthProvider';
import { batchGetETLTaskStatus, isTerminalStatus } from '../lib/etlApi';
import { getImportTask, isTerminalStatus as isImportTerminalStatus } from '../lib/importApi';

// 使用 sessionStorage，刷新后自动清空
const STORAGE_KEY = 'etl_pending_tasks';

/** 检查是否为占位任务 ID（placeholder-前缀 或 负数） */
function isPlaceholderTaskId(taskId: string): boolean {
  return taskId.startsWith('placeholder-') || Number(taskId) < 0;
}

/**
 * 任务类型
 */
export type TaskType = 'file' | 'notion' | 'github' | 'airtable' | 'google_sheets' | 'linear';

/**
 * 任务记录（存储在 sessionStorage 中，刷新即消失）
 */
export interface PendingTask {
  taskId: string;
  projectId: string;
  tableId?: string;
  tableName?: string;
  filename: string;
  timestamp: number;
  taskType?: TaskType; // 任务类型：文件上传 or SaaS 导入
  status?:
    | 'pending'
    | 'mineru_parsing'
    | 'llm_processing'
    | 'completed'
    | 'failed'
    | 'cancelled'
    // SaaS 导入状态
    | 'downloading'
    | 'extracting'
    | 'uploading'
    | 'creating_nodes';
}

/**
 * BackgroundTaskNotifier - 唯一的任务状态轮询器
 *
 * - 使用 sessionStorage（刷新后清空）
 * - 只在有非终态任务时轮询
 * - 所有任务终态后停止轮询
 */
export function BackgroundTaskNotifier() {
  const { session } = useAuth();
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([]);

  // 调试用：全局清理函数
  useEffect(() => {
    (window as any).clearETLTasks = () => {
      sessionStorage.removeItem(STORAGE_KEY);
      setPendingTasks([]);
      window.dispatchEvent(new CustomEvent('etl-tasks-updated'));
      console.log('✅ Cleared all ETL tasks');
    };
    return () => {
      delete (window as any).clearETLTasks;
    };
  }, []);

  // 从 sessionStorage 加载任务
  const loadPendingTasks = useCallback(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const tasks = JSON.parse(stored) as PendingTask[];
        setPendingTasks(tasks);
      } else {
        setPendingTasks([]);
      }
    } catch (error) {
      console.error('Failed to load pending tasks:', error);
      setPendingTasks([]);
    }
  }, []);

  // 检查是否有非终态任务需要轮询
  const hasActiveTasksToPool = useCallback(() => {
    // 只有真实 ID 且非终态的任务才需要轮询
    return pendingTasks.some(t => {
      if (isPlaceholderTaskId(t.taskId)) return false; // 占位任务不轮询
      const isTerminal =
        t.status === 'completed' ||
        t.status === 'failed' ||
        t.status === 'cancelled';
      return !isTerminal;
    });
  }, [pendingTasks]);

  // 检查任务状态（同时支持 ETL 和 SaaS 任务）
  const checkTaskStatus = useCallback(async () => {
    if (!session?.access_token || pendingTasks.length === 0) return;

    // 分离 ETL 任务和 SaaS 任务
    const etlTasks = pendingTasks.filter(t => {
      if (isPlaceholderTaskId(t.taskId)) return false;
      if (t.taskType && t.taskType !== 'file') return false; // SaaS 任务
      const isTerminal =
        t.status === 'completed' ||
        t.status === 'failed' ||
        t.status === 'cancelled';
      return !isTerminal;
    });

    const saasTasks = pendingTasks.filter(t => {
      if (isPlaceholderTaskId(t.taskId)) return false;
      if (!t.taskType || t.taskType === 'file') return false; // ETL 任务
      const isTerminal =
        t.status === 'completed' ||
        t.status === 'failed' ||
        t.status === 'cancelled';
      return !isTerminal;
    });

    if (etlTasks.length === 0 && saasTasks.length === 0) return;

    let hasChanges = false;
    let updatedTasks = [...pendingTasks];

    // 检查 ETL 任务状态
    if (etlTasks.length > 0) {
      try {
        const taskIds = etlTasks.map(t => t.taskId);
        const response = await batchGetETLTaskStatus(
          taskIds,
          session.access_token
        );

        updatedTasks = updatedTasks.map(pendingTask => {
          if (isPlaceholderTaskId(pendingTask.taskId)) return pendingTask;
          if (pendingTask.taskType && pendingTask.taskType !== 'file') return pendingTask;
          const isTerminal =
            pendingTask.status === 'completed' ||
            pendingTask.status === 'failed' ||
            pendingTask.status === 'cancelled';
          if (isTerminal) return pendingTask;

          const task = response.tasks.find(t => t.task_id === pendingTask.taskId);
          if (task && pendingTask.status !== task.status) {
            hasChanges = true;

            if (isTerminalStatus(task.status)) {
              if (task.status === 'completed') {
                window.dispatchEvent(
                  new CustomEvent('etl-task-completed', {
                    detail: {
                      taskId: task.task_id,
                      filename: pendingTask.filename,
                      tableId: pendingTask.tableId,
                    },
                  })
                );
              } else if (task.status === 'failed') {
                window.dispatchEvent(
                  new CustomEvent('etl-task-failed', {
                    detail: {
                      taskId: task.task_id,
                      error: task.error,
                      filename: pendingTask.filename,
                    },
                  })
                );
              }
            }

            return { ...pendingTask, status: task.status };
          }
          return pendingTask;
        });
      } catch (error) {
        console.error('Failed to check ETL task status:', error);
      }
    }

    // 检查 SaaS 任务状态（使用新的 import API）
    for (const saasTask of saasTasks) {
      try {
        const taskResponse = await getImportTask(saasTask.taskId);
        
        // 映射新API状态到本地状态（processing -> downloading）
        const mappedStatus = taskResponse.status === 'processing' ? 'downloading' : taskResponse.status;
        
        updatedTasks = updatedTasks.map(pendingTask => {
          if (pendingTask.taskId !== saasTask.taskId) return pendingTask;
          
          if (pendingTask.status !== mappedStatus) {
            hasChanges = true;

            if (isImportTerminalStatus(taskResponse.status)) {
              if (taskResponse.status === 'completed') {
                window.dispatchEvent(
                  new CustomEvent('saas-task-completed', {
                    detail: {
                      taskId: saasTask.taskId,
                      filename: pendingTask.filename,
                      taskType: pendingTask.taskType,
                      rootNodeId: taskResponse.content_node_id,
                    },
                  })
                );
              } else if (taskResponse.status === 'failed') {
                window.dispatchEvent(
                  new CustomEvent('saas-task-failed', {
                    detail: {
                      taskId: saasTask.taskId,
                      error: taskResponse.error,
                      filename: pendingTask.filename,
                    },
                  })
                );
              }
            }

            return { ...pendingTask, status: mappedStatus as PendingTask['status'] };
          }
          return pendingTask;
        });
      } catch (error) {
        console.error(`Failed to check SaaS task ${saasTask.taskId} status:`, error);
      }
    }

    if (hasChanges) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updatedTasks));
      setPendingTasks(updatedTasks);
      window.dispatchEvent(new CustomEvent('etl-tasks-updated'));
      window.dispatchEvent(new CustomEvent('projects-refresh'));
    }
  }, [session, pendingTasks]);

  // 初始加载和监听事件
  useEffect(() => {
    loadPendingTasks();

    const handleTasksUpdated = () => loadPendingTasks();
    window.addEventListener('etl-tasks-updated', handleTasksUpdated);
    return () =>
      window.removeEventListener('etl-tasks-updated', handleTasksUpdated);
  }, [loadPendingTasks]);

  // 轮询：只在有活跃任务时进行
  useEffect(() => {
    if (!hasActiveTasksToPool()) return;

    checkTaskStatus();
    const interval = setInterval(checkTaskStatus, 3000);
    return () => clearInterval(interval);
  }, [hasActiveTasksToPool, checkTaskStatus]);

  return null;
}

// ============= Helper Functions =============

/** 添加任务 */
export function addPendingTasks(tasks: Omit<PendingTask, 'timestamp'>[]) {
  const existing = JSON.parse(
    sessionStorage.getItem(STORAGE_KEY) || '[]'
  ) as PendingTask[];
  const newTasks = tasks.map(t => ({ ...t, timestamp: Date.now() }));
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([...existing, ...newTasks])
  );
  window.dispatchEvent(new CustomEvent('etl-tasks-updated'));
}

/** 通过 taskId 更新任务状态 */
export function updateTaskStatusById(
  taskId: string,
  status: PendingTask['status']
) {
  const existing = JSON.parse(
    sessionStorage.getItem(STORAGE_KEY) || '[]'
  ) as PendingTask[];
  const updated = existing.map(t =>
    t.taskId === taskId ? { ...t, status } : t
  );
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent('etl-tasks-updated'));
}

/** 通过 taskId 移除任务 */
export function removeTaskById(taskId: string) {
  const existing = JSON.parse(
    sessionStorage.getItem(STORAGE_KEY) || '[]'
  ) as PendingTask[];
  const filtered = existing.filter(t => t.taskId !== taskId);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  window.dispatchEvent(new CustomEvent('etl-tasks-updated'));
}

/** 替换占位任务 */
export function replacePlaceholderTasks(
  tableId: string,
  realTasks: Omit<PendingTask, 'timestamp'>[]
) {
  const existing = JSON.parse(
    sessionStorage.getItem(STORAGE_KEY) || '[]'
  ) as PendingTask[];
  const filtered = existing.filter(
    t => !(t.tableId === tableId && isPlaceholderTaskId(t.taskId))
  );
  const newTasks = realTasks.map(t => ({ ...t, timestamp: Date.now() }));
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([...filtered, ...newTasks])
  );
  window.dispatchEvent(new CustomEvent('etl-tasks-updated'));
}

/** 移除失败文件的占位任务 */
export function removeFailedPlaceholders(tableId: string, filenames: string[]) {
  const existing = JSON.parse(
    sessionStorage.getItem(STORAGE_KEY) || '[]'
  ) as PendingTask[];
  const filtered = existing.filter(
    t =>
      !(t.tableId === tableId && isPlaceholderTaskId(t.taskId) && filenames.includes(t.filename))
  );
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  window.dispatchEvent(new CustomEvent('etl-tasks-updated'));
}

/** 移除 Table 的所有占位任务 */
export function removeAllPlaceholdersForTable(tableId: string) {
  const existing = JSON.parse(
    sessionStorage.getItem(STORAGE_KEY) || '[]'
  ) as PendingTask[];
  const filtered = existing.filter(
    t => !(t.tableId === tableId && isPlaceholderTaskId(t.taskId))
  );
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  window.dispatchEvent(new CustomEvent('etl-tasks-updated'));
}

/** 获取指定 table 的任务 */
export function getPendingFilesForTable(tableId: string): PendingTask[] {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  const tasks = JSON.parse(stored) as PendingTask[];
  return tasks.filter(t => t.tableId === tableId);
}

/** 获取所有任务 */
export function getAllPendingTasks(): PendingTask[] {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  return JSON.parse(stored) as PendingTask[];
}

/** 清空所有任务 */
export function clearAllTasks() {
  sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('etl-tasks-updated'));
}

/** 获取正在处理中的 Table ID 列表 */
export function getProcessingTableIds(): Set<string> {
  const tasks = getAllPendingTasks();
  const tableIds = new Set<string>();

  tasks.forEach(task => {
    const isTerminal =
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'cancelled';
    if (task.tableId && !isTerminal) {
      tableIds.add(task.tableId);
    }
  });

  return tableIds;
}
