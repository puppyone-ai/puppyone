'use client';

import React, { useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { EditorLoadingSurface } from '@/components/loading';

const MONACO_LOADING = (
  <EditorLoadingSurface />
);

const DARK_THEME_CONFIG = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: '', foreground: 'd4d4d4', background: '0a0a0a' },
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f97316' },
    { token: 'string', foreground: '86efac' },
    { token: 'number', foreground: '7dd3fc' },
    { token: 'delimiter', foreground: '737373' },
    { token: 'type', foreground: 'a5b4fc' },
  ],
  colors: {
    'editor.background': '#0e0e0e',
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

interface MonacoCodeViewerProps {
  content: string;
  /** Monaco language id — see `FileFormat.monacoLanguage` for the
   *  authoritative mapping. Falls back to `'plaintext'`. */
  language?: string;
  fileName?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}

/**
 * Generic read-only (or optionally editable) code viewer used by every
 * `category: 'code'` / `category: 'text'` / non-table data format in
 * the registry. One Monaco instance covers 30+ languages — way better
 * than a per-extension viewer.
 */
export function MonacoCodeViewer({
  content,
  language = 'plaintext',
  fileName,
  readOnly = true,
  onChange,
}: MonacoCodeViewerProps) {
  const editorRef = useRef<unknown>(null);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monaco.editor.defineTheme('code-dark', DARK_THEME_CONFIG);
    monaco.editor.setTheme('code-dark');
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: '#0a0a0a',
      }}
    >
      {fileName && (
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid #262626',
            fontSize: 12,
            color: '#a1a1aa',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 500 }}>{fileName}</span>
          <span style={{ color: '#525252', textTransform: 'uppercase' }}>{language}</span>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          height="100%"
          language={language}
          value={content}
          onChange={(value) => onChange?.(value ?? '')}
          onMount={handleEditorMount}
          theme="code-dark"
          loading={MONACO_LOADING}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
            folding: true,
            bracketPairColorization: { enabled: true },
            renderWhitespace: 'none',
          }}
        />
      </div>
    </div>
  );
}

export default MonacoCodeViewer;
