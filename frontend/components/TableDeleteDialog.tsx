'use client';

import { useMemo, useState } from 'react';
import type { ProjectInfo } from '../lib/projectsApi';
import { deleteTable } from '../lib/projectsApi';
import { refreshProjects } from '../lib/hooks/useData';

type TableDeleteDialogProps = {
  projectId: string;
  tableId: string;
  projects: ProjectInfo[];
  onClose: () => void;
};

export function TableDeleteDialog({
  projectId,
  tableId,
  projects,
  onClose,
}: TableDeleteDialogProps) {
  const table = useMemo(() => {
    const project = projects.find(p => String(p.id) === String(projectId));
    return project?.tables?.find(t => String(t.id) === String(tableId)) ?? null;
  }, [projects, projectId, tableId]);

  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    try {
      setLoading(true);
      await deleteTable(projectId, tableId);
      await refreshProjects();
      onClose();
    } catch (error) {
      console.error('Failed to delete table:', error);
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
          <div style={{ fontSize: 13, fontWeight: 500, color: '#666' }}>
            Delete Context
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

        <div style={{ padding: '24px' }}>
          <p style={{ color: '#EDEDED', marginBottom: 8, fontSize: 14 }}>
            Are you sure you want to delete context "
            {table?.name || 'this context'}
            "?
          </p>
          <p style={{ color: '#9ca3af', fontSize: 13, lineHeight: '1.5' }}>
            This will permanently delete the context and all data inside it.
            This action cannot be undone.
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
          <button type='button' onClick={onClose} style={buttonStyle(false)}>
            Cancel
          </button>
          <button
            type='button'
            onClick={handleDelete}
            disabled={loading}
            style={{
              ...buttonStyle(true),
              background: 'rgba(239,68,68,0.1)',
              color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.2)',
            }}
          >
            {loading ? 'Deleting...' : 'Delete Context'}
          </button>
        </div>
      </div>
    </div>
  );
}

const buttonStyle = (primary: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  borderRadius: 6,
  border: primary ? '1px solid rgba(255,255,255,0.1)' : '1px solid #333',
  background: primary ? '#EDEDED' : 'transparent',
  color: primary ? '#1a1a1a' : '#EDEDED',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.1s',
  fontFamily: 'inherit',
});
