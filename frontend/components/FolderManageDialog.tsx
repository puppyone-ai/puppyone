'use client';

import { useState } from 'react';
import { createFolder } from '../lib/contentNodesApi';

type FolderManageDialogProps = {
  projectId: string; // 所属项目 ID
  parentId: string | null; // 父文件夹 ID，null 表示项目根目录
  parentPath?: string; // 父文件夹路径，用于显示
  onClose: () => void;
  onSuccess?: () => void; // 创建成功后的回调
};

export function FolderManageDialog({
  projectId,
  parentId,
  parentPath = '/',
  onClose,
  onSuccess,
}: FolderManageDialogProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      setLoading(true);
      setError(null);
      await createFolder(name.trim(), projectId, parentId);
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Failed to create folder:', err);
      setError(err instanceof Error ? err.message : 'Failed to create folder');
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
          width: 420,
          maxWidth: '90vw',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg
              width='18'
              height='18'
              viewBox='0 0 24 24'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path
                d='M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z'
                fill='#a1a1aa'
                fillOpacity='0.2'
                stroke='#a1a1aa'
                strokeWidth='1.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
            <span style={{ fontSize: 16, fontWeight: 500, color: '#e4e4e7' }}>
              New Folder
            </span>
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

        <form onSubmit={handleSubmit}>
          <div style={{ padding: '24px 24px 16px' }}>
            {/* Location indicator */}
            <div
              style={{
                fontSize: 12,
                color: '#71717a',
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>Location:</span>
              <code
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: 11,
                }}
              >
                {parentPath}
              </code>
            </div>

            {/* Name input */}
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: '#71717a',
                marginBottom: 8,
              }}
            >
              Folder Name
            </div>
            <input
              type='text'
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder='Enter folder name'
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

            {/* Error message */}
            {error && (
              <div
                style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: 6,
                  color: '#ef4444',
                  fontSize: 16,
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: '16px 20px',
              background: '#1a1a1a',
              borderTop: '1px solid #333',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 12,
            }}
          >
            <button
              type='button'
              onClick={onClose}
              style={{
                height: 32,
                padding: '0 14px',
                borderRadius: 6,
                border: '1px solid #333',
                background: 'transparent',
                color: '#EDEDED',
                fontSize: 16,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type='submit'
              disabled={loading || !name.trim()}
              style={{
                height: 32,
                padding: '0 14px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.1)',
                background: loading || !name.trim() ? '#444' : '#EDEDED',
                color: loading || !name.trim() ? '#888' : '#1a1a1a',
                fontSize: 16,
                fontWeight: 500,
                cursor: loading || !name.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Creating...' : 'Create Folder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
