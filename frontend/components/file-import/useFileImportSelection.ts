'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  resolveDataTransferSnapshot,
  snapshotDataTransfer,
} from '@/lib/dropFiles';
import { pickDirectoryFiles } from '@/lib/directoryPicker';
import {
  applyPolicy,
  collectIgnoreRulesFromDrop,
  type IgnoreRule,
} from '@/lib/uploadPolicy';
import { buildFileStats } from './fileStats';
import { buildPreviewRows } from './previewTree';
import type { FileImportSelectionState } from './types';

interface UseFileImportSelectionArgs {
  isOpen: boolean;
  initialFiles?: File[];
}

export function useFileImportSelection({
  isOpen,
  initialFiles,
}: UseFileImportSelectionArgs): FileImportSelectionState {
  const [files, setFiles] = useState<File[]>(initialFiles || []);
  const [isDragging, setIsDragging] = useState(false);
  const [ignoreRules, setIgnoreRules] = useState<IgnoreRule[]>([]);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      setFiles(initialFiles);
    }
  }, [initialFiles]);

  useEffect(() => {
    let cancelled = false;
    void collectIgnoreRulesFromDrop(files).then((rules) => {
      if (!cancelled) setIgnoreRules(rules);
    });
    return () => {
      cancelled = true;
    };
  }, [files]);

  useEffect(() => {
    if (!isOpen) {
      if (!initialFiles) setFiles([]);
      setIsDragging(false);
      setIncludeHidden(false);
      setIncludeIgnored(false);
    }
  }, [isOpen, initialFiles]);

  const policyResult = useMemo(
    () =>
      applyPolicy({
        files,
        rules: ignoreRules,
        options: {
          includeHidden,
          includeIgnored,
        },
      }),
    [files, ignoreRules, includeHidden, includeIgnored],
  );

  const fileStats = useMemo(
    () => buildFileStats(policyResult.accepted),
    [policyResult.accepted],
  );
  const previewTree = useMemo(
    () => buildPreviewRows(policyResult.accepted),
    [policyResult.accepted],
  );

  const handleDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);

    const snapshot = snapshotDataTransfer(event.nativeEvent);
    void resolveDataTransferSnapshot(snapshot).then((droppedFiles) => {
      if (droppedFiles.length > 0) {
        setFiles((prev) => [...prev, ...droppedFiles]);
      }
    });
  }, []);

  const handleFileSelect = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      setFiles((prev) => [...prev, ...Array.from(selectedFiles)]);
    }
    event.target.value = '';
  }, []);

  const handlePickFiles = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handlePickFolder = useCallback(async () => {
    const picked = await pickDirectoryFiles();
    if (picked === null) {
      folderInputRef.current?.click();
      return;
    }
    if (picked.length > 0) {
      setFiles((prev) => [...prev, ...picked]);
    }
  }, []);

  return {
    files,
    isDragging,
    policyResult,
    fileStats,
    previewTree,
    includeHidden,
    includeIgnored,
    fileInputRef,
    folderInputRef,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileSelect,
    handlePickFiles,
    handlePickFolder,
    setIncludeHidden,
    setIncludeIgnored,
  };
}
