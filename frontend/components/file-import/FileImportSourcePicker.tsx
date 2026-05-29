'use client';

import { dropzoneActionButton, dropzonePrimaryActionButton } from './fileImportButtons';

interface FileImportSourcePickerProps {
  isDragging: boolean;
  onPickFolder: () => void;
  onPickFiles: () => void;
}

export function FileImportSourcePicker({
  isDragging,
  onPickFolder,
  onPickFiles,
}: FileImportSourcePickerProps) {
  return (
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
        Drag and drop a folder or files here
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 14 }}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPickFolder();
          }}
          style={{
            ...dropzoneActionButton,
            ...dropzonePrimaryActionButton,
          }}
        >
          Upload folder
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPickFiles();
          }}
          style={dropzoneActionButton}
        >
          Upload files
        </button>
      </div>
    </div>
  );
}
