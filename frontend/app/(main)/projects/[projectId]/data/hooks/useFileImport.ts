'use client';

import { useState, useRef, useCallback } from 'react';
import { uploadFiles } from '@/lib/uploadApi';
import {
  addPendingTasks,
  updateTaskStatusById,
  updateTaskProgress,
  replaceTaskId,
} from '@/components/BackgroundTaskNotifier';
import { refreshFolderNodes, refreshProjectHistory } from '@/lib/hooks/useData';

export type FileImportTarget = {
  path: string | null;
  name: string;
};

const ROOT_IMPORT_TARGET: FileImportTarget = { path: null, name: 'Root' };

type ImportToastType = 'success' | 'error' | 'loading';

interface UseFileImportOptions {
  showToast?: (
    message: string,
    type?: ImportToastType,
    durationMs?: number | null,
  ) => void;
}

function normalizePath(path: string | null | undefined): string {
  return (path ?? '').trim().replace(/^\/+|\/+$/g, '');
}

function joinPath(basePath: string | null, childPath: string): string {
  const base = normalizePath(basePath);
  const child = normalizePath(childPath);
  if (!base) return child;
  if (!child) return base;
  return `${base}/${child}`;
}

function deriveImportParentPath(
  basePath: string | null,
  webkitRelativePath: string | undefined,
): string {
  const rel = (webkitRelativePath ?? '').trim().replace(/^\.?\/+/, '');
  const lastSlash = rel.lastIndexOf('/');
  if (lastSlash < 0) return normalizePath(basePath);
  const relativeDir = rel.slice(0, lastSlash);
  return joinPath(basePath, relativeDir);
}

function addFolderAndAncestors(out: Set<string>, folderPath: string): void {
  const clean = normalizePath(folderPath);
  if (!clean) {
    out.add('');
    return;
  }
  const parts = clean.split('/').filter(Boolean);
  for (let i = 1; i <= parts.length; i++) {
    out.add(parts.slice(0, i).join('/'));
  }
}

function affectedImportFolders(
  files: readonly File[],
  targetPath: string | null,
): string[] {
  const affected = new Set<string>();
  addFolderAndAncestors(affected, normalizePath(targetPath));
  for (const file of files) {
    addFolderAndAncestors(
      affected,
      deriveImportParentPath(targetPath, file.webkitRelativePath),
    );
  }
  return Array.from(affected);
}

function formatFileCount(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`;
}

export function useFileImport(
  projectId: string,
  accessToken: string | undefined,
  options: UseFileImportOptions = {},
) {
  const { showToast } = options;
  const [fileImportDialogOpen, setFileImportDialogOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [fileImportTarget, setFileImportTarget] = useState<FileImportTarget>(ROOT_IMPORT_TARGET);
  const latestTargetRef = useRef<FileImportTarget>(ROOT_IMPORT_TARGET);

  // Sidebar drag/drop = backend-proxied multipart upload, same path
  // the explorer dialog uses. Bytes go browser → Next.js → FastAPI
  // → S3, the backend writes them into Version Engine, and the
  // BackgroundTaskNotifier polls the resulting task IDs to terminal
  // state.
  const uploadFilesToTarget = useCallback(async (
    importFiles: File[],
    target: FileImportTarget,
  ) => {
    if (importFiles.length === 0) return;
    if (!accessToken) {
      console.error('File import skipped: not authenticated');
      showToast?.('Sign in again before importing files', 'error');
      return;
    }
    const targetPath = normalizePath(target.path) || null;
    const affectedFolders = affectedImportFolders(importFiles, targetPath);
    const totalCount = importFiles.length;

    // Placeholder IDs spawned in ``onUploadStart`` so the widget
    // appears the instant the user drops a file. Swapped in
    // ``onTaskCreated`` once /upload/init returns the real ID.
    const placeholderIds: string[] = [];

    try {
      showToast?.(
        `Uploading ${formatFileCount(totalCount)} to ${target.name}...`,
        'loading',
        null,
      );
      const results = await uploadFiles(
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
            // Bytes are in S3, server is now writing into Version Engine.
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
      const completedCount = results.filter((r) => r.status === 'completed').length;
      const failedCount = results.filter((r) => r.status === 'failed').length;
      const abortedCount = results.filter((r) => r.status === 'aborted').length;

      if (completedCount > 0) {
        void refreshFolderNodes(projectId, ...affectedFolders);
        void refreshProjectHistory(projectId);
      }

      if (failedCount > 0 || abortedCount > 0) {
        showToast?.(
          completedCount > 0
            ? `Imported ${completedCount} of ${formatFileCount(totalCount)}`
            : 'File import failed',
          'error',
        );
      } else {
        showToast?.(`Imported ${formatFileCount(completedCount)}`);
      }
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
      showToast?.(`Import failed: ${errMsg}`, 'error');
    }
  }, [projectId, accessToken, showToast]);

  const openFileImportDialogForTarget = useCallback((target: FileImportTarget) => {
    const path = normalizePath(target.path);
    const normalizedTarget = path ? { ...target, path } : ROOT_IMPORT_TARGET;
    setFileImportTarget(normalizedTarget);
    latestTargetRef.current = normalizedTarget;
    setDroppedFiles([]);
    setFileImportDialogOpen(true);
  }, []);

  const openFileImportForTarget = useCallback((files: File[], target: FileImportTarget) => {
    const path = normalizePath(target.path);
    const normalizedTarget = path ? { ...target, path } : ROOT_IMPORT_TARGET;
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
    openFileImportDialogForTarget,
    openFileImportForTarget,
    handleFileImportConfirm,
    closeFileImportDialog,
  };
}
