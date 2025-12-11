'use client'

import { useState, useEffect } from 'react'
import type { ProjectInfo } from '../lib/projectsApi'
import { createProject, updateProject, deleteProject } from '../lib/projectsApi'
import { refreshProjects } from '../lib/hooks/useData'

type ProjectManageDialogProps = {
  projectId: string | null
  projects: ProjectInfo[]
  onClose: () => void
  onProjectsChange?: (projects: ProjectInfo[]) => void  // 保留接口兼容
  deleteMode?: boolean
}

export function ProjectManageDialog({
  projectId,
  projects,
  onClose,
  deleteMode = false,
}: ProjectManageDialogProps) {
  const isEdit = projectId !== null
  const project = isEdit ? projects.find((p) => p.id === projectId) : null

  const [name, setName] = useState(project?.name || '')
  const [description, setDescription] = useState(project?.description || '')
  const [loading, setLoading] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(deleteMode)

  useEffect(() => {
    if (project) {
      setName(project.name)
      setDescription(project.description || '')
    }
  }, [project])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    try {
      setLoading(true)
      if (isEdit && projectId) {
        await updateProject(projectId, name.trim(), description.trim() || undefined)
      } else {
        await createProject(name.trim(), description.trim() || undefined)
      }
      // 使用 SWR 刷新项目列表
      await refreshProjects()
      onClose()
    } catch (error) {
      console.error('Failed to save project:', error)
      alert('Operation failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!projectId) return

    try {
      setLoading(true)
      await deleteProject(projectId)
      // 使用 SWR 刷新项目列表
      await refreshProjects()
      onClose()
    } catch (error) {
      console.error('Failed to delete project:', error)
      alert('Delete failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setLoading(false)
      setShowDeleteConfirm(false)
    }
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
          background: '#1a1a1a',
          border: '1px solid rgba(46,46,46,0.85)',
          borderRadius: 8,
          padding: 24,
          minWidth: 400,
          maxWidth: 500,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 20px 0', color: '#EDEDED', fontSize: 18 }}>
          {isEdit ? 'Edit Project' : 'New Project'}
        </h2>

        {showDeleteConfirm ? (
          <div>
            <p style={{ color: '#EDEDED', marginBottom: 20 }}>
              Are you sure you want to delete project "{project?.name}"? This action cannot be undone.
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
                {loading ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: 8,
                  color: '#9FA4B1',
                  fontSize: 12,
                }}
              >
                Project Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter project name"
                required
                style={inputStyle}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: 8,
                  color: '#9FA4B1',
                  fontSize: 12,
                }}
              >
                Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter project description"
                rows={3}
                style={inputStyle}
              />
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              {isEdit && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  style={buttonStyle(false, true)}
                >
                  Delete
                </button>
              )}
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
                {loading ? 'Saving...' : isEdit ? 'Save' : 'Create'}
              </button>
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
  background: '#0a0a0a',
  border: '1px solid rgba(46,46,46,0.85)',
  borderRadius: 6,
  color: '#EDEDED',
  fontSize: 13,
  fontFamily: 'inherit',
}

const buttonStyle = (primary: boolean, danger = false): React.CSSProperties => ({
  padding: '8px 16px',
  borderRadius: 6,
  border: danger
    ? '1px solid rgba(239,68,68,0.4)'
    : primary
    ? '1px solid rgba(138,43,226,0.4)'
    : '1px solid rgba(46,46,46,0.85)',
  background: danger
    ? 'rgba(239,68,68,0.15)'
    : primary
    ? 'rgba(138,43,226,0.22)'
    : 'rgba(10,10,10,0.6)',
  color: danger ? '#ef4444' : primary ? '#8A2BE2' : '#EDEDED',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
})

