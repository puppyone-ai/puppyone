'use client';

import { useState, type FormEvent } from 'react';
import { createFolder } from '../lib/contentTreeApi';
import { Dots } from './loading';
import { ActionButton } from './ui/ActionButton';
import { DangerNotice } from './ui/DangerNotice';
import { DialogBody, DialogFooter, DialogHeader, DialogRoot, DialogSurface } from './ui/Dialog';
import { Field, TextField } from './ui/Field';

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

  const handleSubmit = async (e: FormEvent) => {
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
    <DialogRoot onClose={onClose}>
      <DialogSurface width={420}>
        <DialogHeader
          title="New Folder"
          onClose={onClose}
          leading={
            <svg
              width='18'
              height='18'
              viewBox='0 0 24 24'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path
                d='M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z'
                fill='var(--po-text-muted)'
                fillOpacity='0.2'
                stroke='var(--po-text-muted)'
                strokeWidth='1.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
          }
        />

        <form onSubmit={handleSubmit}>
          <DialogBody>
            <div
              style={{
                fontSize: 12,
                color: 'var(--po-text-subtle)',
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>Location:</span>
              <code
                style={{
                  background: 'var(--po-hover)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: 11,
                }}
              >
                {parentPath}
              </code>
            </div>

            <Field label="Folder Name">
              <TextField
                type='text'
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder='Enter folder name'
                autoFocus
              />
            </Field>

            {error && (
              <DangerNotice compact style={{ marginTop: 12 }}>
                {error}
              </DangerNotice>
            )}
          </DialogBody>

          <DialogFooter>
            <ActionButton
              type='button'
              onClick={onClose}
            >
              Cancel
            </ActionButton>
            <ActionButton
              type='submit'
              disabled={loading || !name.trim()}
              variant='primary'
              loading={loading}
            >
              {loading && <Dots size='xs' />}
              {loading ? 'Creating…' : 'Create Folder'}
            </ActionButton>
          </DialogFooter>
        </form>
      </DialogSurface>
    </DialogRoot>
  );
}
