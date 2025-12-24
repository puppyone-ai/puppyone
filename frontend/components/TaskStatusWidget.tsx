'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { batchGetETLTaskStatus, isTerminalStatus, getStatusDisplayText, ETLTaskStatus } from '../lib/etlApi'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'

interface PendingTask {
  taskId: number
  projectId: string
  tableId?: string
  tableName?: string
  filename: string
  timestamp: number
}

interface TaskWithStatus extends PendingTask {
  status: ETLTaskStatus['status'] | 'uploading'
  progress: number
}

/**
 * 右下角任务状态浮窗 - 简洁版
 * 
 * 交互设计：
 * 1. 用户上传文件后，立即显示此浮窗
 * 2. 处理中时展开显示详情
 * 3. 全部完成后自动收缩成小圆圈
 * 4. hover 小圆圈可预览任务列表
 * 5. 只有用户手动点关闭才消失
 */
export function TaskStatusWidget() {
  const { session } = useAuth()
  const [tasks, setTasks] = useState<TaskWithStatus[]>([])
  const [isExpanded, setIsExpanded] = useState(true)
  const [isVisible, setIsVisible] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const [hasNewTasks, setHasNewTasks] = useState(false)
  const prevTaskCountRef = useRef(0)
  const autoCollapseTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 从 localStorage 加载任务并获取实时状态
  const loadAndUpdateTasks = useCallback(async () => {
    try {
      const stored = localStorage.getItem('etl_pending_tasks')
      if (!stored) {
        if (!isVisible) {
          setTasks([])
        }
        return
      }

      const pendingTasks = JSON.parse(stored) as PendingTask[]
      const validTasks = pendingTasks.filter(t => Date.now() - t.timestamp < 24 * 60 * 60 * 1000)
      
      if (validTasks.length === 0) {
        if (!isVisible) {
          setTasks([])
        }
        return
      }

      if (validTasks.length > prevTaskCountRef.current) {
        setHasNewTasks(true)
        setIsExpanded(true)
        setIsVisible(true)
      }
      prevTaskCountRef.current = validTasks.length

      setIsVisible(true)

      // 分离占位任务和真正的任务
      const placeholderTasks = validTasks.filter(t => t.taskId < 0)
      const realTasks = validTasks.filter(t => t.taskId > 0)
      
      const placeholderTasksWithStatus: TaskWithStatus[] = placeholderTasks.map(t => ({
        ...t,
        status: 'uploading' as const,
        progress: 0
      }))

      if (session?.access_token && realTasks.length > 0) {
        try {
          const taskIds = realTasks.map(t => t.taskId)
          const response = await batchGetETLTaskStatus(taskIds, session.access_token)
          
          const realTasksWithStatus: TaskWithStatus[] = realTasks.map(task => {
            const statusInfo = response.tasks.find(t => t.task_id === task.taskId)
            return {
              ...task,
              status: statusInfo?.status || 'pending',
              progress: statusInfo?.progress || 0
            }
          })
          
          const allTasksWithStatus = [...placeholderTasksWithStatus, ...realTasksWithStatus]
          setTasks(allTasksWithStatus)
          
          const isTaskTerminalCheck = (status: TaskWithStatus['status']) => 
            status !== 'uploading' && isTerminalStatus(status as any)
          const allCompleted = allTasksWithStatus.every(t => isTaskTerminalCheck(t.status))
          if (allCompleted && hasNewTasks) {
            if (autoCollapseTimeoutRef.current) {
              clearTimeout(autoCollapseTimeoutRef.current)
            }
            autoCollapseTimeoutRef.current = setTimeout(() => {
              setIsExpanded(false)
              setHasNewTasks(false)
            }, 2000)
          }
        } catch (error) {
          const fallbackTasks: TaskWithStatus[] = [
            ...placeholderTasksWithStatus,
            ...realTasks.map(t => ({ ...t, status: 'pending' as const, progress: 0 }))
          ]
          setTasks(fallbackTasks)
        }
      } else {
        const fallbackTasks: TaskWithStatus[] = [
          ...placeholderTasksWithStatus,
          ...realTasks.map(t => ({ ...t, status: 'pending' as const, progress: 0 }))
        ]
        setTasks(fallbackTasks)
      }
    } catch (error) {
      console.error('Failed to load tasks:', error)
    }
  }, [session, isVisible, hasNewTasks])

  useEffect(() => {
    loadAndUpdateTasks()

    const handleTasksUpdated = () => {
      loadAndUpdateTasks()
    }
    
    window.addEventListener('etl-tasks-updated', handleTasksUpdated)
    window.addEventListener('storage', handleTasksUpdated)
    
    const interval = setInterval(loadAndUpdateTasks, 2000)

    return () => {
      window.removeEventListener('etl-tasks-updated', handleTasksUpdated)
      window.removeEventListener('storage', handleTasksUpdated)
      clearInterval(interval)
      if (autoCollapseTimeoutRef.current) {
        clearTimeout(autoCollapseTimeoutRef.current)
      }
    }
  }, [loadAndUpdateTasks])

  const handleClose = useCallback(() => {
    localStorage.removeItem('etl_pending_tasks')
    setTasks([])
    setIsVisible(false)
    setHasNewTasks(false)
    prevTaskCountRef.current = 0
    window.dispatchEvent(new CustomEvent('etl-tasks-updated'))
  }, [])

  if (!isVisible || tasks.length === 0) {
    return null
  }

  const isTaskTerminal = (status: TaskWithStatus['status']) => 
    status !== 'uploading' && isTerminalStatus(status as any)
  
  const processingCount = tasks.filter(t => !isTaskTerminal(t.status)).length
  const completedCount = tasks.filter(t => t.status === 'completed').length
  const failedCount = tasks.filter(t => t.status === 'failed').length
  const allDone = processingCount === 0

  return (
    <div 
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9999,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <style>{`
        @keyframes widget-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* 收起状态：小圆圈 */}
      {!isExpanded ? (
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setIsExpanded(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              background: '#1e1e22',
              border: `1px solid ${allDone ? (failedCount > 0 ? '#7f1d1d' : '#166534') : '#1e40af'}`,
              borderRadius: '50%',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            }}
          >
            {processingCount > 0 ? (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ animation: 'widget-spin 1s linear infinite' }}>
                <circle cx="9" cy="9" r="6" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeDasharray="28 10"/>
              </svg>
            ) : failedCount > 0 ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4L12 12M12 4L4 12" stroke="#f87171" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 8L7 11L12 5" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            
            {/* 数量角标 */}
            <span style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              background: failedCount > 0 ? '#dc2626' : (processingCount > 0 ? '#2563eb' : '#16a34a'),
              color: 'white',
              borderRadius: 8,
              fontSize: 10,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
            }}>
              {tasks.length}
            </span>
          </button>

          {/* Hover 预览 */}
          {isHovering && (
            <div style={{
              position: 'absolute',
              bottom: 48,
              right: 0,
              width: 240,
              background: '#1e1e22',
              border: '1px solid #333',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
              overflow: 'hidden',
            }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid #333', color: '#9ca3af', fontSize: 11 }}>
                {processingCount > 0 ? `${processingCount} processing...` : 'All done'}
              </div>
              <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                {tasks.slice(0, 5).map((task) => (
                  <div key={task.taskId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px' }}>
                    <span style={{ 
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      background: task.status === 'completed' ? '#4ade80' : task.status === 'failed' ? '#f87171' : '#3b82f6'
                    }} />
                    <span style={{ fontSize: 11, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {task.filename}
                    </span>
                  </div>
                ))}
                {tasks.length > 5 && (
                  <div style={{ padding: '6px 12px', color: '#6b7280', fontSize: 11, textAlign: 'center' }}>
                    +{tasks.length - 5} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* 展开状态 */
        <div style={{
          width: 300,
          background: '#1e1e22',
          border: '1px solid #333',
          borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
        }}>
          {/* 头部 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            borderBottom: '1px solid #333',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {processingCount > 0 ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation: 'widget-spin 1s linear infinite' }}>
                  <circle cx="7" cy="7" r="5" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeDasharray="24 8"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7L6 10L11 4" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              <span style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 500 }}>
                {processingCount > 0 ? 'Processing' : 'Completed'}
              </span>
              <span style={{ color: '#6b7280', fontSize: 11 }}>
                {tasks.length} files
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button onClick={() => setIsExpanded(false)} style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: '#6b7280', display: 'flex' }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
              <button onClick={handleClose} style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: '#6b7280', display: 'flex' }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
          </div>

          {/* 任务列表 */}
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {tasks.map((task) => (
              <TaskRow key={task.taskId} task={task} />
            ))}
          </div>

          {/* 底部统计 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 12px',
            borderTop: '1px solid #333',
            background: '#1a1a1e',
          }}>
            {completedCount > 0 && (
              <span style={{ color: '#4ade80', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {completedCount}
              </span>
            )}
            {failedCount > 0 && (
              <span style={{ color: '#f87171', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                {failedCount}
              </span>
            )}
            {processingCount > 0 && (
              <span style={{ color: '#3b82f6', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ animation: 'widget-spin 1s linear infinite' }}>
                  <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="16 5"/>
                </svg>
                {processingCount}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** 单个任务行 */
function TaskRow({ task }: { task: TaskWithStatus }) {
  const getStatusColor = () => {
    switch (task.status) {
      case 'completed': return '#4ade80'
      case 'failed': return '#f87171'
      case 'uploading': return '#fbbf24'
      default: return '#3b82f6'
    }
  }

  const isProcessing = task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 12px',
      borderBottom: '1px solid #2a2a2e',
    }}>
      {/* 状态图标 */}
      <div style={{ flexShrink: 0 }}>
        {task.status === 'completed' ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 7L6 10L11 4" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : task.status === 'failed' ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation: 'widget-spin 1s linear infinite' }}>
            <circle cx="7" cy="7" r="5" stroke={getStatusColor()} strokeWidth="2" strokeLinecap="round" strokeDasharray="24 8"/>
          </svg>
        )}
      </div>

      {/* 文件名和状态 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: '#e2e8f0',
          fontSize: 12,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {task.filename}
        </div>
        <div style={{ color: getStatusColor(), fontSize: 10, marginTop: 2 }}>
          {getStatusDisplayText(task.status)}
        </div>
      </div>
    </div>
  )
}

export default TaskStatusWidget
