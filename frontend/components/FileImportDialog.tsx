'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  resolveDataTransferSnapshot,
  snapshotDataTransfer,
} from '@/lib/dropFiles';
import { resolveFormat } from '@/lib/fileFormats';

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

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div
        style={{
          width: 520,
          maxHeight: '85vh',
          background: '#18181b',
          border: '1px solid #27272a',
          borderRadius: 12,
          color: '#e5e5e5',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ 
          padding: '20px 24px 16px', 
          borderBottom: '1px solid #27272a',
          flexShrink: 0,
        }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
            Import Files
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#71717a' }}>
            Files are stored as-is in your context tree
          </p>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 10,
              padding: '4px 8px',
              borderRadius: 6,
              background: 'rgba(69, 153, 223, 0.12)',
              border: '1px solid rgba(69, 153, 223, 0.22)',
              color: '#93c5fd',
              fontSize: 12,
              fontWeight: 500,
              maxWidth: '100%',
            }}
          >
            <span style={{ color: '#71717a' }}>Import to</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {targetLabel}
            </span>
          </div>
        </div>

        {/* Content */}
        <div style={{ 
          padding: '16px 24px', 
          overflowY: 'auto',
          flex: 1,
        }}>
          {/* Dropzone */}
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
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: files.length > 0 ? '16px' : '32px 16px',
              border: `2px dashed ${isDragging ? '#3b82f6' : '#3f3f46'}`,
              borderRadius: 8,
              background: isDragging ? 'rgba(59, 130, 246, 0.08)' : '#09090b',
              cursor: 'pointer',
              transition: 'all 0.2s',
              marginBottom: 16,
            }}
          >
            {files.length === 0 ? (
              <div style={{ textAlign: 'center' }}>
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#52525b"
                  strokeWidth="1.5"
                  style={{ margin: '0 auto 12px' }}
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
                </svg>
                <div style={{ fontSize: 14, color: '#a1a1aa' }}>
                  Drop files or a folder here, or click to browse
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: '#71717a' }}>
                  Need to pick a whole folder?{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      folderInputRef.current?.click();
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: '#3b82f6',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 500,
                      textDecoration: 'underline',
                    }}
                  >
                    Browse folder
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
                        borderBottom: index < Math.min(files.length, 5) - 1 ? '1px solid #27272a' : 'none',
                      }}
                    >
                      <span style={{ 
                        fontSize: 13, 
                        color: '#d4d4d8',
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {file.name}
                      </span>
                      <span style={{ fontSize: 11, color: '#52525b', marginRight: 8 }}>
                        {(file.size / 1024).toFixed(0)} KB
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(index);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#71717a',
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
                    <div style={{ fontSize: 12, color: '#71717a', paddingTop: 8 }}>
                      + {files.length - 5} more files
                    </div>
                  )}
                </div>
                
                {/* Add more files hint */}
                <div style={{ 
                  textAlign: 'center', 
                  fontSize: 12, 
                  color: '#52525b',
                  paddingTop: 8,
                  borderTop: '1px dashed #27272a',
                }}>
                  Click or drop to add more files{' '}
                  <span style={{ opacity: 0.4 }}>·</span>{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      folderInputRef.current?.click();
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: '#3b82f6',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 500,
                      textDecoration: 'underline',
                    }}
                  >
                    Add folder
                  </button>
                </div>
              </>
            )}
          </div>

          {/* File Stats */}
          {files.length > 0 && (
            <div style={{ 
              background: '#27272a', 
              padding: '10px 14px', 
              borderRadius: 6, 
              marginBottom: 20,
              fontSize: 13,
              color: '#a1a1aa',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <span style={{ color: '#e5e5e5', fontWeight: 500 }}>{files.length}</span> files
                <span style={{ margin: '0 8px', opacity: 0.3 }}>•</span>
                <span style={{ color: '#e5e5e5' }}>{fileStats.textCount}</span> text
                <span style={{ margin: '0 8px', opacity: 0.3 }}>•</span>
                <span style={{ color: fileStats.binaryCount > 0 ? '#fbbf24' : '#e5e5e5' }}>
                  {fileStats.binaryCount}
                </span> docs/images
              </div>
              <div style={{ fontSize: 12, color: '#52525b' }}>
                {fileStats.extensions.slice(0, 4).map(ext => `.${ext}`).join(' ')}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ 
          padding: '16px 24px',
          borderTop: '1px solid #27272a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          {/* Upload Status */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            fontSize: 12, 
            color: '#a1a1aa',
          }}>
            <div style={{ 
              width: 6, height: 6, borderRadius: '50%', 
              background: '#71717a',
              marginRight: 6,
            }} />
            Raw upload
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid #3f3f46',
                background: 'transparent',
                color: '#a1a1aa',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={files.length === 0}
              style={{
                padding: '8px 20px',
                borderRadius: 6,
                border: 'none',
                background: files.length > 0 ? '#3b82f6' : '#27272a',
                color: files.length > 0 ? '#fff' : '#52525b',
                cursor: files.length > 0 ? 'pointer' : 'not-allowed',
                fontSize: 13,
                fontWeight: 600,
                transition: 'all 0.15s',
              }}
            >
              {files.length > 0 ? `Import ${files.length} File${files.length > 1 ? 's' : ''}` : 'Select Files'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default FileImportDialog;

