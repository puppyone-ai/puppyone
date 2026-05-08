'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  isTerminalStatus,
  getStatusDisplayText,
  cancelETLTask,
  ETLTaskStatus,
} from '../lib/etlApi';
import {
  getAllPendingTasks,
  clearAllTasks,
  removeTaskById,
  PendingTask,
  TaskType,
} from './BackgroundTaskNotifier';
import {
  ACTIVITY_BG,
  ACTIVITY_BORDER,
  ACTIVITY_SHADOW,
  ACTIVITY_WIDTH,
  activityCardStyle,
  activityHeaderStyle,
  activityTitleStyle,
} from './activityStyles';
import { ActivityIconButton } from './ActivityIconButton';

interface TaskWithStatus extends PendingTask {
  displayStatus:
    | ETLTaskStatus['status']
    | 'uploading'
    | 'finalizing'
    | 'downloading'
    | 'extracting'
    | 'creating_nodes';
  /**
   * Best-known upload progress 0..100 for the ``uploading`` phase.
   * Backed by ``PendingTask.progress`` but copied here so the widget
   * can render even if the field is briefly absent during a state
   * transition.
   */
  displayProgress?: number;
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
    // Newest first: matches the chat-app / activity-feed convention
    // where the most recent action sits at the top of the list and
    // pushes older items down. Without this, dropping 5 PDFs in a row
    // shows them in upload-start order, which makes spotting the new
    // task you just added require scrolling past finished ones.
    const sorted = [...allTasks].sort((a, b) => b.timestamp - a.timestamp);
    const tasksWithStatus: TaskWithStatus[] = sorted.map(t => ({
      ...t,
      // Legacy negative-prefix placeholder IDs still get treated as
      // ``uploading`` for back-compat with any sessionStorage left
      // over from the old flow. New uploads set ``status``
      // explicitly via ``updateTaskStatusById`` / ``addPendingTasks``.
      displayStatus: t.taskId.startsWith('-')
        ? 'uploading'
        : t.status || 'pending',
      displayProgress: t.progress,
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
    // Lightweight progress-only updates skip the full reload to
    // avoid a re-render storm during a multipart upload (parts can
    // fire ``progress`` dozens of times per second). Patch only
    // the affected row's ``displayProgress`` in-place.
    const handleProgress = (e: Event) => {
      const detail = (e as CustomEvent<{ taskId: string; progress: number }>)
        .detail;
      if (!detail) return;
      setTasks(prev =>
        prev.map(t =>
          t.taskId === detail.taskId
            ? { ...t, displayProgress: detail.progress }
            : t,
        ),
      );
    };

    window.addEventListener('etl-tasks-updated', handleUpdate);
    window.addEventListener('etl-task-progress', handleProgress);
    window.addEventListener('storage', handleUpdate);

    return () => {
      window.removeEventListener('etl-tasks-updated', handleUpdate);
      window.removeEventListener('etl-task-progress', handleProgress);
      window.removeEventListener('storage', handleUpdate);
    };
  }, [loadTasks]);

  // 清空所有任务
  const handleClear = useCallback(() => {
    clearAllTasks();
    setTasks([]);
    setIsExpanded(false);
  }, []);

  // Per-task removal. For processing FILE tasks we ALSO call the
  // backend cancel endpoint (the worker honors it via the `cancelled`
  // terminal state). For SaaS tasks the backend doesn't expose cancel,
  // so removal is purely local (the in-flight job will still finish
  // server-side, the user just hides it from this widget).
  const handleRemoveTask = useCallback(async (task: TaskWithStatus) => {
    const isProcessing = !isTaskTerminal(task.displayStatus);
    const isFileTask = !task.taskType || task.taskType === 'file';
    if (isProcessing && isFileTask && !task.taskId.startsWith('-') && !task.taskId.startsWith('placeholder-')) {
      try {
        await cancelETLTask(task.taskId, 'file');
      } catch (e) {
        // Cancel failure is non-fatal — we still remove from the
        // widget. The next status poll will re-add it if the task
        // is somehow still alive on the server.
        console.warn('[TaskStatusWidget] cancel failed:', e);
      }
    }
    removeTaskById(task.taskId);
  }, []);

  // 无任务时不显示
  if (tasks.length === 0) {
    return null;
  }

  const processingCount = tasks.filter(
    t => !isTaskTerminal(t.displayStatus)
  ).length;
  const allTerminal = processingCount === 0;
  const failedCount = tasks.filter(t => t.displayStatus === 'failed').length;

  // Position styles based on inline prop
  const containerStyle: React.CSSProperties = inline
    ? {
        position: 'relative',
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
        @keyframes widget-progress-pulse {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1; }
        }
      `}</style>

      {!isExpanded ? (
        /* Collapsed pill — shares the same surface tokens as the
           Getting Started checklist so the bottom-right activity stack
           reads as one unified language. */
        <button
          onClick={() => setIsExpanded(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: ACTIVITY_WIDTH,
            minHeight: 38,
            padding: '8px 14px',
            background: ACTIVITY_BG,
            border: ACTIVITY_BORDER,
            borderRadius: 999,
            cursor: 'pointer',
            boxShadow: ACTIVITY_SHADOW,
            backdropFilter: 'blur(28px) saturate(160%)',
            WebkitBackdropFilter: 'blur(28px) saturate(160%)',
            position: 'relative',
            color: '#e4e4e7',
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

          <span style={{ ...activityTitleStyle, flex: 1, textAlign: 'left' }}>
            {processingCount > 0 ? `${processingCount} processing` : 'Done'}
          </span>
          <span style={{ color: '#71717a', fontSize: 11 }}>
            {tasks.length} {tasks.length === 1 ? 'item' : 'items'}
          </span>
        </button>
      ) : (
        /* 展开状态 */
        <div style={activityCardStyle}>
          {/* 头部 */}
          <div
            style={activityHeaderStyle}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
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
              <span style={activityTitleStyle}>
                {processingCount > 0 ? `${processingCount} processing` : 'Done'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
              {/* Collapse — always available */}
              <ActivityIconButton
                kind="collapse"
                title="Collapse"
                onClick={() => setIsExpanded(false)}
              />
              {/* Clear — only when every task has reached a terminal
                  state, so the user can never accidentally lose track
                  of an in-flight upload by clicking the wrong button. */}
              {allTerminal && (
                <ActivityIconButton
                  kind="close"
                  title="Clear all"
                  onClick={handleClear}
                />
              )}
            </div>
          </div>

          {/* Task list */}
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {tasks.map(task => (
              <TaskRow
                key={task.taskId}
                task={task}
                onRemove={() => handleRemoveTask(task)}
              />
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
function TaskRow({
  task,
  onRemove,
}: {
  task: TaskWithStatus;
  onRemove: () => void;
}) {
  const [hovered, setHovered] = useState(false);
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
      case 'finalizing':
        // Same palette family as ``processing`` — the user crossed
        // the "bytes uploaded" threshold so the row should advance
        // visually to the cool blue, signalling "the work is on
        // the server now, just waiting for it to land".
        return '#3b82f6';
      default:
        return '#3b82f6';
    }
  };

  const isProcessing = !isTaskTerminal(task.displayStatus);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
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

      {/* Filename + status */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: '#e4e4e7',
            fontSize: 13,
            lineHeight: '18px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {task.filename}
        </div>
        <div style={{ color: getStatusColor(), fontSize: 11, lineHeight: '16px', marginTop: 1 }}>
          {(() => {
            if (isSaasTask) return getSaasStatusText(task.displayStatus);
            if (
              task.displayStatus === 'uploading' &&
              typeof task.displayProgress === 'number'
            ) {
              return `Uploading ${task.displayProgress}%`;
            }
            if (task.displayStatus === 'finalizing') return 'Finalizing…';
            if (task.displayStatus === 'failed' && task.error) {
              return `Failed — ${task.error}`;
            }
            return getStatusDisplayText(
              task.displayStatus as ETLTaskStatus['status'] | 'uploading',
            );
          })()}
        </div>
        {/*
          Progress bar — drawn during ``uploading`` (real progress
          ticks 0..100 from XHR.upload.progress) AND during
          ``finalizing`` (a 100% solid bar with a subtle pulse to
          signal "byte transfer is done, waiting on the server"
          rather than abruptly removing the bar mid-task).
        */}
        {(task.displayStatus === 'uploading' ||
          task.displayStatus === 'finalizing') &&
          typeof task.displayProgress === 'number' && (
            <div
              style={{
                marginTop: 4,
                width: '100%',
                height: 3,
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width:
                    task.displayStatus === 'finalizing'
                      ? '100%'
                      : `${task.displayProgress}%`,
                  height: '100%',
                  background:
                    task.displayStatus === 'finalizing'
                      ? '#3b82f6'
                      : '#fbbf24',
                  transition: 'width 0.2s ease',
                  // Subtle pulse during finalize tells the user the
                  // server is actively working — without it, a static
                  // 100% bar reads as "stuck", which is exactly the
                  // bug we're fixing.
                  animation:
                    task.displayStatus === 'finalizing'
                      ? 'widget-progress-pulse 1.4s ease-in-out infinite'
                      : undefined,
                }}
              />
            </div>
          )}
      </div>

      {/* Per-row action — cancel for in-flight tasks, remove for done.
          Visible at low opacity always so the affordance is discoverable
          without being noisy; brightens on row hover. */}
      <button
        type="button"
        aria-label={isProcessing ? 'Cancel task' : 'Remove from list'}
        title={isProcessing ? 'Cancel' : 'Remove'}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          border: 'none',
          borderRadius: 5,
          background: 'transparent',
          cursor: 'pointer',
          color: hovered ? '#d4d4d8' : '#52525b',
          opacity: hovered ? 1 : 0.6,
          transition: 'color 0.12s ease, opacity 0.12s ease, background 0.12s ease',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {isProcessing ? (
          /* Stop square — communicates "halt the in-flight job". */
          <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
            <rect x="1.5" y="1.5" width="7" height="7" rx="1" />
          </svg>
        ) : (
          /* Cross — communicates "remove this row from the list". */
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </div>
  );
}

export default TaskStatusWidget;
