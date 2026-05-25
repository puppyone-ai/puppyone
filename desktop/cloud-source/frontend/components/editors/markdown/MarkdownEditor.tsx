'use client';

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { EditorLoadingSurface } from '@/components/loading';

const EditorLoader = () => <EditorLoadingSurface label="Loading editor..." />;

const MonacoMarkdownEditor = dynamic(() => import('./MonacoMarkdownEditor'), {
  ssr: false,
  loading: EditorLoader,
});

const MilkdownEditor = dynamic(() => import('./MilkdownEditor'), {
  ssr: false,
  loading: EditorLoader,
});

export type MarkdownViewMode = 'wysiwyg' | 'source' | 'preview';

interface MarkdownEditorProps {
  content: string;
  onChange?: (content: string) => void;
  readOnly?: boolean;
  defaultMode?: MarkdownViewMode;
  viewMode?: MarkdownViewMode;
  onViewModeChange?: (mode: MarkdownViewMode) => void;
}

export function MarkdownEditor({
  content,
  onChange,
  readOnly = false,
  defaultMode = 'wysiwyg',
  viewMode: controlledViewMode,
  onViewModeChange,
}: MarkdownEditorProps) {
  const [internalViewMode, setInternalViewMode] = useState<MarkdownViewMode>(defaultMode);
  const isControlled = controlledViewMode !== undefined;
  const viewMode = isControlled ? controlledViewMode : internalViewMode;
  const setViewMode = isControlled ? (mode: MarkdownViewMode) => onViewModeChange?.(mode) : setInternalViewMode;
  const [localContent, setLocalContent] = useState(content);

  useEffect(() => {
    setLocalContent(content);
  }, [content]);

  const handleMilkdownChange = useCallback((newContent: string) => {
    setLocalContent(newContent);
    if (onChange && !readOnly) onChange(newContent);
  }, [onChange, readOnly]);

  const isPreview = viewMode === 'preview';
  const effectiveReadOnly = readOnly || isPreview;

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        background: 'var(--po-canvas)',
      }}
    >
      {(viewMode === 'wysiwyg' || isPreview) && (
        <MilkdownEditor
          content={localContent}
          onChange={isPreview ? undefined : handleMilkdownChange}
          readOnly={effectiveReadOnly}
        />
      )}

      {viewMode === 'source' && (
        <MonacoMarkdownEditor
          content={localContent}
          onChange={(value) => {
            setLocalContent(value);
            if (onChange && !readOnly) onChange(value);
          }}
          readOnly={readOnly}
        />
      )}

      {!isControlled && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            zIndex: 20,
            display: 'flex',
            background: 'var(--po-control)',
            borderRadius: 6,
            padding: 2,
            gap: 1,
            border: '1px solid var(--po-border)',
            boxShadow: '0 4px 12px var(--po-shadow)',
          }}
        >
          <button
            onClick={() => setViewMode('wysiwyg')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              borderRadius: 4,
              border: 'none',
              background: viewMode === 'wysiwyg' ? 'var(--po-selected)' : 'transparent',
              color: viewMode === 'wysiwyg' ? 'var(--po-text)' : 'var(--po-text-subtle)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            title="WYSIWYG"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode('source')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 24,
              height: 24,
              borderRadius: 4,
              border: 'none',
              background: viewMode === 'source' ? 'var(--po-selected)' : 'transparent',
              color: viewMode === 'source' ? 'var(--po-text)' : 'var(--po-text-subtle)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            title="Source"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

export default MarkdownEditor;
