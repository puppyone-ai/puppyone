'use client';

import { useCallback } from 'react';
import type { ChangeEvent, RefObject } from 'react';
import { ActionButton } from '@/components/ui/ActionButton';
import { DialogBody, DialogFooter, DialogHeader, DialogRoot, DialogSurface } from '@/components/ui/Dialog';
import { StatusDot } from '@/components/ui/StatusDot';
import { FileImportPolicySummary } from './FileImportPolicySummary';
import { FileImportPreviewTree } from './FileImportPreviewTree';
import { FileImportSourcePicker } from './FileImportSourcePicker';
import { useFileImportSelection } from './useFileImportSelection';
import type { FileImportDialogProps } from './types';

export function FileImportDialog({
  isOpen,
  onClose,
  onConfirm,
  initialFiles,
  targetLabel = 'Root',
}: FileImportDialogProps) {
  const selection = useFileImportSelection({ isOpen, initialFiles });
  const {
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
  } = selection;
  const { accepted, totalAcceptedBytes, limitViolations } = policyResult;
  const exceedsHardLimits = limitViolations.length > 0;

  const handleConfirm = useCallback(() => {
    if (accepted.length === 0 || exceedsHardLimits) return;
    onConfirm(accepted, 'raw');
  }, [accepted, exceedsHardLimits, onConfirm]);

  if (!isOpen) return null;

  return (
    <DialogRoot onClose={onClose}>
      <DialogSurface
        width={600}
        maxHeight="85vh"
        ariaLabelledBy="file-import-dialog-title"
      >
        <DialogHeader title={<span id="file-import-dialog-title">Upload files</span>} onClose={onClose} />
        <DialogBody style={{ flex: 1 }}>
          <ImportTargetLine targetLabel={targetLabel} />
          <HiddenInputs
            fileInputRef={fileInputRef}
            folderInputRef={folderInputRef}
            onFileSelect={handleFileSelect}
          />

          <div
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{
              padding: files.length > 0 ? 0 : '28px 20px',
              border: '1px',
              borderStyle: files.length > 0 && !isDragging ? 'solid' : 'dashed',
              borderColor: isDragging ? 'var(--po-focus-ring)' : 'var(--po-border-strong)',
              borderRadius: 8,
              background: isDragging ? 'var(--po-selected)' : files.length > 0 ? 'var(--po-panel)' : 'transparent',
              transition: 'background 0.15s, border-color 0.15s',
              marginBottom: 16,
              overflow: 'hidden',
            }}
          >
            {files.length === 0 ? (
              <FileImportSourcePicker
                isDragging={isDragging}
                onPickFolder={handlePickFolder}
                onPickFiles={handlePickFiles}
              />
            ) : (
              <FileImportPreviewTree
                acceptedCount={accepted.length}
                totalAcceptedBytes={totalAcceptedBytes}
                fileStats={fileStats}
                previewTree={previewTree}
              />
            )}
          </div>

          <FileImportPolicySummary
            policyResult={policyResult}
            includeHidden={includeHidden}
            includeIgnored={includeIgnored}
            setIncludeHidden={setIncludeHidden}
            setIncludeIgnored={setIncludeIgnored}
          />
        </DialogBody>

        <DialogFooter justify="space-between">
          <div style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 12,
            color: 'var(--po-text-muted)',
          }}>
            <StatusDot tone="muted" style={{ marginRight: 6 }} />
            Raw upload
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <ActionButton onClick={onClose}>
              Cancel
            </ActionButton>
            <ActionButton
              onClick={handleConfirm}
              disabled={accepted.length === 0 || exceedsHardLimits}
              variant="primary"
            >
              {exceedsHardLimits
                ? 'Split Upload'
                : accepted.length > 0
                  ? `Import ${accepted.length} File${accepted.length > 1 ? 's' : ''}`
                  : 'Select Files'}
            </ActionButton>
          </div>
        </DialogFooter>
      </DialogSurface>
    </DialogRoot>
  );
}

function ImportTargetLine({ targetLabel }: { targetLabel: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 14,
        padding: '0 2px',
        color: 'var(--po-text-muted)',
        fontSize: 12,
        fontWeight: 500,
        maxWidth: '100%',
      }}
    >
      <span style={{ color: 'var(--po-text-subtle)' }}>Import to</span>
      <span style={{ color: 'var(--po-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {targetLabel}
      </span>
    </div>
  );
}

function HiddenInputs({
  fileInputRef,
  folderInputRef,
  onFileSelect,
}: {
  fileInputRef: RefObject<HTMLInputElement>;
  folderInputRef: RefObject<HTMLInputElement>;
  onFileSelect: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={onFileSelect}
        style={{ display: 'none' }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={onFileSelect}
        style={{ display: 'none' }}
      />
    </>
  );
}

export default FileImportDialog;
