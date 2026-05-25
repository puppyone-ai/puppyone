'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  resolveDataTransferSnapshot,
  snapshotDataTransfer,
} from '@/lib/dropFiles';
import { resolveFormat } from '@/lib/fileFormats';
import {
  applyPolicy,
  collectIgnoreRulesFromDrop,
  PER_FILE_MAX_BYTES,
  type BatchPolicyResult,
  type IgnoreRule,
} from '@/lib/uploadPolicy';
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
 * Applies the PUP-3 folder-upload policy (``lib/uploadPolicy.ts``) on
 * the added files BEFORE forwarding them to the parent's ``onConfirm``.
 * The flow:
 *   1. User adds files (drop / picker). The dialog also scans the
 *      added set for ``.gitignore`` / ``.puppyignore`` to feed into
 *      the policy.
 *   2. ``applyPolicy`` partitions into ``accepted`` + ``skipped``,
 *      tracking reasons (blocklist / gitignored / hidden / too_large).
 *   3. The dialog shows a preflight summary when:
 *      - any file was skipped, OR
 *      - the count/size crosses the preflight thresholds (Q4: 50 files
 *        / 100 MB).
 *   4. Override checkboxes (include hidden / .gitignored /
 *      default-blocked) re-evaluate the policy on toggle.
 *   5. ``Import N Files`` commits the accepted subset.
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
  const folderInputRef = useRef<HTMLInputElement>(null);

  // .gitignore / .puppyignore rules harvested from the dropped set.
  const [ignoreRules, setIgnoreRules] = useState<IgnoreRule[]>([]);

  // Override toggles. All start false — the policy defaults skip
  // hidden / blocked / ignored files unless the user explicitly opts
  // in.
  const [includeHidden, setIncludeHidden] = useState(false);
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [includeBlocklist, setIncludeBlocklist] = useState(false);

  // 同步初始文件
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      setFiles(initialFiles);
    }
  }, [initialFiles]);

  // Re-scan ignore rules whenever the file set changes. Async because
  // ``collectIgnoreRulesFromDrop`` reads file text.
  useEffect(() => {
    let cancelled = false;
    void collectIgnoreRulesFromDrop(files).then((rules) => {
      if (!cancelled) setIgnoreRules(rules);
    });
    return () => {
      cancelled = true;
    };
  }, [files]);

  // Live policy evaluation. Returns ``accepted`` (what we'd send),
  // ``skipped`` (with reasons), counts, and a ``shouldPreflight`` flag.
  const policyResult: BatchPolicyResult = useMemo(
    () =>
      applyPolicy({
        files,
        rules: ignoreRules,
        options: {
          includeHidden,
          includeIgnored,
          includeBlocklist,
        },
      }),
    [files, ignoreRules, includeHidden, includeIgnored, includeBlocklist],
  );

  const { accepted, skipped, totalAcceptedBytes, reasonCounts, shouldPreflight } = policyResult;

  // File-format breakdown is computed off ``accepted`` (what will
  // actually upload), not the full input — otherwise the chip line
  // claims you're sending content you're not.
  const fileStats = React.useMemo(() => {
    let textCount = 0;
    let binaryCount = 0;
    const extensions = new Set<string>();

    const TEXT_LIKE_CATEGORIES = new Set(['markdown', 'text', 'code', 'data']);

    accepted.forEach((f) => {
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
  }, [accepted]);

  // 重置状态
  useEffect(() => {
    if (!isOpen) {
      if (!initialFiles) {
        setFiles([]);
      }
      setIsDragging(false);
      setIncludeHidden(false);
      setIncludeIgnored(false);
      setIncludeBlocklist(false);
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
    e.target.value = '';
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleConfirm = useCallback(() => {
    if (accepted.length === 0) return;
    onConfirm(accepted, 'raw');
  }, [accepted, onConfirm]);

  if (!isOpen) return null;

  const totalSkipped = skipped.length;
  const skippedRows: { label: string; count: number; toggle?: () => void; toggleValue?: boolean }[] = [];
  if (reasonCounts.blocklist > 0) {
    skippedRows.push({
      label: 'in blocklisted folders (.git, node_modules, …)',
      count: reasonCounts.blocklist,
      toggle: () => setIncludeBlocklist((v) => !v),
      toggleValue: includeBlocklist,
    });
  }
  if (reasonCounts.gitignore > 0) {
    skippedRows.push({
      label: 'matched .gitignore / .puppyignore',
      count: reasonCounts.gitignore,
      toggle: () => setIncludeIgnored((v) => !v),
      toggleValue: includeIgnored,
    });
  }
  if (reasonCounts.hidden > 0) {
    skippedRows.push({
      label: 'hidden files (start with .)',
      count: reasonCounts.hidden,
      toggle: () => setIncludeHidden((v) => !v),
      toggleValue: includeHidden,
    });
  }
  if (reasonCounts.tooLarge > 0) {
    // No override — per-file size cap is a hard limit. Surface only.
    skippedRows.push({
      label: `larger than ${formatBytes(PER_FILE_MAX_BYTES)} per file`,
      count: reasonCounts.tooLarge,
    });
  }

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
          <input
            ref={folderInputRef}
            type="file"
            multiple
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
                {/* File List — preview of ACCEPTED files only. Skipped
                    files appear in the preflight section below. */}
                <div style={{ marginBottom: 12 }}>
                  {accepted.slice(0, 5).map((file, index) => (
                    <div
                      key={`${file.name}-${index}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '6px 0',
                        borderBottom: index < Math.min(accepted.length, 5) - 1 ? '1px solid var(--po-border-subtle)' : 'none',
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
                        {(file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--po-text-subtle)', marginRight: 8 }}>
                        {(file.size / 1024).toFixed(0)} KB
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Remove from the source list. Index in the
                          // ``files`` array is what's mutable; map
                          // the accepted entry back.
                          const original = files.indexOf(file);
                          if (original >= 0) removeFile(original);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--po-text-subtle)',
                          cursor: 'pointer',
                          width: 30,
                          height: 30,
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  {accepted.length > 5 && (
                    <div style={{ fontSize: 12, color: 'var(--po-text-subtle)', paddingTop: 8 }}>
                      + {accepted.length - 5} more files
                    </div>
                  )}
                  {accepted.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--po-text-subtle)', padding: '4px 0' }}>
                      No files will be uploaded with the current settings.
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

          {/* Preflight panel — only renders when there's something
              worth surfacing: any skipped file OR the accepted set
              crosses the preflight threshold. */}
          {files.length > 0 && (shouldPreflight || totalSkipped > 0) && (
            <div
              style={{
                background: 'var(--po-control)',
                padding: '10px 14px',
                borderRadius: 6,
                marginBottom: 12,
                fontSize: 12,
                color: 'var(--po-text-muted)',
              }}
            >
              <div style={{ marginBottom: skippedRows.length > 0 ? 8 : 0 }}>
                <span style={{ color: 'var(--po-text)', fontWeight: 500 }}>
                  {accepted.length}
                </span>{' '}
                file{accepted.length === 1 ? '' : 's'} ·{' '}
                <span style={{ color: 'var(--po-text)' }}>
                  {formatBytes(totalAcceptedBytes)}
                </span>{' '}
                will upload
                {totalSkipped > 0 && (
                  <>
                    {' '}·{' '}
                    <span style={{ color: 'var(--po-warning)' }}>
                      {totalSkipped} skipped
                    </span>
                  </>
                )}
              </div>
              {skippedRows.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {skippedRows.map((row, i) => (
                    <label
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: row.toggle ? 'pointer' : 'default',
                        opacity: row.toggle ? 1 : 0.7,
                      }}
                    >
                      {row.toggle ? (
                        <input
                          type="checkbox"
                          checked={!!row.toggleValue}
                          onChange={row.toggle}
                          style={{ margin: 0 }}
                        />
                      ) : (
                        <span style={{ width: 13, display: 'inline-block' }} />
                      )}
                      <span style={{ flex: 1 }}>{row.label}</span>
                      <span style={{ color: 'var(--po-text-subtle)' }}>
                        {row.count}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Compact stats — only when at least one accepted file
              exists. Hidden when the user has filtered everything out. */}
          {accepted.length > 0 && (
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
                <span style={{ color: 'var(--po-text)', fontWeight: 500 }}>{accepted.length}</span> files
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
              disabled={accepted.length === 0}
              variant='primary'
            >
              {accepted.length > 0 ? `Import ${accepted.length} File${accepted.length > 1 ? 's' : ''}` : 'Select Files'}
            </ActionButton>
          </div>
        </DialogFooter>
      </DialogSurface>
    </DialogRoot>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
