'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'
import { batchGetETLTaskStatus, type ETLTaskStatus } from '../lib/etlApi'

interface ParsingContentViewProps {
  onBack: () => void
}

export function ParsingContentView({ onBack }: ParsingContentViewProps) {
  const { session } = useAuth()
  const [tasks, setTasks] = useState<ETLTaskStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState<ETLTaskStatus | null>(null)

  useEffect(() => {
    if (!session) return

    const loadTasks = async () => {
      try {
        // Load from localStorage
        const pendingTasksStr = localStorage.getItem('etl_pending_tasks')
        if (pendingTasksStr) {
          const pendingTasks = JSON.parse(pendingTasksStr) as Array<{ taskId: number }>
          const taskIds = pendingTasks.map(t => t.taskId)
          
          if (taskIds.length > 0) {
            const response = await batchGetETLTaskStatus(taskIds, session.access_token)
            setTasks(response.tasks)
          }
        }
      } catch (error) {
        console.error('Failed to load tasks:', error)
      } finally {
        setLoading(false)
      }
    }

    loadTasks()

    // Poll every 3 seconds
    const interval = setInterval(loadTasks, 3000)
    return () => clearInterval(interval)
  }, [session])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#10B981'
      case 'failed':
        return '#EF4444'
      case 'mineru_parsing':
      case 'llm_processing':
        return '#3B82F6'
      default:
        return '#F59E0B'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )
      case 'failed':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 6L6 10M6 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )
      case 'mineru_parsing':
      case 'llm_processing':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="spinner">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25"/>
            <path d="M15 8a7 7 0 01-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )
      default:
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.5"/>
            <circle cx="8" cy="8" r="3" fill="currentColor"/>
          </svg>
        )
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      'pending': 'Pending',
      'mineru_parsing': 'Parsing',
      'llm_processing': 'Processing',
      'completed': 'Completed',
      'failed': 'Failed',
    }
    return labels[status] || status
  }

  return (
    <div style={styles.container}>
      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .spinner {
          animation: spin 0.8s linear infinite;
        }
      `}</style>

      {/* Header */}
      <div style={styles.header}>
        <button
          style={styles.backButton}
          onClick={onBack}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#2C2C2C'
            e.currentTarget.style.color = '#CDCDCD'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#6D7177'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span style={styles.title}>Parsing Tasks</span>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {loading ? (
          <div style={styles.emptyState}>
            <div className="spinner" style={{ width: 24, height: 24, border: '3px solid #404040', borderTopColor: '#8B8B8B', borderRadius: '50%' }} />
          </div>
        ) : tasks.length === 0 ? (
          <div style={styles.emptyState}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ color: '#404040' }}>
              <path d="M8 8l12 12-12 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M28 8l12 12-12 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p style={styles.emptyText}>No parsing tasks</p>
            <p style={styles.emptyHint}>Upload folders with binary files to see parsing tasks here</p>
          </div>
        ) : (
          <div style={styles.taskList}>
            {tasks.map((task) => (
              <div
                key={task.task_id}
                style={{
                  ...styles.taskCard,
                  ...(selectedTask?.task_id === task.task_id ? styles.taskCardSelected : {}),
                }}
                onClick={() => setSelectedTask(task)}
              >
                <div style={styles.taskHeader}>
                  <div style={styles.taskHeaderLeft}>
                    <div style={{ ...styles.statusIcon, color: getStatusColor(task.status) }}>
                      {getStatusIcon(task.status)}
                    </div>
                    <div style={styles.taskInfo}>
                      <div style={styles.filename}>{task.filename}</div>
                      <div style={styles.taskMeta}>
                        Task #{task.task_id} · Project {task.project_id}
                      </div>
                    </div>
                  </div>
                  <div style={{ ...styles.statusBadge, backgroundColor: `${getStatusColor(task.status)}15`, color: getStatusColor(task.status) }}>
                    {getStatusLabel(task.status)}
                  </div>
                </div>

                {task.progress > 0 && task.status !== 'completed' && task.status !== 'failed' && (
                  <div style={styles.progressBar}>
                    <div style={{ ...styles.progressFill, width: `${task.progress}%`, backgroundColor: getStatusColor(task.status) }} />
                  </div>
                )}

                <div style={styles.taskFooter}>
                  <div style={styles.timestamp}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: '#6D7177' }}>
                      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1"/>
                      <path d="M6 3v3l2 2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                    <span>Created {formatDate(task.created_at)}</span>
                  </div>
                  {task.error && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: '#EF4444' }}>
                      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1"/>
                      <path d="M6 3v3M6 8v.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                  )}
                </div>

                {task.error && (
                  <div style={styles.errorMessage}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2"/>
                      <path d="M7 4v3M7 9v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                    <span>{task.error}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Detail Panel */}
        {selectedTask && (
          <div style={styles.detailPanel}>
            <div style={styles.detailHeader}>
              <h3 style={styles.detailTitle}>Task Details</h3>
              <button
                style={styles.closeButton}
                onClick={() => setSelectedTask(null)}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M11 3L3 11M3 3l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            <div style={styles.detailContent}>
              <div style={styles.detailSection}>
                <div style={styles.detailLabel}>Filename</div>
                <div style={styles.detailValue}>{selectedTask.filename}</div>
              </div>

              <div style={styles.detailSection}>
                <div style={styles.detailLabel}>Status</div>
                <div style={{ ...styles.statusBadge, backgroundColor: `${getStatusColor(selectedTask.status)}15`, color: getStatusColor(selectedTask.status), display: 'inline-flex' }}>
                  {getStatusLabel(selectedTask.status)}
                </div>
              </div>

              <div style={styles.detailSection}>
                <div style={styles.detailLabel}>Progress</div>
                <div style={styles.detailValue}>{selectedTask.progress}%</div>
              </div>

              <div style={styles.detailSection}>
                <div style={styles.detailLabel}>Task ID</div>
                <div style={styles.detailValue}>#{selectedTask.task_id}</div>
              </div>

              <div style={styles.detailSection}>
                <div style={styles.detailLabel}>Project ID</div>
                <div style={styles.detailValue}>{selectedTask.project_id}</div>
              </div>

              <div style={styles.detailSection}>
                <div style={styles.detailLabel}>Rule ID</div>
                <div style={styles.detailValue}>{selectedTask.rule_id}</div>
              </div>

              <div style={styles.detailSection}>
                <div style={styles.detailLabel}>Created At</div>
                <div style={styles.detailValue}>{formatDate(selectedTask.created_at)}</div>
              </div>

              <div style={styles.detailSection}>
                <div style={styles.detailLabel}>Updated At</div>
                <div style={styles.detailValue}>{formatDate(selectedTask.updated_at)}</div>
              </div>

              {selectedTask.metadata && Object.keys(selectedTask.metadata).length > 0 && (
                <div style={styles.detailSection}>
                  <div style={styles.detailLabel}>Metadata</div>
                  <pre style={styles.metadataCode}>
                    {JSON.stringify(selectedTask.metadata, null, 2)}
                  </pre>
                </div>
              )}

              {selectedTask.error && (
                <div style={styles.detailSection}>
                  <div style={styles.detailLabel}>Error Message</div>
                  <div style={{ ...styles.detailValue, color: '#EF4444' }}>
                    {selectedTask.error}
                  </div>
                </div>
              )}

              {selectedTask.result && (
                <div style={styles.detailSection}>
                  <div style={styles.detailLabel}>Result</div>
                  <pre style={styles.metadataCode}>
                    {JSON.stringify(selectedTask.result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    color: '#E0E0E0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  header: {
    height: 44,
    borderBottom: '1px solid #262626',
    padding: '0 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
  },
  backButton: {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    color: '#6D7177',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  title: {
    fontSize: 13,
    fontWeight: 500,
    color: '#CDCDCD',
  },
  content: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  taskList: {
    flex: 1,
    padding: 24,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  taskCard: {
    background: '#111111',
    border: '1px solid #2a2a2a',
    borderRadius: 8,
    padding: 16,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  taskCardSelected: {
    borderColor: '#3B82F6',
    background: '#1a1a1a',
  },
  taskHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  taskHeaderLeft: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  statusIcon: {
    flexShrink: 0,
    marginTop: 2,
  },
  taskInfo: {
    flex: 1,
    minWidth: 0,
  },
  filename: {
    fontSize: 14,
    fontWeight: 500,
    color: '#EDEDED',
    marginBottom: 4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  taskMeta: {
    fontSize: 12,
    color: '#6D7177',
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: 500,
    padding: '4px 8px',
    borderRadius: 4,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap',
  },
  progressBar: {
    height: 4,
    background: '#0a0a0a',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.3s ease',
    borderRadius: 2,
  },
  taskFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timestamp: {
    fontSize: 11,
    color: '#6D7177',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  errorMessage: {
    marginTop: 12,
    padding: 12,
    background: '#2a1a1a',
    border: '1px solid #4a2a2a',
    borderRadius: 6,
    fontSize: 12,
    color: '#FCA5A5',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: 500,
    color: '#9CA3AF',
    margin: '8px 0 0 0',
  },
  emptyHint: {
    fontSize: 13,
    color: '#6D7177',
    margin: '4px 0 0 0',
    maxWidth: 400,
    textAlign: 'center',
  },
  detailPanel: {
    width: 400,
    borderLeft: '1px solid #2a2a2a',
    display: 'flex',
    flexDirection: 'column',
    background: '#0a0a0a',
  },
  detailHeader: {
    height: 56,
    padding: '0 20px',
    borderBottom: '1px solid #2a2a2a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#EDEDED',
    margin: 0,
  },
  closeButton: {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: '#6D7177',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  detailContent: {
    flex: 1,
    padding: 20,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  detailSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#6D7177',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  detailValue: {
    fontSize: 13,
    color: '#E0E0E0',
    wordBreak: 'break-word',
  },
  metadataCode: {
    fontSize: 11,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#9CA3AF',
    background: '#000000',
    border: '1px solid #2a2a2a',
    borderRadius: 4,
    padding: 12,
    margin: 0,
    overflow: 'auto',
    maxHeight: 200,
  },
}

