'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  isTerminalStatus,
  getStatusDisplayText,
  ETLTaskStatus,
} from '../lib/etlApi';
import {
  getAllPendingTasks,
  clearAllTasks,
  PendingTask,
  TaskType,
} from './BackgroundTaskNotifier';

interface TaskWithStatus extends PendingTask {
  displayStatus: ETLTaskStatus['status'] | 'uploading' | 'downloading' | 'extracting' | 'creating_nodes';
}

interface TaskStatusWidgetProps {
  /** Use absolute positioning within parent instead of fixed */
  inline?: boolean;
}

/**
 * 任务状态浮窗
 *
 * 简洁交互：
 * - 收起：小圆圈，点击展开
 * - 展开：任务列表 + 收起按钮 + 清空按钮
 * - 不自己轮询，只监听 BackgroundTaskNotifier 的事件
 */
export function TaskStatusWidget({ inline = false }: TaskStatusWidgetProps) {
  const [tasks, setTasks] = useState<TaskWithStatus[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  // 从 sessionStorage 加载任务
  const loadTasks = useCallback(() => {
    const allTasks = getAllPendingTasks();
    const tasksWithStatus: TaskWithStatus[] = allTasks.map(t => ({
      ...t,
      displayStatus: t.taskId.startsWith('-') ? 'uploading' : t.status || 'pending',
    }));
    setTasks(tasksWithStatus);

    // 有新任务时自动展开
    if (
      tasksWithStatus.length > 0 &&
      tasksWithStatus.some(t => !isTaskTerminal(t.displayStatus))
    ) {
      setIsExpanded(true);
    }
  }, []);

  // 监听任务更新事件
  useEffect(() => {
    loadTasks();

    const handleUpdate = () => loadTasks();
    window.addEventListener('etl-tasks-updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);

    return () => {
      window.removeEventListener('etl-tasks-updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, [loadTasks]);

  // 清空所有任务
  const handleClear = useCallback(() => {
    clearAllTasks();
    setTasks([]);
    setIsExpanded(false);
  }, []);

  // 无任务时不显示
  if (tasks.length === 0) {
    return null;
  }

  const processingCount = tasks.filter(
    t => !isTaskTerminal(t.displayStatus)
  ).length;
  const failedCount = tasks.filter(t => t.displayStatus === 'failed').length;

  // Position styles based on inline prop
  const containerStyle: React.CSSProperties = inline
    ? {
        position: 'absolute',
        bottom: 12,
        right: 12,
        zIndex: 30,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }
    : {
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9999,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      };

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes widget-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      {!isExpanded ? (
        /* 收起状态：小圆圈 */
        <button
          onClick={() => setIsExpanded(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            background: '#1e1e22',
            border: `1px solid ${processingCount > 0 ? '#1e40af' : failedCount > 0 ? '#7f1d1d' : '#166534'}`,
            borderRadius: '50%',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            position: 'relative',
          }}
        >
          {processingCount > 0 ? (
            <svg
              width='16'
              height='16'
              viewBox='0 0 18 18'
              fill='none'
              style={{ animation: 'widget-spin 1s linear infinite' }}
            >
              <circle
                cx='9'
                cy='9'
                r='6'
                stroke='#3b82f6'
                strokeWidth='2'
                strokeLinecap='round'
                strokeDasharray='28 10'
              />
            </svg>
          ) : failedCount > 0 ? (
            <svg width='14' height='14' viewBox='0 0 16 16' fill='none'>
              <path
                d='M4 4L12 12M12 4L4 12'
                stroke='#f87171'
                strokeWidth='2'
                strokeLinecap='round'
              />
            </svg>
          ) : (
            <svg width='14' height='14' viewBox='0 0 16 16' fill='none'>
              <path
                d='M4 8L7 11L12 5'
                stroke='#4ade80'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
          )}

          {/* 数量角标 */}
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              background:
                failedCount > 0
                  ? '#dc2626'
                  : processingCount > 0
                    ? '#2563eb'
                    : '#16a34a',
              color: 'white',
              borderRadius: 8,
              fontSize: 10,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
            }}
          >
            {tasks.length}
          </span>
        </button>
      ) : (
        /* 展开状态 */
        <div
          style={{
            width: 260,
            background: '#1e1e22',
            border: '1px solid #333',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            overflow: 'hidden',
          }}
        >
          {/* 头部 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px',
              borderBottom: '1px solid #333',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {processingCount > 0 ? (
                <svg
                  width='12'
                  height='12'
                  viewBox='0 0 14 14'
                  fill='none'
                  style={{ animation: 'widget-spin 1s linear infinite' }}
                >
                  <circle
                    cx='7'
                    cy='7'
                    r='5'
                    stroke='#3b82f6'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeDasharray='24 8'
                  />
                </svg>
              ) : (
                <svg width='12' height='12' viewBox='0 0 14 14' fill='none'>
                  <path
                    d='M3 7L6 10L11 4'
                    stroke='#4ade80'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                </svg>
              )}
              <span style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 500 }}>
                {processingCount > 0 ? `${processingCount} processing` : 'Done'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {/* 收起按钮 */}
              <button
                onClick={() => setIsExpanded(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 4,
                  cursor: 'pointer',
                  color: '#6b7280',
                  display: 'flex',
                }}
                title='Minimize'
              >
                <svg width='10' height='10' viewBox='0 0 12 12' fill='none'>
                  <path
                    d='M2 6h8'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                  />
                </svg>
              </button>
              {/* 清空按钮 */}
              <button
                onClick={handleClear}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 4,
                  cursor: 'pointer',
                  color: '#6b7280',
                  display: 'flex',
                }}
                title='Clear'
              >
                <svg width='10' height='10' viewBox='0 0 12 12' fill='none'>
                  <path
                    d='M2 2L10 10M10 2L2 10'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* 任务列表 - 简化版，无底部统计 */}
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {tasks.map(task => (
              <TaskRow key={task.taskId} task={task} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 判断是否为终态 */
function isTaskTerminal(status: string): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled'
  );
}

// SaaS 类型图标 - 使用图片文件
const SaasIcons: Record<string, (props: { size?: number }) => JSX.Element> = {
  notion: ({ size = 12 }) => (
    <img src="/icons/notion.svg" alt="Notion" width={size} height={size} style={{ display: 'block' }} />
  ),
  github: ({ size = 12 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  ),
  airtable: ({ size = 12 }) => (
    <img src="/icons/airtable.png" alt="Airtable" width={size} height={size} style={{ display: 'block' }} />
  ),
  google_sheets: ({ size = 12 }) => (
    <img src="/icons/google_sheet.svg" alt="Google Sheets" width={size} height={size} style={{ display: 'block' }} />
  ),
  linear: ({ size = 12 }) => (
    <img src="/icons/linear.svg" alt="Linear" width={size} height={size} style={{ display: 'block' }} />
  ),
  gmail: ({ size = 12 }) => (
    <img src="/icons/gmail.svg" alt="Gmail" width={size} height={size} style={{ display: 'block' }} />
  ),
  drive: ({ size = 12 }) => (
    <img src="/icons/google_drive.svg" alt="Google Drive" width={size} height={size} style={{ display: 'block' }} />
  ),
  calendar: ({ size = 12 }) => (
    <img src="/icons/google_calendar.svg" alt="Google Calendar" width={size} height={size} style={{ display: 'block' }} />
  ),
};

// 获取 SaaS 状态文本
function getSaasStatusText(status: string): string {
  switch (status) {
    case 'pending': return 'Waiting...';
    case 'downloading': return 'Downloading...';
    case 'extracting': return 'Extracting...';
    case 'uploading': return 'Uploading...';
    case 'creating_nodes': return 'Creating...';
    case 'completed': return 'Done';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
}

/** 单个任务行 */
function TaskRow({ task }: { task: TaskWithStatus }) {
  const isSaasTask = task.taskType && task.taskType !== 'file';
  const SaasIcon = isSaasTask && task.taskType ? SaasIcons[task.taskType] : null;
  
  const getStatusColor = () => {
    switch (task.displayStatus) {
      case 'completed':
        return '#4ade80';
      case 'failed':
        return '#f87171';
      case 'uploading':
        return '#fbbf24';
      default:
        return '#3b82f6';
    }
  };

  const isProcessing = !isTaskTerminal(task.displayStatus);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 12px',
        borderBottom: '1px solid #2a2a2e',
      }}
    >
      {/* 状态图标 */}
      <div style={{ flexShrink: 0, position: 'relative' }}>
        {task.displayStatus === 'completed' ? (
          <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
            <path
              d='M3 7L6 10L11 4'
              stroke='#4ade80'
              strokeWidth='1.5'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
        ) : task.displayStatus === 'failed' ? (
          <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
            <path
              d='M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5'
              stroke='#f87171'
              strokeWidth='1.5'
              strokeLinecap='round'
            />
          </svg>
        ) : (
          <svg
            width='14'
            height='14'
            viewBox='0 0 14 14'
            fill='none'
            style={{ animation: 'widget-spin 1s linear infinite' }}
          >
            <circle
              cx='7'
              cy='7'
              r='5'
              stroke={getStatusColor()}
              strokeWidth='2'
              strokeLinecap='round'
              strokeDasharray='24 8'
            />
          </svg>
        )}
        
        {/* SaaS 图标角标 */}
        {SaasIcon && (
          <div style={{
            position: 'absolute',
            bottom: -3,
            right: -5,
            background: '#1e1e22',
            borderRadius: 3,
            padding: 1,
            color: '#a1a1aa',
          }}>
            <SaasIcon size={8} />
          </div>
        )}
      </div>

      {/* 文件名和状态 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: '#e2e8f0',
            fontSize: 12,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {task.filename}
        </div>
        <div style={{ color: getStatusColor(), fontSize: 10, marginTop: 2 }}>
          {isSaasTask ? getSaasStatusText(task.displayStatus) : getStatusDisplayText(task.displayStatus as ETLTaskStatus['status'] | 'uploading')}
        </div>
      </div>
    </div>
  );
}

export default TaskStatusWidget;
