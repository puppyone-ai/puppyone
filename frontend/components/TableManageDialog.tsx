'use client'

import { useState, useEffect } from 'react'
import type { ProjectInfo } from '../lib/projectsApi'
import { createTable, updateTable, deleteTable } from '../lib/projectsApi'
import { refreshProjects } from '../lib/hooks/useData'

type TableManageDialogProps = {
  projectId: string
  tableId: string | null
  projects: ProjectInfo[]
  onClose: () => void
  onProjectsChange?: (projects: ProjectInfo[]) => void  // 保留接口兼容
  deleteMode?: boolean
}

export function TableManageDialog({
  projectId,
  tableId,
  projects,
  onClose,
  deleteMode = false,
}: TableManageDialogProps) {
  const isEdit = tableId !== null
  const project = projects.find((p) => p.id === projectId)
  const table = isEdit && project ? project.tables.find((t) => t.id === tableId) : null

  const [name, setName] = useState(table?.name || '')
  const [loading, setLoading] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(deleteMode)

  useEffect(() => {
    if (table) {
      setName(table.name)
    }
  }, [table])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    try {
      setLoading(true)
      if (isEdit && tableId) {
        await updateTable(projectId, tableId, name.trim())
      } else {
        await createTable(projectId, name.trim(), [])
      }
      // 使用 SWR 刷新项目列表
      await refreshProjects()
      onClose()
    } catch (error) {
      console.error('Failed to save table:', error)
      alert('Operation failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!tableId) return

    try {
      setLoading(true)
      await deleteTable(projectId, tableId)
      // 使用 SWR 刷新项目列表
      await refreshProjects()
      onClose()
    } catch (error) {
      console.error('Failed to delete table:', error)
      alert('Delete failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setLoading(false)
      setShowDeleteConfirm(false)
    }
  }

  if (!project) {
    return null
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#202020',
          border: '1px solid #333',
          borderRadius: 12,
          width: 640,
          maxWidth: '90vw',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4), 0 12px 24px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'dialog-fade-in 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style jsx>{`
          @keyframes dialog-fade-in {
            from { opacity: 0; transform: scale(0.98); }
            to { opacity: 1; transform: scale(1); }
          }
          .option-card {
            padding: 12px;
            background: #252525;
            border: 1px solid #333;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 12px;
            height: 100%;
          }
          .option-card:hover {
            background: #2A2A2A;
            border-color: #404040;
            transform: translateY(-1px);
          }
          .option-card.active {
            border-color: #3b82f6;
            background: rgba(59, 130, 246, 0.1);
          }
          
          .start-option {
            padding: 12px;
            background: transparent;
            border: 1px solid #333;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 12px;
            height: 100%;
          }
          .start-option:hover {
            background: #2A2A2A;
            border-color: #404040;
          }
          .start-option.active {
            border-color: #3b82f6;
            background: rgba(59, 130, 246, 0.1);
          }
        `}</style>

        {/* Header - Notion Style "Add to..." */}
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#202020',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#888' }}>
            <span>Add to</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#E1E1E1', fontWeight: 500, background: '#2A2A2A', padding: '2px 8px', borderRadius: 4 }}>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <path d="M1 4C1 3.44772 1.44772 3 2 3H5.17157C5.43679 3 5.69114 3.10536 5.87868 3.29289L6.70711 4.12132C6.89464 4.30886 7.149 4.41421 7.41421 4.41421H12C12.5523 4.41421 13 4.86193 13 5.41421V11C13 11.5523 12.5523 12 12 12H2C1.44772 12 1 11.5523 1 11V4Z" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
              {project.name}
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', padding: 4, display: 'flex' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M11 3L3 11M3 3L11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {showDeleteConfirm ? (
          <div style={{ padding: 32 }}>
            <h3 style={{ color: '#EDEDED', margin: '0 0 12px', fontSize: 18 }}>Delete Context?</h3>
            <p style={{ color: '#9FA4B1', marginBottom: 24, fontSize: 14, lineHeight: 1.5 }}>
              Are you sure you want to delete context <strong style={{ color: '#EDEDED' }}>{table?.name}</strong>? 
              <br/>This action cannot be undone and all data will be lost.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                style={buttonStyle(false)}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                style={buttonStyle(true, true)}
              >
                {loading ? 'Deleting...' : 'Delete Context'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '32px' }}>
              {/* Large Title Input */}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Context Name"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  fontSize: 24,
                  fontWeight: 600,
                  color: '#EDEDED',
                  padding: 0,
                  outline: 'none',
                  marginBottom: 32,
                  boxSizing: 'border-box',
                }}
                autoFocus
              />

              {/* Data Source Selection */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#666', marginBottom: 12, letterSpacing: '0.02em' }}>
                  Start with
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  
                  {/* Option 1: Empty (Scratchpad) */}
                  <div className="start-option active">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: '#9ca3af' }}>
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="12" y1="8" x2="12" y2="16" />
                      <line x1="8" y1="12" x2="16" y2="12" />
                    </svg>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#EDEDED' }}>Empty</div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>Start from scratch</div>
                    </div>
                  </div>

                  {/* Option 2: Documents (The NotebookLM angle) */}
                  <div className="start-option" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: '#9ca3af' }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#EDEDED' }}>Documents</div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>PDF, MD, CSV</div>
                    </div>
                  </div>

                  {/* Option 3: Connectors (The Agentic angle) */}
                  <div className="start-option" style={{ opacity: 0.5, cursor: 'not-allowed' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: '#9ca3af' }}>
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#EDEDED' }}>Connect App</div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>Notion, Linear...</div>
                    </div>
                  </div>

                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ 
              padding: '16px 20px', 
              borderTop: '1px solid #333', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              background: '#202020' 
            }}>
              {isEdit ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  style={{ ...buttonStyle(false, true), border: 'none', background: 'transparent', padding: 0 }}
                >
                  Delete context
                </button>
              ) : (
                <div /> /* Spacer */
              )}
              
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={buttonStyle(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !name.trim()}
                  style={buttonStyle(true)}
                >
                  {loading ? 'Creating...' : isEdit ? 'Save Changes' : 'Create Context'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: '#151515',
  border: '1px solid #333',
  borderRadius: 6,
  color: '#EDEDED',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  transition: 'border-color 0.15s',
}

const buttonStyle = (primary: boolean, danger = false): React.CSSProperties => ({
  height: '28px',
  padding: '0 12px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  border: '1px solid transparent',
  background: danger
    ? 'rgba(239,68,68,0.15)'
    : primary
    ? '#EDEDED'
    : 'rgba(255,255,255,0.05)',
  color: danger ? '#ef4444' : primary ? '#1a1a1a' : '#EDEDED',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'all 0.15s',
})

