'use client';

import { useState, useRef, useCallback } from 'react';
import { mutate } from 'swr';
import { downloadNode, moveFile, removeFile, bulkRemoveFiles, type NodeInfo } from '@/lib/contentTreeApi';
import { refreshFolderNodes } from '@/lib/hooks/useData';
import { ensureExpanded } from '../components/explorer';

function parentOf(path: string): string {
  return path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
}

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
      const parentDir = parentOf(oldPath);
      const newPath = parentDir ? `${parentDir}/${newName}` : newName;
      await moveFile(projectId, oldPath, newPath);
      // Same parent folder, only one listing to refresh.
      refreshFolderNodes(projectId, parentDir);
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
        refreshFolderNodes(projectId, parentOf(path));
        showToast(`Deleted "${name}"`);
      } catch (err) {
        console.error('Failed to delete:', err);
        alert('Failed to delete item');
      } finally {
        deletingPathsRef.current.delete(path);
      }
    }
  }, [projectId, showToast]);

  /**
   * Multi-select bulk delete.
   *
   * Frontend bundles the selected paths into a single ``/rm`` POST
   * (``paths`` array), which the backend turns into one MUT commit
   * per scope via ``bulk_trash``. Selecting 50 files = 1 round-trip,
   * 1 commit, 1 audit entry — not 50.
   */
  const handleBulkDelete = useCallback(async (paths: string[]): Promise<void> => {
    const clean = paths.filter(Boolean);
    if (!clean.length) return;
    const inFlight = clean.filter((p) => deletingPathsRef.current.has(p));
    if (inFlight.length) {
      showToast(`${inFlight.length} item(s) still deleting...`, 'error');
      return;
    }
    try {
      clean.forEach((p) => deletingPathsRef.current.add(p));
      showToast(`Deleting ${clean.length} item(s)...`);
      await bulkRemoveFiles(projectId, clean);
      // Each unique parent listing changed; rest of the tree is untouched.
      const parents = Array.from(new Set(clean.map(parentOf)));
      refreshFolderNodes(projectId, ...parents);
      showToast(`Deleted ${clean.length} item(s)`);
    } catch (err) {
      console.error('Failed to bulk delete:', err);
      const msg = (err as { message?: string })?.message || 'Failed to delete items';
      showToast(msg, 'error');
      throw err;
    } finally {
      clean.forEach((p) => deletingPathsRef.current.delete(p));
    }
  }, [projectId, showToast]);

  const handleDownload = useCallback(async (path: string, name: string) => {
    // App-layer toast covers only the "preparing" window — the brief gap
    // between the user clicking and the server starting to stream bytes.
    // Once the browser's native download manager picks up the response
    // it owns the rest (progress bar, pause/cancel, "Show in Finder"),
    // so we don't show a "Downloaded" follow-up — that would just
    // duplicate what the browser is already telling them.
    try {
      showToast(`Preparing "${name}"...`);
      await downloadNode(projectId, path);
    } catch (err) {
      console.error('Failed to download:', err);
      const msg = (err as { message?: string })?.message || 'Failed to download';
      showToast(msg, 'error');
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
      // Source parent + target parent are the only two listings that changed.
      refreshFolderNodes(projectId, sourceParentPath, targetFolderPath);
    } catch (err: unknown) {
      refreshFolderNodes(projectId, sourceParentPath, targetFolderPath);
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
    handleDelete, handleDownload, handleCreateTool,
    handleBulkDelete,
  };
}
