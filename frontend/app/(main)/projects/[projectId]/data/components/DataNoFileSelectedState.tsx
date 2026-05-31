'use client';

import { FileText } from 'lucide-react';
import { BUTTON_HEIGHT } from '@/components/ui/buttonTokens';

interface DataNoFileSelectedStateProps {
  readonly onCreateMarkdown: () => void | Promise<void>;
  readonly onUploadClick: () => void;
}

export function DataNoFileSelectedState({
  onCreateMarkdown,
  onUploadClick,
}: DataNoFileSelectedStateProps) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        background: 'var(--po-canvas)',
      }}
    >
      <div
        style={{
          width: 'min(360px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <div
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
            color: 'var(--po-text-muted)',
            background: 'color-mix(in srgb, var(--po-control) 58%, transparent)',
            border: '1px solid var(--po-border-subtle)',
          }}
        >
          <FileText size={16} strokeWidth={1.75} />
        </div>

        <h2
          style={{
            margin: 0,
            fontSize: 15,
            lineHeight: '22px',
            fontWeight: 600,
            letterSpacing: 0,
            color: 'var(--po-text)',
          }}
        >
          No file selected
        </h2>
        <p
          style={{
            margin: '6px 0 0',
            maxWidth: 360,
            fontSize: 12,
            lineHeight: '18px',
            fontWeight: 400,
            letterSpacing: 0,
            color: 'var(--po-text-muted)',
          }}
        >
          Select a file from the sidebar, or start a note.
        </p>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 9,
            marginTop: 16,
          }}
        >
          <button
            type="button"
            onClick={() => {
              void onCreateMarkdown();
            }}
            style={{
              height: BUTTON_HEIGHT,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '0 12px',
              borderRadius: 7,
              border: '1px solid var(--po-text)',
              background: 'var(--po-text)',
              color: 'var(--po-canvas)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <FileText size={14} strokeWidth={1.9} />
            New note
          </button>
          <button
            type="button"
            onClick={onUploadClick}
            style={{
              height: 24,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 8px',
              borderRadius: 5,
              border: 0,
              background: 'transparent',
              color: 'var(--po-text-subtle)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Upload files
          </button>
        </div>
      </div>
    </div>
  );
}
