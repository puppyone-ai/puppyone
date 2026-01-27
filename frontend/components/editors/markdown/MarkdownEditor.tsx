'use client';

import React, { useRef, useState, useEffect, useCallback, Suspense } from 'react';
import Editor, { OnMount, Monaco } from '@monaco-editor/react';
import dynamic from 'next/dynamic';

// Dynamically import MilkdownEditor to avoid SSR issues
const MilkdownEditor = dynamic(() => import('./MilkdownEditor'), {
  ssr: false,
  loading: () => (
    <div style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#525252',
      background: '#0a0a0a',
    }}>
      Loading editor...
    </div>
  ),
});

export type MarkdownViewMode = 'wysiwyg' | 'source';

interface MarkdownEditorProps {
  content: string;
  onChange?: (content: string) => void;
  readOnly?: boolean;
  defaultMode?: MarkdownViewMode;
}

// Custom dark theme matching the app style (pure gray, not blue-tinted)
const DARK_THEME_CONFIG = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: '', foreground: 'd4d4d4', background: '0a0a0a' },
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f97316' },
    { token: 'string', foreground: '86efac' },
    { token: 'number', foreground: '7dd3fc' },
    { token: 'markup.heading', foreground: 'f9fafb', fontStyle: 'bold' },
    { token: 'markup.bold', fontStyle: 'bold' },
    { token: 'markup.italic', fontStyle: 'italic' },
    { token: 'markup.inline.raw', foreground: '86efac' },
    { token: 'markup.quote', foreground: '6b7280' },
    { token: 'markup.list', foreground: 'f97316' },
  ],
  colors: {
    'editor.background': '#0a0a0a',
    'editor.foreground': '#d4d4d4',
    'editor.lineHighlightBackground': '#141414',
    'editor.selectionBackground': '#3f3f46',
    'editor.inactiveSelectionBackground': '#3f3f4655',
    'editorLineNumber.foreground': '#404040',
    'editorLineNumber.activeForeground': '#737373',
    'editorCursor.foreground': '#d4d4d4',
    'editor.selectionHighlightBackground': '#52525b33',
    'editorIndentGuide.background': '#1a1a1a',
    'editorIndentGuide.activeBackground': '#262626',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#40404055',
    'scrollbarSlider.hoverBackground': '#52525b88',
    'scrollbarSlider.activeBackground': '#52525b88',
  },
};

export function MarkdownEditor({
  content,
  onChange,
  readOnly = false,
  defaultMode = 'wysiwyg',
}: MarkdownEditorProps) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [viewMode, setViewMode] = useState<MarkdownViewMode>(defaultMode);
  const [localContent, setLocalContent] = useState(content);

  // Sync content when prop changes
  useEffect(() => {
    setLocalContent(content);
  }, [content]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Register custom dark theme
    monaco.editor.defineTheme('markdown-dark', DARK_THEME_CONFIG);
    monaco.editor.setTheme('markdown-dark');

    // Configure markdown language
    monaco.languages.setLanguageConfiguration('markdown', {
      wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
    });
  };

  const handleEditorChange = useCallback((value: string | undefined) => {
    const newContent = value || '';
    setLocalContent(newContent);
    if (onChange && !readOnly) {
      onChange(newContent);
    }
  }, [onChange, readOnly]);

  const handleMilkdownChange = useCallback((newContent: string) => {
    setLocalContent(newContent);
    if (onChange && !readOnly) {
      onChange(newContent);
    }
  }, [onChange, readOnly]);

  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        background: '#0a0a0a',
      }}
    >
      {/* WYSIWYG Mode - Milkdown */}
      {viewMode === 'wysiwyg' && (
        <MilkdownEditor
          content={localContent}
          onChange={handleMilkdownChange}
          readOnly={readOnly}
        />
      )}

      {/* Source Mode - Monaco Editor */}
      {viewMode === 'source' && (
        <div style={{ height: '100%', position: 'relative' }}>
          {/* Placeholder when empty */}
          {!localContent && (
            <div
              style={{
                position: 'absolute',
                top: 24,
                left: 32,
                color: '#525252',
                fontStyle: 'italic',
                fontSize: 14,
                pointerEvents: 'none',
                zIndex: 1,
                fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Menlo, monospace",
              }}
            >
              Start writing...
            </div>
          )}
          <Editor
            height="100%"
            defaultLanguage="markdown"
            value={localContent}
            onChange={handleEditorChange}
            onMount={handleEditorMount}
            theme="markdown-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Menlo, monospace",
              lineNumbers: 'off',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'on',
              lineHeight: 24,
              padding: { top: 24, bottom: 60 },
              readOnly,
              renderLineHighlight: 'none',
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              scrollbar: {
                vertical: 'auto',
                horizontal: 'hidden',
                verticalScrollbarSize: 8,
              },
              // Markdown-friendly settings
              quickSuggestions: false,
              suggestOnTriggerCharacters: false,
              acceptSuggestionOnEnter: 'off',
              tabCompletion: 'off',
              wordBasedSuggestions: 'off',
              folding: true,
              foldingStrategy: 'indentation',
              renderWhitespace: 'none',
              guides: {
                indentation: false,
              },
            }}
          />
        </div>
      )}

      {/* View Mode Toggle - Bottom Right */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          zIndex: 20,
          display: 'flex',
          background: '#1a1a1a',
          borderRadius: 6,
          padding: 2,
          gap: 1,
          border: '1px solid #2a2a2a',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
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
            background: viewMode === 'wysiwyg' ? '#2a2a2a' : 'transparent',
            color: viewMode === 'wysiwyg' ? '#fff' : '#737373',
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
            background: viewMode === 'source' ? '#2a2a2a' : 'transparent',
            color: viewMode === 'source' ? '#fff' : '#737373',
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
    </div>
  );
}

export default MarkdownEditor;
