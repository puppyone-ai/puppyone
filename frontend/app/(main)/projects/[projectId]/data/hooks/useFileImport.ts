'use client';

import { useState, useRef, useCallback } from 'react';
import { uploadAndSubmit } from '@/lib/etlApi';
import {
  addPendingTasks,
  replacePlaceholderTasks,
  removeFailedPlaceholders,
} from '@/components/BackgroundTaskNotifier';
import { refreshAllContentNodes } from '@/lib/hooks/useData';

export type FileImportTarget = {
  path: string | null;
  name: string;
};

const ROOT_IMPORT_TARGET: FileImportTarget = { path: null, name: 'Root' };

export function useFileImport(
  projectId: string,
  accessToken: string | undefined,
) {
  const [fileImportDialogOpen, setFileImportDialogOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [fileImportTarget, setFileImportTarget] = useState<FileImportTarget>(ROOT_IMPORT_TARGET);
  const latestTargetRef = useRef<FileImportTarget>(ROOT_IMPORT_TARGET);

  const uploadFilesToTarget = useCallback(async (
    importFiles: File[],
    target: FileImportTarget,
  ) => {
    if (importFiles.length === 0) return;
    const targetPath = target.path?.trim() || undefined;
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
        // Sidebar drag/drop is filesystem-like: files are stored as-is.
        // OCR/Smart Parse is intentionally out of this flow for now.
        { projectId, files: importFiles, mode: 'raw', parentPath: targetPath },
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
  }, [projectId, accessToken]);

  const openFileImportForTarget = useCallback((files: File[], target: FileImportTarget) => {
    const normalizedTarget = target.path ? target : ROOT_IMPORT_TARGET;
    setFileImportTarget(normalizedTarget);
    latestTargetRef.current = normalizedTarget;
    // Best-practice sidebar drop: dropping a local file into a folder is
    // an immediate raw upload, not a modal-driven OCR decision.
    void uploadFilesToTarget(files, normalizedTarget);
  }, [uploadFilesToTarget]);

  const handleFileImportConfirm = useCallback(async (importFiles: File[], _mode: 'ocr_parse' | 'raw') => {
    setFileImportDialogOpen(false);
    setDroppedFiles([]);
    await uploadFilesToTarget(importFiles, latestTargetRef.current);
  }, [uploadFilesToTarget]);

  const closeFileImportDialog = useCallback(() => {
    setFileImportDialogOpen(false);
    setDroppedFiles([]);
    setFileImportTarget(ROOT_IMPORT_TARGET);
    latestTargetRef.current = ROOT_IMPORT_TARGET;
  }, []);

  return {
    fileImportDialogOpen,
    fileImportTarget,
    droppedFiles,
    openFileImportForTarget,
    handleFileImportConfirm,
    closeFileImportDialog,
  };
}
