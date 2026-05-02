'use client';

import { useState, useRef, useCallback } from 'react';
import { mutate } from 'swr';
import { moveFile, removeFile, type NodeInfo } from '@/lib/contentTreeApi';
import { refreshAllContentNodes } from '@/lib/hooks/useData';
import { ensureExpanded } from '../components/explorer';

export function useNodeActions(projectId: string, currentFolderPath: string | null) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [moveDialogTarget, setMoveDialogTarget] = useState<{ id: string; name: string; mut_path?: string } | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const deletingPathsRef = useRef<Set<string>>(new Set());

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const [toolPanelTarget, setToolPanelTarget] = useState<{ id: string; name: string; type: string; jsonPath?: string } | null>(null);

  const handleRename = useCallback((path: string, currentName: string) => {
    setRenameTarget({ id: path, name: currentName });
    setRenameError(null);
    setRenameDialogOpen(true);
  }, []);

  const handleRenameConfirm = useCallback(async (newName: string) => {
    if (!renameTarget) return;
    setRenameError(null);
    try {
      const oldPath = renameTarget.id;
      const parentDir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
      const newPath = parentDir ? `${parentDir}/${newName}` : newName;
      await moveFile(projectId, oldPath, newPath);
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

  const handleDelete = useCallback(async (path: string, name: string) => {
    if (deletingPathsRef.current.has(path)) {
      showToast(`Still deleting "${name}"...`, 'error');
      return;
    }
    const confirmed = window.confirm(`Are you sure you want to delete "${name}"?`);
    if (confirmed) {
      try {
        deletingPathsRef.current.add(path);
        showToast(`Deleting "${name}"...`);
        await removeFile(projectId, path);
        refreshAllContentNodes(projectId);
        showToast(`Deleted "${name}"`);
      } catch (err) {
        console.error('Failed to delete:', err);
        alert('Failed to delete item');
      } finally {
        deletingPathsRef.current.delete(path);
      }
    }
  }, [projectId, showToast]);

  const handleMoveNode = useCallback(async (
    nodePath: string,
    targetFolderPath: string | null,
    sourceParentPath: string | null = currentFolderPath,
  ) => {
    if (sourceParentPath === targetFolderPath) return;

    const sourceKey = ['tree', projectId, sourceParentPath ?? ''];
    const targetKey = ['tree', projectId, targetFolderPath ?? ''];

    let movedNode: NodeInfo | undefined;

    mutate(
      sourceKey,
      (nodes: NodeInfo[] | undefined) => {
        movedNode = (nodes ?? []).find(n => n.path === nodePath || n.id === nodePath);
        return (nodes ?? []).filter(n => n.path !== nodePath && n.id !== nodePath);
      },
      { revalidate: false },
    );

    if (movedNode) {
      const name = movedNode.name;
      const newPath = targetFolderPath ? `${targetFolderPath}/${name}` : name;
      const nodeForTarget = { ...movedNode, path: newPath, id: newPath, parent_id: targetFolderPath };
      if (targetFolderPath) ensureExpanded(targetFolderPath);
      mutate(
        targetKey,
        (nodes: NodeInfo[] | undefined) => nodes ? [...nodes, nodeForTarget] : undefined,
        { revalidate: false },
      );
    }

    try {
      const name = nodePath.includes('/') ? nodePath.substring(nodePath.lastIndexOf('/') + 1) : nodePath;
      const newPath = targetFolderPath ? `${targetFolderPath}/${name}` : name;
      await moveFile(projectId, nodePath, newPath);
      refreshAllContentNodes(projectId);
    } catch (err: unknown) {
      refreshAllContentNodes(projectId);
      const msg = (err as { message?: string })?.message || 'Failed to move item';
      showToast(msg, 'error');
    }
  }, [projectId, currentFolderPath, showToast]);

  const handleMoveRequest = useCallback((path: string, name: string, mut_path?: string) => {
    setMoveDialogTarget({ id: path, name, mut_path });
  }, []);

  const handleCreateTool = useCallback((path: string, name: string, type: string, jsonPath?: string) => {
    setToolPanelTarget({ id: path, name, type, jsonPath });
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
