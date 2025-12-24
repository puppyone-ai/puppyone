'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'
import { batchGetETLTaskStatus, isTerminalStatus } from '../lib/etlApi'

/**
 * 存储在 localStorage 中的任务记录
 * 
 * 注意：tableId 和 tableName 可能为空，因为新架构下 Worker 会自动创建 Table
 * status 字段由 BackgroundTaskNotifier 定期更新
 */
export interface PendingTask {
  taskId: number
  projectId: string
  tableId?: string       // 可选，如果传入了 table_id 则有值
  tableName?: string     // 可选，用于显示
  filename: string       // 文件名，用于在 Tree 中匹配占位符
  timestamp: number
  status?: 'pending' | 'mineru_parsing' | 'llm_processing' | 'completed' | 'failed' | 'cancelled'  // 任务状态，由 BackgroundTaskNotifier 更新
}

/**
 * BackgroundTaskNotifier - 后台任务状态检查器（无 UI）
 * 
 * 功能：
 * - 定时轮询 localStorage 中的 pending ETL 任务
 * - 检查任务状态并更新 localStorage
 * - 触发事件通知其他组件刷新数据
 * - 支持新的 upload_and_submit 架构
 */
export function BackgroundTaskNotifier() {
  const { session } = useAuth()
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([])

  // 添加全局清理函数用于调试
  useEffect(() => {
    (window as any).clearETLTasks = () => {
      localStorage.removeItem('etl_pending_tasks')
      setPendingTasks([])
      console.log('✅ Cleared all ETL pending tasks')
    }

    return () => {
      delete (window as any).clearETLTasks
    }
  }, [])

  // 从 localStorage 加载待处理任务
  const loadPendingTasks = useCallback(() => {
    try {
      const stored = localStorage.getItem('etl_pending_tasks')
      if (stored) {
        const tasks = JSON.parse(stored) as PendingTask[]
        // 过滤掉超过 24 小时的任务
        const filtered = tasks.filter(t => Date.now() - t.timestamp < 24 * 60 * 60 * 1000)
        setPendingTasks(filtered)
        if (filtered.length !== tasks.length) {
          localStorage.setItem('etl_pending_tasks', JSON.stringify(filtered))
        }
      }
    } catch (error) {
      console.error('Failed to load pending tasks:', error)
    }
  }, [])

  // 检查任务状态
  // 注意：不再从 localStorage 中移除已完成的任务，由用户手动清除
  // 会更新 localStorage 中的任务状态字段
  const checkTaskStatus = useCallback(async () => {
    if (!session?.access_token || pendingTasks.length === 0) {
      return
    }

    try {
      // 只检查有真正任务 ID 的任务（排除负数 ID 的占位任务）
      const realTasks = pendingTasks.filter(t => t.taskId > 0)
      if (realTasks.length === 0) {
        return  // 只有占位任务，暂不需要检查状态
      }
      
      const taskIds = realTasks.map(t => t.taskId)
      const response = await batchGetETLTaskStatus(taskIds, session.access_token)

      let hasChanges = false
      const updatedTasks: PendingTask[] = []

      // 保留占位任务（负数 ID）
      const placeholderTasks = pendingTasks.filter(t => t.taskId < 0)
      updatedTasks.push(...placeholderTasks)

      // 处理真正的任务
      realTasks.forEach((pendingTask) => {
        const task = response.tasks.find(t => t.task_id === pendingTask.taskId)
        
        if (task) {
          // 检查状态是否变化
          if (pendingTask.status !== task.status) {
            hasChanges = true
          }
          
          // 更新任务状态
          updatedTasks.push({
            ...pendingTask,
            status: task.status
          })
          
          // 如果任务刚刚完成，触发事件
          if (isTerminalStatus(task.status) && !isTerminalStatus(pendingTask.status || 'pending')) {
            if (task.status === 'completed') {
              window.dispatchEvent(new CustomEvent('etl-task-completed', { 
                detail: { 
                  taskId: task.task_id,
                  filename: pendingTask.filename,
                  tableId: task.metadata?.mount_table_id || pendingTask.tableId
                } 
              }))
            } else if (task.status === 'failed') {
              window.dispatchEvent(new CustomEvent('etl-task-failed', { 
                detail: { taskId: task.task_id, error: task.error, filename: pendingTask.filename } 
              }))
            } else if (task.status === 'cancelled') {
              window.dispatchEvent(new CustomEvent('etl-task-cancelled', { 
                detail: { taskId: task.task_id, filename: pendingTask.filename } 
              }))
            }
          }
        } else {
          // 任务不在响应中，保留原状态
          updatedTasks.push(pendingTask)
        }
      })

      // 有变化时，更新 localStorage 和状态
      if (hasChanges) {
        localStorage.setItem('etl_pending_tasks', JSON.stringify(updatedTasks))
        setPendingTasks(updatedTasks)
        
        // 触发任务状态更新事件（让 TaskStatusWidget 和侧边栏刷新显示）
        window.dispatchEvent(new CustomEvent('etl-tasks-updated'))
        // 触发项目刷新事件（刷新 table 数据）
        window.dispatchEvent(new CustomEvent('projects-refresh'))
      }
    } catch (error) {
      console.error('Failed to check ETL task status:', error)
    }
  }, [session, pendingTasks])

  // 初始加载和监听任务更新事件
  useEffect(() => {
    loadPendingTasks()

    const handleTasksUpdated = () => {
      loadPendingTasks()
    }
    
    window.addEventListener('etl-tasks-updated', handleTasksUpdated)
    return () => window.removeEventListener('etl-tasks-updated', handleTasksUpdated)
  }, [loadPendingTasks])

  // 定时检查任务状态（每 3 秒）
  useEffect(() => {
    if (pendingTasks.length === 0) return

    // 立即检查一次
    checkTaskStatus()

    // 每 3 秒检查一次
    const interval = setInterval(checkTaskStatus, 3000)
    return () => clearInterval(interval)
  }, [pendingTasks, checkTaskStatus])

  // 此组件不渲染任何 UI
  return null
}

// ============= Helper Functions =============

/**
 * 添加任务到 pending 列表
 */
export function addPendingTasks(tasks: Omit<PendingTask, 'timestamp'>[]) {
  const existing = JSON.parse(localStorage.getItem('etl_pending_tasks') || '[]') as PendingTask[]
  const newTasks = tasks.map(t => ({ ...t, timestamp: Date.now() }))
  localStorage.setItem('etl_pending_tasks', JSON.stringify([...existing, ...newTasks]))
  window.dispatchEvent(new CustomEvent('etl-tasks-updated'))
}

/**
 * 用真正的任务替换占位任务（负数 ID 的任务）
 */
export function replacePlaceholderTasks(tableId: string, realTasks: Omit<PendingTask, 'timestamp'>[]) {
  const existing = JSON.parse(localStorage.getItem('etl_pending_tasks') || '[]') as PendingTask[]
  
  // 移除该 Table 下的所有占位任务（负数 ID）
  const filtered = existing.filter(t => !(t.tableId === tableId && t.taskId < 0))
  
  // 添加真正的任务
  const newTasks = realTasks.map(t => ({ ...t, timestamp: Date.now() }))
  localStorage.setItem('etl_pending_tasks', JSON.stringify([...filtered, ...newTasks]))
  window.dispatchEvent(new CustomEvent('etl-tasks-updated'))
}

/**
 * 移除失败文件的占位任务
 */
export function removeFailedPlaceholders(tableId: string, filenames: string[]) {
  const existing = JSON.parse(localStorage.getItem('etl_pending_tasks') || '[]') as PendingTask[]
  const filtered = existing.filter(t => !(t.tableId === tableId && t.taskId < 0 && filenames.includes(t.filename)))
  localStorage.setItem('etl_pending_tasks', JSON.stringify(filtered))
  window.dispatchEvent(new CustomEvent('etl-tasks-updated'))
}

/**
 * 移除某个 Table 的所有占位任务
 */
export function removeAllPlaceholdersForTable(tableId: string) {
  const existing = JSON.parse(localStorage.getItem('etl_pending_tasks') || '[]') as PendingTask[]
  const filtered = existing.filter(t => !(t.tableId === tableId && t.taskId < 0))
  localStorage.setItem('etl_pending_tasks', JSON.stringify(filtered))
  window.dispatchEvent(new CustomEvent('etl-tasks-updated'))
}

/**
 * 获取指定 table 下正在处理的文件列表
 */
export function getPendingFilesForTable(tableId: string): PendingTask[] {
  const stored = localStorage.getItem('etl_pending_tasks')
  if (!stored) return []
  
  const tasks = JSON.parse(stored) as PendingTask[]
  return tasks.filter(t => t.tableId === tableId)
}

/**
 * 获取所有任务（包括已完成的）
 */
export function getAllPendingTasks(): PendingTask[] {
  const stored = localStorage.getItem('etl_pending_tasks')
  if (!stored) return []
  return JSON.parse(stored) as PendingTask[]
}

/**
 * 获取正在处理中（非终态）的 Table ID 列表
 * 用于侧边栏显示处理中状态
 */
export function getProcessingTableIds(): Set<string> {
  const tasks = getAllPendingTasks()
  const tableIds = new Set<string>()
  
  tasks.forEach(task => {
    // 只统计非终态任务
    const isTerminal = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
    if (task.tableId && !isTerminal) {
      tableIds.add(task.tableId)
    }
  })
  
  return tableIds
}
