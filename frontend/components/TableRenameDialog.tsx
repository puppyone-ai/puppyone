'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { ProjectInfo } from '../lib/projectsApi';
import { updateTable } from '../lib/projectsApi';
import { refreshProjects } from '../lib/hooks/useData';
import { useOrganization } from '@/contexts/OrganizationContext';
import { Dots } from './loading';
import { ActionButton } from './ui/ActionButton';
import { DialogBody, DialogFooter, DialogHeader, DialogRoot, DialogSurface } from './ui/Dialog';
import { Field, TextField } from './ui/Field';

type TableRenameDialogProps = {
  projectId: string;
  tableId: string;
  projects: ProjectInfo[];
  onClose: () => void;
};

export function TableRenameDialog({
  projectId,
  tableId,
  projects,
  onClose,
}: TableRenameDialogProps) {
  const { currentOrg } = useOrganization();
  void projects;
  void projectId;
  const tableName = tableId.split('/').filter(Boolean).pop() || tableId;

  const [name, setName] = useState(tableName);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tableName) setName(tableName);
  }, [tableName]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      setLoading(true);
      await updateTable(projectId, tableId, name.trim());
      await refreshProjects(currentOrg?.id);
      onClose();
    } catch (error) {
      console.error('Failed to rename table:', error);
      alert(
        'Operation failed: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogRoot onClose={onClose}>
      <DialogSurface width={480}>
        <DialogHeader title="Rename Context" onClose={onClose} />
        <form onSubmit={handleSubmit}>
          <DialogBody>
            <Field label="Context Name">
              <TextField
                type='text'
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={tableName || 'Enter context name'}
                autoFocus
              />
            </Field>
          </DialogBody>

          <DialogFooter>
            <ActionButton type='button' onClick={onClose}>
              Cancel
            </ActionButton>
            <ActionButton
              type='submit'
              disabled={loading || !name.trim()}
              variant='primary'
              loading={loading}
            >
              {loading && <Dots size='xs' />}
              {loading ? 'Saving…' : 'Save Changes'}
            </ActionButton>
          </DialogFooter>
        </form>
      </DialogSurface>
    </DialogRoot>
  );
}
