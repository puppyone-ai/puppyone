'use client';

import { useState, useEffect } from 'react';
import type { ProjectInfo, ProjectTemplateInfo } from '../lib/projectsApi';
import {
  createProject,
  updateProject,
  deleteProject,
  getProjectTemplates,
} from '../lib/projectsApi';
import { refreshProjects } from '../lib/hooks/useData';
import { useOrganization } from '@/contexts/OrganizationContext';

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
}: ProjectManageDialogProps) {
  const { currentOrg } = useOrganization();
  const project = projectId ? projects.find(p => p.id === projectId) : null;

  const [name, setName] = useState(project?.name || '');
  const [description] = useState(project?.description || '');
  const [loading, setLoading] = useState(false);

  const [templates, setTemplates] = useState<ProjectTemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('blank');

  useEffect(() => {
    if (project) {
      setName(project.name);
    }
  }, [project]);

  useEffect(() => {
    if (mode === 'create') {
      getProjectTemplates().then(setTemplates).catch(console.error);
    }
  }, [mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    let finalName = name.trim();
    if (!finalName) {
      if (selectedTemplate !== 'blank') {
        finalName = templates.find(t => t.id === selectedTemplate)?.name || 'Untitled Project';
      } else {
        finalName = 'Untitled Project';
      }
    }

    try {
      setLoading(true);
      if (mode === 'edit' && projectId) {
        await updateProject(projectId, finalName, description);
      } else {
        await createProject(
          finalName, 
          '', 
          currentOrg?.id, 
          false, 
          selectedTemplate === 'blank' ? undefined : selectedTemplate
        );
      }
      await refreshProjects(currentOrg?.id);
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
      await refreshProjects(currentOrg?.id);
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
            from { opacity: 0; transform: scale(0.98); }
            to { opacity: 1; transform: scale(1); }
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
          <div style={{ fontSize: 16, fontWeight: 500, color: '#eee' }}>
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
              color: '#888',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
              <line x1='18' y1='6' x2='6' y2='18' />
              <line x1='6' y1='6' x2='18' y2='18' />
            </svg>
          </button>
        </div>

        {mode === 'delete' ? (
          <div>
            <div style={{ padding: '24px' }}>
              <p style={{ color: '#eee', marginBottom: 8, fontSize: 14 }}>
                Are you sure you want to delete project "{project?.name}"?
              </p>
              <p style={{ color: '#888', fontSize: 14, lineHeight: '1.5' }}>
                This will permanently delete the project and all contexts inside
                it. This action cannot be undone.
              </p>
            </div>
            <div
              style={{
                padding: '16px 24px',
                background: '#1a1a1a',
                borderTop: '1px solid #333',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 12,
              }}
            >
              <button onClick={onClose} style={buttonStyle(false)}>Cancel</button>
              <button
                onClick={handleDelete}
                disabled={loading}
                style={{
                  ...buttonStyle(true),
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                }}
              >
                {loading ? 'Deleting...' : 'Delete Project'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
              
              {mode === 'create' && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#eee', marginBottom: 12 }}>
                    Start from a template
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div
                      onClick={() => setSelectedTemplate('blank')}
                      style={{
                        padding: '12px',
                        borderRadius: 8,
                        border: selectedTemplate === 'blank' ? '1px solid #EDEDED' : '1px solid #333',
                        background: selectedTemplate === 'blank' ? 'rgba(255,255,255,0.05)' : '#1a1a1a',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#eee' }}>Blank Project</div>
                      <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Start from scratch</div>
                    </div>
                    {templates.map(t => (
                      <div
                        key={t.id}
                        onClick={() => setSelectedTemplate(t.id)}
                        style={{
                          padding: '12px',
                          borderRadius: 8,
                          border: selectedTemplate === t.id ? '1px solid #EDEDED' : '1px solid #333',
                          background: selectedTemplate === t.id ? 'rgba(255,255,255,0.05)' : '#1a1a1a',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 500, color: '#eee' }}>{t.name}</div>
                        <div style={{ fontSize: 12, color: '#888', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#eee' }}>Project Name</span>
                  <span style={{ fontSize: 12, color: '#888' }}>Optional</span>
                </div>
                <input
                  type='text'
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={
                    selectedTemplate !== 'blank' 
                      ? templates.find(t => t.id === selectedTemplate)?.name || 'Untitled Project'
                      : 'Untitled Project'
                  }
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: 6,
                    fontSize: 14,
                    color: '#eee',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => e.target.style.borderColor = '#666'}
                  onBlur={e => e.target.style.borderColor = '#333'}
                  autoFocus
                />
              </div>
            </div>

            <div
              style={{
                padding: '16px 24px',
                background: '#1a1a1a',
                borderTop: '1px solid #333',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 12,
              }}
            >
              <button type='button' onClick={onClose} style={buttonStyle(false)}>
                Cancel
              </button>
              <button type='submit' disabled={loading} style={buttonStyle(true)}>
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
  height: 36,
  padding: '0 16px',
  borderRadius: 6,
  border: primary ? 'none' : '1px solid #333',
  background: primary ? '#EDEDED' : 'transparent',
  color: primary ? '#0a0a0a' : '#eee',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
});
