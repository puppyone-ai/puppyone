'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  resolveDataTransferSnapshot,
  snapshotDataTransfer,
} from '@/lib/dropFiles';
import { resolveFormat } from '@/lib/fileFormats';
import { ActionButton } from './ui/ActionButton';
import { DialogBody, DialogFooter, DialogHeader, DialogRoot, DialogSurface } from './ui/Dialog';
import { BUTTON_HEIGHT } from './ui/buttonTokens';

interface FileImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (files: File[], mode: 'ocr_parse' | 'raw') => void;
  /** 预先选中的文件（可选） */
  initialFiles?: File[];
  /** Display label for the upload destination folder. */
  targetLabel?: string;
}

/**
 * 统一的文件导入对话框
 *
 * OCR/Smart Parse is temporarily hidden. File imports are stored as-is.
 */
export function FileImportDialog({
  isOpen,
  onClose,
  onConfirm,
  initialFiles,
  targetLabel = 'Root',
}: FileImportDialogProps) {
  const [files, setFiles] = useState<File[]>(initialFiles || []);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Separate folder picker. The browser exposes ``webkitdirectory``
  // only on dedicated inputs — toggling it on a single shared input
  // would force the user to pick one mode at dialog mount time and
  // we'd lose the per-click choice. With two hidden inputs the
  // visible UI gets both buttons and each click opens the right
  // picker. ``handleFileSelect`` works for both: when the user
  // picks a folder, every File in the resulting FileList carries
  // a non-empty ``webkitRelativePath`` set by the browser.
  const folderInputRef = useRef<HTMLInputElement>(null);

  // 同步初始文件
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      setFiles(initialFiles);
    }
  }, [initialFiles]);

  // Analyze files using the file-format registry as the single
  // source of truth — no more local hardcoded extension list. The
  // category split is text-like (markdown / text / code / structured
  // text data) vs everything else (image / pdf / archive / binary).
  const fileStats = React.useMemo(() => {
    let textCount = 0;
    let binaryCount = 0;
    const extensions = new Set<string>();

    const TEXT_LIKE_CATEGORIES = new Set(['markdown', 'text', 'code', 'data']);

    files.forEach((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      extensions.add(ext);
      const fmt = resolveFormat({ name: f.name, mimeType: f.type || null });
      if (TEXT_LIKE_CATEGORIES.has(fmt.category)) {
        textCount++;
      } else {
        binaryCount++;
      }
    });

    return { textCount, binaryCount, extensions: Array.from(extensions) };
  }, [files]);

  // 重置状态
  useEffect(() => {
    if (!isOpen) {
      if (!initialFiles) {
        setFiles([]);
      }
      setIsDragging(false);
    }
  }, [isOpen, initialFiles]);

  // 拖放处理
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 只有离开整个 dropzone 时才重置
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Snapshot synchronously — see lib/dropFiles.ts. If the user
    // dropped a folder, ``e.dataTransfer.files`` would lie and
    // report a single 0-byte "file" with the folder's name.
    const snapshot = snapshotDataTransfer(e.nativeEvent);
    void resolveDataTransferSnapshot(snapshot).then((droppedFiles) => {
      if (droppedFiles.length > 0) {
        setFiles((prev) => [...prev, ...droppedFiles]);
      }
    });
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      setFiles(prev => [...prev, ...Array.from(selectedFiles)]);
    }
    // 重置 input 以便再次选择相同文件
    e.target.value = '';
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleConfirm = useCallback(() => {
    if (files.length === 0) return;
    onConfirm(files, 'raw');
  }, [files, onConfirm]);

  if (!isOpen) return null;

  return (
    <DialogRoot onClose={onClose}>
      <DialogSurface
        width={520}
        maxHeight="85vh"
        ariaLabelledBy="file-import-dialog-title"
      >
        <DialogHeader title={<span id="file-import-dialog-title">Upload files</span>} onClose={onClose} />
        <DialogBody style={{ flex: 1 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 14,
              padding: '4px 8px',
              borderRadius: 6,
              background: 'transparent',
              border: '1px solid var(--po-border-subtle)',
              color: 'var(--po-text-muted)',
              fontSize: 12,
              fontWeight: 500,
              maxWidth: '100%',
            }}
          >
            <span style={{ color: 'var(--po-text-subtle)' }}>Import to</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {targetLabel}
            </span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          {/* Folder picker — separate hidden input. When the user
              clicks the "Browse folder" link below, the browser's
              native folder picker opens and every selected File
              gets a ``webkitRelativePath`` reflecting the folder
              hierarchy. The upload pipeline (lib/uploadApi.ts ->
              deriveFileParentPath) reads that path to preserve
              the structure on the server. */}
          <input
            ref={folderInputRef}
            type="file"
            multiple
            // ``webkitdirectory`` / ``directory`` are non-standard
            // attributes shipped by every Chromium / Firefox /
            // Safari we target; React's TS types don't know about
            // them, so we spread them through ``any`` (matches the
            // pattern in GetStartedPanel and TableManageDialog).
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          <div
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{
              padding: files.length > 0 ? '14px 16px' : '28px 20px',
              border: '1px dashed',
              borderColor: isDragging ? 'var(--po-focus-ring)' : 'var(--po-border-strong)',
              borderRadius: 8,
              background: isDragging ? 'var(--po-selected)' : 'transparent',
              transition: 'background 0.15s, border-color 0.15s',
              marginBottom: 16,
            }}
          >
            {files.length === 0 ? (
              <div style={{ textAlign: 'center' }}>
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={isDragging ? 'var(--po-accent)' : 'var(--po-text-subtle)'}
                  strokeWidth="1.5"
                  style={{ margin: '0 auto 12px' }}
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
                </svg>
                <div style={{ fontSize: 13, color: 'var(--po-text-muted)' }}>
                  Drag and drop files or folders here
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    style={{
                      ...dropzoneActionButton,
                    }}
                  >
                    Upload Files
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      folderInputRef.current?.click();
                    }}
                    style={{
                      ...dropzoneActionButton,
                    }}
                  >
                    Upload Folder
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* File List */}
                <div style={{ marginBottom: 12 }}>
                  {files.slice(0, 5).map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '6px 0',
                        borderBottom: index < Math.min(files.length, 5) - 1 ? '1px solid var(--po-border-subtle)' : 'none',
                      }}
                    >
                      <span style={{
                        fontSize: 13,
                        color: 'var(--po-text-muted)',
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {file.name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--po-text-subtle)', marginRight: 8 }}>
                        {(file.size / 1024).toFixed(0)} KB
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(index);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--po-text-subtle)',
                          cursor: 'pointer',
                          padding: 4,
                          display: 'flex',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  {files.length > 5 && (
                    <div style={{ fontSize: 12, color: 'var(--po-text-subtle)', paddingTop: 8 }}>
                      + {files.length - 5} more files
                    </div>
                  )}
                </div>

                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: 8,
                  paddingTop: 10,
                  borderTop: '1px dashed var(--po-border-subtle)',
                }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    style={dropzoneActionButton}
                  >
                    Add Files
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      folderInputRef.current?.click();
                    }}
                    style={dropzoneActionButton}
                  >
                    Add Folder
                  </button>
                </div>
              </>
            )}
          </div>

          {/* File Stats */}
          {files.length > 0 && (
            <div style={{
              background: 'var(--po-control)',
              padding: '10px 14px',
              borderRadius: 6,
              fontSize: 13,
              color: 'var(--po-text-muted)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <span style={{ color: 'var(--po-text)', fontWeight: 500 }}>{files.length}</span> files
                <span style={{ margin: '0 8px', opacity: 0.3 }}>•</span>
                <span style={{ color: 'var(--po-text)' }}>{fileStats.textCount}</span> text
                <span style={{ margin: '0 8px', opacity: 0.3 }}>•</span>
                <span style={{ color: fileStats.binaryCount > 0 ? 'var(--po-warning)' : 'var(--po-text)' }}>
                  {fileStats.binaryCount}
                </span> docs/images
              </div>
              <div style={{ fontSize: 12, color: 'var(--po-text-subtle)' }}>
                {fileStats.extensions.slice(0, 4).map(ext => `.${ext}`).join(' ')}
              </div>
            </div>
          )}

        </DialogBody>

        <DialogFooter justify="space-between">
          <div style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 12,
            color: 'var(--po-text-muted)',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--po-text-subtle)',
              marginRight: 6,
            }} />
            Raw upload
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <ActionButton
              onClick={onClose}
            >
              Cancel
            </ActionButton>
            <ActionButton
              onClick={handleConfirm}
              disabled={files.length === 0}
              variant='primary'
            >
              {files.length > 0 ? `Import ${files.length} File${files.length > 1 ? 's' : ''}` : 'Select Files'}
            </ActionButton>
          </div>
        </DialogFooter>
      </DialogSurface>
    </DialogRoot>
  );
}

const dropzoneActionButton: React.CSSProperties = {
  height: BUTTON_HEIGHT,
  padding: '0 14px',
  borderRadius: 6,
  border: '1px solid var(--po-border-strong)',
  background: 'transparent',
  color: 'var(--po-text)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background 0.15s, border-color 0.15s',
};

export default FileImportDialog;
