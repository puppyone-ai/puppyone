'use client';

import { useState, useRef, useCallback } from 'react';
import { mutate } from 'swr';
import { updateNode, deleteNode, moveNode, type NodeInfo } from '@/lib/contentNodesApi';
import { refreshAllContentNodes } from '@/lib/hooks/useData';
import { ensureExpanded } from '../components/views';

export function useNodeActions(projectId: string, currentFolderId: string | null) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [moveDialogTarget, setMoveDialogTarget] = useState<{ id: string; name: string } | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const [toolPanelTarget, setToolPanelTarget] = useState<{ id: string; name: string; type: string; jsonPath?: string } | null>(null);

  const handleRename = useCallback((id: string, currentName: string) => {
    setRenameTarget({ id, name: currentName });
    setRenameError(null);
    setRenameDialogOpen(true);
  }, []);

  const handleRenameConfirm = useCallback(async (newName: string) => {
    if (!renameTarget) return;
    setRenameError(null);
    try {
      await updateNode(renameTarget.id, projectId, { name: newName });
      refreshAllContentNodes(projectId);
      setRenameDialogOpen(false);
      setRenameTarget(null);
    } catch (err: unknown) {
      console.error('Failed to rename:', err);
      const errorObj = err as { message?: string };
      setRenameError(errorObj?.message || 'Failed to rename item');
      throw err;
    }
  }, [renameTarget, projectId]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    const confirmed = window.confirm(`Are you sure you want to delete "${name}"?`);
    if (confirmed) {
      try {
        await deleteNode(id, projectId);
        refreshAllContentNodes(projectId);
      } catch (err) {
        console.error('Failed to delete:', err);
        alert('Failed to delete item');
      }
    }
  }, [projectId]);

  const handleMoveNode = useCallback(async (
    nodeId: string,
    targetFolderId: string | null,
    sourceParentId: string | null = currentFolderId,
  ) => {
    if (sourceParentId === targetFolderId) return;

    const sourceKey = ['nodes', projectId, sourceParentId ?? '__root__'];
    const targetKey = ['nodes', projectId, targetFolderId ?? '__root__'];

    let movedNode: NodeInfo | undefined;

    mutate(
      sourceKey,
      (nodes: NodeInfo[] | undefined) => {
        movedNode = (nodes ?? []).find(n => n.id === nodeId);
        return (nodes ?? []).filter(n => n.id !== nodeId);
      },
      { revalidate: false },
    );

    if (movedNode) {
      const nodeForTarget = { ...movedNode, parent_id: targetFolderId };
      if (targetFolderId) ensureExpanded(targetFolderId);
      mutate(
        targetKey,
        (nodes: NodeInfo[] | undefined) => nodes ? [...nodes, nodeForTarget] : undefined,
        { revalidate: false },
      );
    }

    try {
      await moveNode(nodeId, projectId, targetFolderId);
      refreshAllContentNodes(projectId);
    } catch (err: unknown) {
      refreshAllContentNodes(projectId);
      const msg = (err as { message?: string })?.message || 'Failed to move item';
      showToast(msg, 'error');
    }
  }, [projectId, currentFolderId, showToast]);

  const handleMoveRequest = useCallback((id: string, name: string) => {
    setMoveDialogTarget({ id, name });
  }, []);

  const handleCreateTool = useCallback((id: string, name: string, type: string, jsonPath?: string) => {
    setToolPanelTarget({ id, name, type, jsonPath });
  }, []);

  const closeRenameDialog = useCallback(() => {
    setRenameDialogOpen(false);
    setRenameTarget(null);
    setRenameError(null);
  }, []);

  return {
    renameDialogOpen, renameTarget, renameError,
    handleRename, handleRenameConfirm, closeRenameDialog,
    moveDialogTarget, setMoveDialogTarget,
    handleMoveNode, handleMoveRequest,
    toast, showToast,
    toolPanelTarget, setToolPanelTarget,
    handleDelete, handleCreateTool,
  };
}
