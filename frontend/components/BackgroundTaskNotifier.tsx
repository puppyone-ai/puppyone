'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'
import { batchGetETLTaskStatus, ETLTaskStatus } from '../lib/etlApi'

interface PendingTask {
  taskId: number
  projectId: string
  tableName: string
  timestamp: number
}

/**
 * BackgroundTaskNotifier - 后台任务状态检查器（无 UI）
 * 
 * 功能：
 * - 定时轮询 localStorage 中的 pending ETL 任务
 * - 检查任务状态并更新 localStorage
 * - 触发事件通知其他组件（如 Parsing Tasks 页面）
 * - 不再显示任何弹窗或通知，所有UI在专门的 Parsing Tasks 页面中
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
  const checkTaskStatus = useCallback(async () => {
    if (!session?.access_token || pendingTasks.length === 0) {
      return
    }

    try {
      const taskIds = pendingTasks.map(t => t.taskId)
      const response = await batchGetETLTaskStatus(taskIds, session.access_token)

      const stillPending: PendingTask[] = []
      let hasChanges = false

      pendingTasks.forEach((pendingTask) => {
        const task = response.tasks.find(t => t.task_id === pendingTask.taskId)
        
        if (task) {
          if (task.status === 'completed') {
            hasChanges = true
            // 触发项目刷新事件
            window.dispatchEvent(new CustomEvent('etl-task-completed', { detail: { taskId: task.task_id } }))
          } else if (task.status === 'failed') {
            hasChanges = true
          } else {
            // 仍在进行中
            stillPending.push(pendingTask)
          }
        } else {
          // 任务不在响应中，可能已被删除
          hasChanges = true
          console.log(`Task ${pendingTask.taskId} not found in response, removing from pending list`)
        }
      })

      // 更新 localStorage 和状态
      if (hasChanges) {
        localStorage.setItem('etl_pending_tasks', JSON.stringify(stillPending))
        setPendingTasks(stillPending)
        
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
