'use client';

import { useState, useRef, useCallback } from 'react';
import { uploadAndSubmit } from '@/lib/etlApi';
import {
  addPendingTasks,
  replacePlaceholderTasks,
  removeFailedPlaceholders,
} from '@/components/BackgroundTaskNotifier';
import { refreshAllContentNodes } from '@/lib/hooks/useData';

export function useFileImport(
  projectId: string,
  currentFolderId: string | null,
  accessToken: string | undefined,
) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [fileImportDialogOpen, setFileImportDialogOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const dragCounterRef = useRef(0);

  const handleGlobalDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingFiles(true);
    }
  }, []);

  const handleGlobalDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingFiles(false);
    }
  }, []);

  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
    e.stopPropagation();
  }, []);

  const handleGlobalDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingFiles(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setDroppedFiles(files);
      setFileImportDialogOpen(true);
    }
  }, []);

  const handleFileImportConfirm = useCallback(async (importFiles: File[], mode: 'ocr_parse' | 'raw') => {
    setFileImportDialogOpen(false);
    setDroppedFiles([]);
    if (importFiles.length === 0) return;

    const baseTimestamp = Date.now();
    const placeholderGroupId = `upload-${baseTimestamp}`;
    const placeholderTasks = importFiles.map((file, index) => ({
      taskId: `placeholder-${baseTimestamp}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      tableId: placeholderGroupId,
      tableName: file.name,
      filename: file.name,
      status: 'pending' as const,
      taskType: 'file' as const,
    }));
    addPendingTasks(placeholderTasks);

    try {
      if (!accessToken) throw new Error('Not authenticated');
      const response = await uploadAndSubmit(
        { projectId, files: importFiles, mode, parentId: currentFolderId ?? undefined },
        accessToken,
      );

      const filenameMap = new Map(importFiles.map(f => [f.name, f.name]));
      const realTasks = response.items
        .filter((item: any) => item.status !== 'failed')
        .map((item: any) => ({
          taskId: String(item.task_id),
          projectId,
          tableId: placeholderGroupId,
          tableName: filenameMap.get(item.filename!) || item.filename!,
          filename: filenameMap.get(item.filename!) || item.filename!,
          status: (item.status === 'completed' ? 'completed' : 'pending') as any,
          taskType: 'file' as const,
        }));
      if (realTasks.length > 0) replacePlaceholderTasks(placeholderGroupId, realTasks);

      const failedFiles = response.items.filter((item: any) => item.status === 'failed');
      if (failedFiles.length > 0) {
        const failedNames = failedFiles.map((f: any) => filenameMap.get(f.filename!) || f.filename!);
        removeFailedPlaceholders(placeholderGroupId, failedNames);
      }

      refreshAllContentNodes(projectId);
    } catch (err) {
      console.error('File import failed:', err);
    }
  }, [projectId, currentFolderId, accessToken]);

  const closeFileImportDialog = useCallback(() => {
    setFileImportDialogOpen(false);
    setDroppedFiles([]);
  }, []);

  return {
    isDraggingFiles,
    fileImportDialogOpen,
    droppedFiles,
    handleGlobalDragEnter,
    handleGlobalDragLeave,
    handleGlobalDragOver,
    handleGlobalDrop,
    handleFileImportConfirm,
    closeFileImportDialog,
  };
}
