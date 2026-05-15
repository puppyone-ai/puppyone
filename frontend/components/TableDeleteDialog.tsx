'use client';

import { useMemo, useState } from 'react';
import type { ProjectInfo } from '../lib/projectsApi';
import { deleteTable } from '../lib/projectsApi';
import { refreshProjects } from '../lib/hooks/useData';
import { useOrganization } from '@/contexts/OrganizationContext';
import { Dots } from './loading';
import { ActionButton } from './ui/ActionButton';
import { DangerNotice } from './ui/DangerNotice';
import { DialogBody, DialogFooter, DialogHeader, DialogRoot, DialogSurface } from './ui/Dialog';

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
  const { currentOrg } = useOrganization();
  const table = useMemo(() => {
    const project = projects.find(p => String(p.id) === String(projectId));
    return project?.nodes?.find(t => String(t.id) === String(tableId)) ?? null;
  }, [projects, projectId, tableId]);

  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    try {
      setLoading(true);
      await deleteTable(projectId, tableId);
      await refreshProjects(currentOrg?.id);
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
    <DialogRoot onClose={onClose}>
      <DialogSurface width={480}>
        <DialogHeader title="Delete Context" onClose={onClose} />

        <DialogBody>
          <DangerNotice title={`Delete "${table?.name || 'this context'}"?`}>
            This will permanently delete the context and all data inside it.
            This action cannot be undone.
          </DangerNotice>
        </DialogBody>

        <DialogFooter>
          <ActionButton type='button' onClick={onClose}>
            Cancel
          </ActionButton>
          <ActionButton
            type='button'
            onClick={handleDelete}
            variant='danger'
            loading={loading}
          >
            {loading && <Dots size='xs' tone='danger' />}
            {loading ? 'Deleting…' : 'Delete Context'}
          </ActionButton>
        </DialogFooter>
      </DialogSurface>
    </DialogRoot>
  );
}
