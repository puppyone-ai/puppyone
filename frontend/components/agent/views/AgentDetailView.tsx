'use client';

import React, { useState, useEffect } from 'react';
import { useAgent, type SavedAgent } from '@/contexts/AgentContext';
import { get } from '@/lib/apiClient';

interface ExecutionLog {
  id: string;
  agent_id: string;
  trigger_type: string;
  status: 'running' | 'success' | 'failed';
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  output_summary?: string;
  error_message?: string;
}

interface AgentDetailViewProps {
  agent: SavedAgent;
}

// Icon components
const SettingsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const PauseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16"></rect>
    <rect x="14" y="4" width="4" height="16"></rect>
  </svg>
);

const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="5 3 19 12 5 21 5 3"></polygon>
  </svg>
);

const FolderIcon = () => (
  <svg width='14' height='14' viewBox='0 0 24 24' fill='none'>
    <path
      d='M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z'
      fill='currentColor'
      fillOpacity='0.15'
      stroke='currentColor'
      strokeWidth='1.5'
    />
  </svg>
);

const JsonIcon = () => (
  <svg width='14' height='14' viewBox='0 0 24 24' fill='none'>
    <rect x='3' y='3' width='18' height='18' rx='2' stroke='currentColor' strokeWidth='1.5' fill='currentColor' fillOpacity='0.08' />
    <path d='M3 9H21' stroke='currentColor' strokeWidth='1.5' />
    <path d='M9 3V21' stroke='currentColor' strokeWidth='1.5' />
  </svg>
);

const FileIcon = () => (
  <svg width='14' height='14' viewBox='0 0 24 24' fill='none'>
    <path
      d='M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z'
      stroke='currentColor'
      strokeWidth='1.5'
      fill='currentColor'
      fillOpacity='0.08'
    />
    <path d='M14 2V8H20' stroke='currentColor' strokeWidth='1.5' />
  </svg>
);

const getNodeIcon = (nodeType: string) => {
  switch (nodeType) {
    case 'folder': return { icon: <FolderIcon />, color: '#a1a1aa' };
    case 'json': return { icon: <JsonIcon />, color: '#34d399' };
    default: return { icon: <FileIcon />, color: '#60a5fa' };
  }
};

// 解析 cron 表达式
function parseScheduleInfo(triggerConfig: { schedule?: string; timezone?: string } | undefined): {
  time: string;
  date: string;
  repeatType: string;
} {
  if (!triggerConfig?.schedule) {
    return { time: '--:--', date: 'Not set', repeatType: 'Manual' };
  }

  const parts = triggerConfig.schedule.split(' ');
  if (parts.length < 5) {
    return { time: '--:--', date: 'Invalid', repeatType: 'Unknown' };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const timeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

  // 判断重复类型
  let repeatType = 'Once';
  if (dayOfMonth === '*' && dayOfWeek === '*') {
    repeatType = 'Daily';
  } else if (dayOfMonth === '*' && dayOfWeek !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    repeatType = `Weekly (${days[parseInt(dayOfWeek)] || dayOfWeek})`;
  }

  // 计算下次执行时间
  const now = new Date();
  let nextRunDate: Date;

  if (repeatType === 'Daily') {
    nextRunDate = new Date();
    nextRunDate.setHours(parseInt(hour), parseInt(minute), 0, 0);
    if (nextRunDate <= now) {
      nextRunDate.setDate(nextRunDate.getDate() + 1);
    }
  } else if (repeatType.startsWith('Weekly')) {
    const targetDay = parseInt(dayOfWeek);
    nextRunDate = new Date();
    nextRunDate.setHours(parseInt(hour), parseInt(minute), 0, 0);
    const currentDay = nextRunDate.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil < 0 || (daysUntil === 0 && nextRunDate <= now)) {
      daysUntil += 7;
    }
    nextRunDate.setDate(nextRunDate.getDate() + daysUntil);
  } else {
    // Once - 特定日期
    const targetMonth = parseInt(month) - 1;
    const targetDay = parseInt(dayOfMonth);
    nextRunDate = new Date(now.getFullYear(), targetMonth, targetDay, parseInt(hour), parseInt(minute));
    if (nextRunDate < now) {
      nextRunDate.setFullYear(nextRunDate.getFullYear() + 1);
    }
  }

  const dateStr = nextRunDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return { time: timeStr, date: dateStr, repeatType };
}

export function AgentDetailView({ agent }: AgentDetailViewProps) {
  const { editAgent, deleteAgent, closeSidebar } = useAgent();
  const [isPaused, setIsPaused] = useState(false);
  const [executions, setExecutions] = useState<ExecutionLog[]>([]);
  const [loadingExecutions, setLoadingExecutions] = useState(false);

  const isScheduleAgent = agent.type === 'schedule';

  // 获取执行历史
  const fetchExecutions = () => {
    if (isScheduleAgent && agent.id) {
      setLoadingExecutions(true);
      get<ExecutionLog[]>(`/agent-config/${agent.id}/executions?limit=10`)
        .then(res => {
          if (res && Array.isArray(res)) {
            setExecutions(res);
          }
        })
        .catch(err => {
          console.error('Failed to fetch executions:', err);
        })
        .finally(() => {
          setLoadingExecutions(false);
        });
    }
  };

  useEffect(() => {
    fetchExecutions();
  }, [agent.id, isScheduleAgent]);

  // 展开的执行记录
  const [expandedExecution, setExpandedExecution] = useState<string | null>(null);

  const handleEdit = () => {
    editAgent(agent.id);
  };

  const handleDelete = () => {
    if (confirm(`Delete "${agent.name}"? This cannot be undone.`)) {
      deleteAgent(agent.id);
      closeSidebar();
    }
  };

  const handleTogglePause = () => {
    setIsPaused(!isPaused);
    // TODO: 调用后端 API 暂停/恢复调度
  };

  const scheduleInfo = parseScheduleInfo(agent.trigger_config);

  // 解析 task content 为任务列表
  const tasks = agent.task_content ? agent.task_content.split('\n').filter(t => t.trim()) : [];

  const buttonStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#666',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: '#525252',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 8,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ 
        padding: '12px 16px', 
        borderBottom: '1px solid #222', 
        background: '#0d0d0d',
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        flexShrink: 0 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: '#666' }}>
            {agent.name}
          </span>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 6px',
            background: isPaused ? 'rgba(251, 191, 36, 0.1)' : 'rgba(74, 222, 128, 0.1)',
            border: isPaused ? '1px solid rgba(251, 191, 36, 0.2)' : '1px solid rgba(74, 222, 128, 0.2)',
            borderRadius: 4,
            fontSize: 10,
            color: isPaused ? '#fbbf24' : '#4ade80',
          }}>
            ● {isPaused ? 'Paused' : 'Active'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {isScheduleAgent && (
            <button 
              onClick={handleTogglePause} 
              title={isPaused ? "Resume schedule" : "Pause schedule"}
              style={buttonStyle}
              onMouseEnter={e => { e.currentTarget.style.color = isPaused ? '#4ade80' : '#fbbf24'; e.currentTarget.style.background = '#252525'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#666'; e.currentTarget.style.background = 'transparent'; }}
            >
              {isPaused ? <PlayIcon /> : <PauseIcon />}
            </button>
          )}
          <button 
            onClick={handleEdit} 
            title="Edit settings"
            style={buttonStyle}
            onMouseEnter={e => { e.currentTarget.style.color = '#aaa'; e.currentTarget.style.background = '#252525'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#666'; e.currentTarget.style.background = 'transparent'; }}
          >
            <SettingsIcon />
          </button>
          <button 
            onClick={handleDelete} 
            title="Delete"
            style={buttonStyle}
            onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#252525'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#666'; e.currentTarget.style.background = 'transparent'; }}
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16, color: '#e5e5e5' }}>
        
        {/* 1. Schedule - 紧凑单行显示 */}
        {isScheduleAgent && (
          <div style={{ marginBottom: 16 }}>
            <div style={sectionTitleStyle}>Schedule</div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              background: '#161616',
              border: '1px solid #2a2a2a',
              borderRadius: 6,
              fontSize: 13,
              color: '#a3a3a3',
            }}>
              <span style={{ color: '#e5e5e5', fontWeight: 500 }}>{scheduleInfo.time}</span>
              <span>·</span>
              <span>{scheduleInfo.date}</span>
              <span>·</span>
              <span style={{ 
                padding: '2px 6px', 
                background: '#252525', 
                borderRadius: 4,
                fontSize: 11,
              }}>
                {scheduleInfo.repeatType}
              </span>
            </div>
          </div>
        )}

        {/* 2. Tasks - 任务列表 */}
        {isScheduleAgent && (
          <div style={{ marginBottom: 16 }}>
            <div style={sectionTitleStyle}>Tasks</div>
            {tasks.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {tasks.map((task, index) => (
                  <div
                    key={index}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 12px',
                      background: '#161616',
                      border: '1px solid #2a2a2a',
                      borderRadius: 6,
                    }}
                  >
                    <span style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: '#252525',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      color: '#737373',
                      flexShrink: 0,
                    }}>
                      {index + 1}
                    </span>
                    <span style={{ fontSize: 13, color: '#d4d4d4', lineHeight: 1.4 }}>
                      {task}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                padding: '12px',
                background: '#161616',
                border: '1px solid #2a2a2a',
                borderRadius: 6,
                color: '#525252',
                fontSize: 13,
                textAlign: 'center',
              }}>
                No tasks configured. Click ⚙️ to add tasks.
              </div>
            )}
          </div>
        )}

        {/* 3. Execution History */}
        {isScheduleAgent && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={sectionTitleStyle}>Execution History</div>
              <button
                onClick={fetchExecutions}
                disabled={loadingExecutions}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: loadingExecutions ? 'not-allowed' : 'pointer',
                  color: '#525252',
                  padding: 4,
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onMouseEnter={e => { if (!loadingExecutions) e.currentTarget.style.color = '#a3a3a3'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#525252'; }}
                title="Refresh"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: loadingExecutions ? 0.5 : 1 }}>
                  <path d="M21 2v6h-6"></path>
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
                  <path d="M3 22v-6h6"></path>
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
                </svg>
              </button>
            </div>
            {loadingExecutions ? (
              <div style={{
                padding: '12px',
                background: '#161616',
                border: '1px solid #2a2a2a',
                borderRadius: 6,
                textAlign: 'center',
                color: '#525252',
                fontSize: 13,
              }}>
                Loading...
              </div>
            ) : executions.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {executions.map((exec) => {
                  const startedAt = new Date(exec.started_at);
                  const timeStr = startedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                  const dateStr = startedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  const statusColor = exec.status === 'success' ? '#4ade80' : exec.status === 'failed' ? '#ef4444' : '#fbbf24';
                  const statusIcon = exec.status === 'success' ? '✓' : exec.status === 'failed' ? '✗' : '●';
                  const isExpanded = expandedExecution === exec.id;
                  
                  return (
                    <div key={exec.id}>
                      <div
                        onClick={() => setExpandedExecution(isExpanded ? null : exec.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          background: '#161616',
                          border: '1px solid #2a2a2a',
                          borderRadius: isExpanded ? '6px 6px 0 0' : 6,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ 
                            color: '#525252', 
                            fontSize: 10, 
                            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                            transition: 'transform 0.15s ease',
                          }}>▶</span>
                          <span style={{ color: statusColor, fontSize: 12 }}>{statusIcon}</span>
                          <span style={{ fontSize: 12, color: '#a3a3a3' }}>{dateStr} {timeStr}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {exec.duration_ms && (
                            <span style={{ fontSize: 11, color: '#525252' }}>
                              {exec.duration_ms < 1000 ? `${exec.duration_ms}ms` : `${(exec.duration_ms / 1000).toFixed(1)}s`}
                            </span>
                          )}
                          <span style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            background: exec.status === 'success' ? 'rgba(74, 222, 128, 0.1)' : exec.status === 'failed' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(251, 191, 36, 0.1)',
                            border: `1px solid ${exec.status === 'success' ? 'rgba(74, 222, 128, 0.2)' : exec.status === 'failed' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(251, 191, 36, 0.2)'}`,
                            borderRadius: 4,
                            color: statusColor,
                            textTransform: 'capitalize',
                          }}>
                            {exec.status}
                          </span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{
                          padding: '10px 12px',
                          background: '#0f0f0f',
                          border: '1px solid #2a2a2a',
                          borderTop: 'none',
                          borderRadius: '0 0 6px 6px',
                          fontSize: 12,
                        }}>
                          {exec.error_message ? (
                            <div style={{ color: '#ef4444' }}>
                              <div style={{ fontWeight: 500, marginBottom: 4 }}>Error:</div>
                              <pre style={{ 
                                margin: 0, 
                                whiteSpace: 'pre-wrap', 
                                wordBreak: 'break-word',
                                fontFamily: 'monospace',
                                fontSize: 11,
                                color: '#f87171',
                              }}>
                                {exec.error_message}
                              </pre>
                            </div>
                          ) : exec.output_summary ? (
                            <div>
                              <div style={{ color: '#737373', fontWeight: 500, marginBottom: 4 }}>Output:</div>
                              <pre style={{ 
                                margin: 0, 
                                whiteSpace: 'pre-wrap', 
                                wordBreak: 'break-word',
                                fontFamily: 'monospace',
                                fontSize: 11,
                                color: '#d4d4d4',
                                maxHeight: 200,
                                overflow: 'auto',
                              }}>
                                {exec.output_summary}
                              </pre>
                            </div>
                          ) : (
                            <div style={{ color: '#525252', fontStyle: 'italic' }}>
                              No output recorded
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{
                padding: '12px',
                background: '#161616',
                border: '1px solid #2a2a2a',
                borderRadius: 6,
                textAlign: 'center',
                color: '#525252',
                fontSize: 13,
              }}>
                No runs yet
              </div>
            )}
          </div>
        )}

        {/* 4. Data Access */}
        <div style={{ marginBottom: 16 }}>
          <div style={sectionTitleStyle}>Data Access</div>
          {agent.resources && agent.resources.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {agent.resources.map((resource) => {
                const { icon, color } = getNodeIcon(resource.nodeType);
                return (
                  <div
                    key={resource.nodeId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      background: '#161616',
                      border: '1px solid #2a2a2a',
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ color }}>{icon}</div>
                      <span style={{ fontSize: 13 }}>{resource.nodeName}</span>
                    </div>
                    <span style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      background: resource.terminalReadonly ? '#1a1a1a' : 'rgba(251, 191, 36, 0.1)',
                      border: resource.terminalReadonly ? '1px solid #2a2a2a' : '1px solid rgba(251, 191, 36, 0.2)',
                      borderRadius: 4,
                      color: resource.terminalReadonly ? '#737373' : '#fbbf24',
                    }}>
                      {resource.terminalReadonly ? 'Read' : 'Edit'}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{
              padding: '12px',
              background: '#161616',
              border: '1px solid #2a2a2a',
              borderRadius: 6,
              color: '#525252',
              fontSize: 13,
              textAlign: 'center',
            }}>
              No data access configured
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
