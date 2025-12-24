'use client'

import React, { useState, useEffect } from 'react'
import type { PendingTask } from '../../../BackgroundTaskNotifier'

// ============================================
// Types
// ============================================

interface PendingTaskRendererProps {
  /** 任务信息 */
  task: PendingTask
  /** 显示的文件名 */
  filename: string
}

// ============================================
// Utility Functions
// ============================================

/**
 * 从 sessionStorage 获取所有 pending tasks
 */
export function getAllPendingTasks(): PendingTask[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = sessionStorage.getItem('etl_pending_tasks')
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

/**
 * 根据文件名查找对应的 pending task
 * 用于在渲染 null 值时判断是否应该显示处理中状态
 * 
 * 注意：只返回非终态的任务，终态任务（completed/failed/cancelled）不显示占位符
 */
export function findPendingTaskByFilename(filename: string, tableId?: string): PendingTask | undefined {
  const tasks = getAllPendingTasks()
  
  // 终态任务不应该显示占位符
  const isTerminal = (status?: string) => 
    status === 'completed' || status === 'failed' || status === 'cancelled'
  
  return tasks.find(t => {
    // 跳过终态任务
    if (isTerminal(t.status)) return false
    
    // 如果提供了 tableId，优先匹配 tableId + filename
    if (tableId && t.tableId === tableId && t.filename === filename) {
      return true
    }
    // 否则只匹配 filename
    return t.filename === filename
  })
}

/**
 * 判断值是否为 null 且对应一个 pending ETL task
 * 用于在 ValueRenderer 中决定是否显示处理中状态
 */
export function isPendingNullValue(value: any, nodeKey: string, tableId?: string): PendingTask | undefined {
  if (value !== null) return undefined
  
  // nodeKey 通常是文件名，如 "document.pdf"
  return findPendingTaskByFilename(nodeKey, tableId)
}

// ============================================
// Components
// ============================================

/**
 * 渲染 ETL 处理中状态
 * 简洁的旋转加载符 + 文件名
 */
export function PendingTaskRenderer({ task, filename }: PendingTaskRendererProps) {
  // 监听 ETL 任务状态更新
  const [, forceUpdate] = useState(0)
  
  useEffect(() => {
    const handleTaskUpdate = () => forceUpdate(n => n + 1)
    window.addEventListener('etl-tasks-updated', handleTaskUpdate)
    return () => window.removeEventListener('etl-tasks-updated', handleTaskUpdate)
  }, [])

  return (
    <div style={{ 
      display: 'inline-flex', 
      alignItems: 'center', 
      gap: 6,
      color: '#3b82f6',
    }}>
      {/* 简洁的旋转加载符 */}
      <svg 
        width="14" 
        height="14" 
        viewBox="0 0 14 14" 
        fill="none"
        style={{ 
          animation: 'etl-spin 1s linear infinite',
          flexShrink: 0
        }}
      >
        <style>{`
          @keyframes etl-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
        <circle 
          cx="7" 
          cy="7" 
          r="5" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round"
          strokeDasharray="24 8"
        />
      </svg>
      
      <span style={{ 
        fontSize: 13, 
        color: '#6b7280',
        fontStyle: 'italic',
      }}>
        Processing...
      </span>
    </div>
  )
}

export default PendingTaskRenderer
