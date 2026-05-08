'use client';

import { useState, useRef, useCallback } from 'react';
import { uploadFiles } from '@/lib/uploadApi';
import {
  addPendingTasks,
  updateTaskStatusById,
  updateTaskProgress,
  replaceTaskId,
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

  // Sidebar drag/drop = backend-proxied multipart upload, same path
  // the explorer dialog uses. Bytes go browser → Next.js → FastAPI
  // → S3, the backend writes them into MUT, and the
  // BackgroundTaskNotifier polls the resulting task IDs to terminal
  // state.
  const uploadFilesToTarget = useCallback(async (
    importFiles: File[],
    target: FileImportTarget,
  ) => {
    if (importFiles.length === 0) return;
    if (!accessToken) {
      console.error('File import skipped: not authenticated');
      return;
    }
    const targetPath = target.path?.trim() || null;

    // Placeholder IDs spawned in ``onUploadStart`` so the widget
    // appears the instant the user drops a file. Swapped in
    // ``onTaskCreated`` once /upload/init returns the real ID.
    const placeholderIds: string[] = [];

    try {
      await uploadFiles(
        { projectId, files: importFiles, parentPath: targetPath },
        accessToken,
        {
          onUploadStart: (files) => {
            files.forEach((f) => {
              const tmpId = `tmp-${crypto.randomUUID()}`;
              placeholderIds[f.fileIndex] = tmpId;
            });
            addPendingTasks(
              files.map((f) => ({
                taskId: placeholderIds[f.fileIndex],
                projectId,
                tableName: f.filename,
                filename: f.filename,
                status: 'uploading',
                taskType: 'file',
              })),
            );
          },
          onTaskCreated: ({ fileIndex, taskId }) => {
            const tmpId = placeholderIds[fileIndex];
            if (tmpId) {
              replaceTaskId(tmpId, taskId);
              placeholderIds[fileIndex] = taskId;
            }
          },
          onProgress: (taskId, _loaded, _total, percent) => {
            updateTaskProgress(taskId, percent);
          },
          onAllPartsUploaded: (taskId) => {
            // Bytes are in S3, server is now writing into MUT.
            // Show "Finalizing…" until /upload/complete returns,
            // otherwise the row sits at "Uploading 100%" looking
            // stuck for the multi-second finalize window.
            updateTaskStatusById(taskId, 'finalizing');
          },
          onTaskCompleted: (taskId) => {
            // Inline finalize: by the time /upload/complete returns
            // 200, the task is COMPLETED in the DB. Skip the
            // ``pending`` -> poll -> ``completed`` round-trip.
            updateTaskStatusById(taskId, 'completed');
          },
          onTaskFailed: (taskId, error) => {
            updateTaskStatusById(taskId, 'failed', { error });
          },
        },
      );
    } catch (err) {
      // ``uploadFiles`` only throws if /upload/init fails (per-file
      // failures go through ``onTaskFailed`` above). The placeholders
      // we spawned in ``onUploadStart`` never got real IDs, so flip
      // them to ``failed`` here — otherwise they'd sit as
      // ``uploading`` until the 30-minute stale sweeper kicks in.
      const errMsg = err instanceof Error ? err.message : String(err);
      placeholderIds.forEach((id) => {
        if (id) updateTaskStatusById(id, 'failed', { error: errMsg });
      });
      console.error('File import failed:', err);
    } finally {
      refreshAllContentNodes(projectId);
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
