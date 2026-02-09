'use client';

import { useState, useEffect } from 'react';
import type { ProjectInfo } from '../lib/projectsApi';
import {
  createProject,
  updateProject,
  deleteProject,
} from '../lib/projectsApi';
import { refreshProjects } from '../lib/hooks/useData';

type DialogMode = 'create' | 'edit' | 'delete';

type ProjectManageDialogProps = {
  mode: DialogMode;
  projectId: string | null;
  projects: ProjectInfo[];
  onClose: () => void;
  onModeChange?: (mode: DialogMode) => void;
};

export function ProjectManageDialog({
  mode,
  projectId,
  projects,
  onClose,
  onModeChange,
}: ProjectManageDialogProps) {
  const project = projectId ? projects.find(p => p.id === projectId) : null;

  const [name, setName] = useState(project?.name || '');
  const [description] = useState(project?.description || '');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name);
    }
  }, [project]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      setLoading(true);
      if (mode === 'edit' && projectId) {
        await updateProject(projectId, name.trim(), description);
      } else {
        await createProject(name.trim(), '');
      }
      await refreshProjects();
      onClose();
    } catch (error) {
      console.error('Failed to save project:', error);
      alert(
        'Operation failed: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!projectId) return;

    try {
      setLoading(true);
      await deleteProject(projectId);
      await refreshProjects();
      onClose();
    } catch (error) {
      console.error('Failed to delete project:', error);
      alert(
        'Delete failed: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    } finally {
      setLoading(false);
    }
  };

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
          width: 480,
          maxWidth: '90vw',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4), 0 12px 24px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'dialog-fade-in 0.2s ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        <style jsx>{`
          @keyframes dialog-fade-in {
            from {
              opacity: 0;
              transform: scale(0.98);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}</style>

        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 500, color: '#666' }}>
            {mode === 'delete'
              ? 'Delete Project'
              : mode === 'edit'
                ? 'Edit Project'
                : 'New Project'}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <line x1='18' y1='6' x2='6' y2='18' />
              <line x1='6' y1='6' x2='18' y2='18' />
            </svg>
          </button>
        </div>

        {mode === 'delete' ? (
          <div>
            <div style={{ padding: '24px' }}>
              <p style={{ color: '#EDEDED', marginBottom: 8, fontSize: 14 }}>
                Are you sure you want to delete project "{project?.name}"?
              </p>
              <p style={{ color: '#9ca3af', fontSize: 16, lineHeight: '1.5' }}>
                This will permanently delete the project and all contexts inside
                it. This action cannot be undone.
              </p>
            </div>
            <div
              style={{
                padding: '16px 20px',
                background: '#202020',
                borderTop: '1px solid #333',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 12,
              }}
            >
              <button onClick={onClose} style={buttonStyle(false)}>
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                style={{
                  ...buttonStyle(true),
                  background: 'rgba(239,68,68,0.1)',
                  color: '#ef4444',
                  border: '1px solid rgba(239,68,68,0.2)',
                }}
              >
                {loading ? 'Deleting...' : 'Delete Project'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ padding: '24px 32px 32px' }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#666',
                  marginBottom: 8,
                }}
              >
                Project Name
              </div>
              <input
                type='text'
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder='Enter project name'
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: 6,
                  fontSize: 16,
                  color: '#EDEDED',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                autoFocus
              />
            </div>

            <div
              style={{
                padding: '16px 20px',
                background: '#202020',
                borderTop: '1px solid #333',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 12,
              }}
            >
              <button
                type='button'
                onClick={onClose}
                style={buttonStyle(false)}
              >
                Cancel
              </button>
              <button
                type='submit'
                disabled={loading || !name.trim()}
                style={buttonStyle(true)}
              >
                {loading
                  ? 'Saving...'
                  : mode === 'edit'
                    ? 'Save Changes'
                    : 'Create Project'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const buttonStyle = (primary: boolean): React.CSSProperties => ({
  height: 32,
  padding: '0 12px',
  borderRadius: 6,
  border: primary ? '1px solid rgba(255,255,255,0.1)' : '1px solid #333',
  background: primary ? '#EDEDED' : 'transparent',
  color: primary ? '#1a1a1a' : '#EDEDED',
  fontSize: 16,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.1s',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
});
