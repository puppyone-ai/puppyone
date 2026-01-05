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
} from './BackgroundTaskNotifier';

interface TaskWithStatus extends PendingTask {
  displayStatus: ETLTaskStatus['status'] | 'uploading';
}

/**
 * 右下角任务状态浮窗
 *
 * 简洁交互：
 * - 收起：小圆圈，点击展开
 * - 展开：任务列表 + 收起按钮 + 清空按钮
 * - 不自己轮询，只监听 BackgroundTaskNotifier 的事件
 */
export function TaskStatusWidget() {
  const [tasks, setTasks] = useState<TaskWithStatus[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  // 从 sessionStorage 加载任务
  const loadTasks = useCallback(() => {
    const allTasks = getAllPendingTasks();
    const tasksWithStatus: TaskWithStatus[] = allTasks.map(t => ({
      ...t,
      displayStatus: t.taskId < 0 ? 'uploading' : t.status || 'pending',
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
  const completedCount = tasks.filter(
    t => t.displayStatus === 'completed'
  ).length;
  const failedCount = tasks.filter(t => t.displayStatus === 'failed').length;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9999,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
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
            width: 40,
            height: 40,
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
              width='18'
              height='18'
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
            <svg width='16' height='16' viewBox='0 0 16 16' fill='none'>
              <path
                d='M4 4L12 12M12 4L4 12'
                stroke='#f87171'
                strokeWidth='2'
                strokeLinecap='round'
              />
            </svg>
          ) : (
            <svg width='16' height='16' viewBox='0 0 16 16' fill='none'>
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
            width: 300,
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
              padding: '10px 12px',
              borderBottom: '1px solid #333',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {processingCount > 0 ? (
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
                    stroke='#3b82f6'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeDasharray='24 8'
                  />
                </svg>
              ) : (
                <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                  <path
                    d='M3 7L6 10L11 4'
                    stroke='#4ade80'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                </svg>
              )}
              <span style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 500 }}>
                {processingCount > 0 ? `处理中 (${processingCount})` : '已完成'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
                title='收起'
              >
                <svg width='12' height='12' viewBox='0 0 12 12' fill='none'>
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
                title='清空'
              >
                <svg width='12' height='12' viewBox='0 0 12 12' fill='none'>
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

          {/* 任务列表 */}
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {tasks.map(task => (
              <TaskRow key={task.taskId} task={task} />
            ))}
          </div>

          {/* 底部统计 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 12px',
              borderTop: '1px solid #333',
              background: '#1a1a1e',
            }}
          >
            {completedCount > 0 && (
              <span
                style={{
                  color: '#4ade80',
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <svg width='10' height='10' viewBox='0 0 10 10' fill='none'>
                  <path
                    d='M2 5L4 7L8 3'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                </svg>
                {completedCount} 成功
              </span>
            )}
            {failedCount > 0 && (
              <span
                style={{
                  color: '#f87171',
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <svg width='10' height='10' viewBox='0 0 10 10' fill='none'>
                  <path
                    d='M2 2L8 8M8 2L2 8'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                  />
                </svg>
                {failedCount} 失败
              </span>
            )}
            {processingCount > 0 && (
              <span
                style={{
                  color: '#3b82f6',
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <svg
                  width='10'
                  height='10'
                  viewBox='0 0 10 10'
                  fill='none'
                  style={{ animation: 'widget-spin 1s linear infinite' }}
                >
                  <circle
                    cx='5'
                    cy='5'
                    r='3.5'
                    stroke='currentColor'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                    strokeDasharray='16 5'
                  />
                </svg>
                {processingCount} 处理中
              </span>
            )}
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

/** 单个任务行 */
function TaskRow({ task }: { task: TaskWithStatus }) {
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
      <div style={{ flexShrink: 0 }}>
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
          {getStatusDisplayText(task.displayStatus)}
        </div>
      </div>
    </div>
  );
}

export default TaskStatusWidget;
