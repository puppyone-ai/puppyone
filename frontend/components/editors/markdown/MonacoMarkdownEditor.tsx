'use client';

import Editor, { OnMount, Monaco } from '@monaco-editor/react';
import { useRef, useCallback } from 'react';

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

interface Props {
  content: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}

export default function MonacoMarkdownEditor({ content, onChange, readOnly }: Props) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.defineTheme('markdown-dark', DARK_THEME_CONFIG);
    monaco.editor.setTheme('markdown-dark');
    monaco.languages.setLanguageConfiguration('markdown', {
      wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
    });
  };

  const handleChange = useCallback((value: string | undefined) => {
    if (onChange && !readOnly) onChange(value || '');
  }, [onChange, readOnly]);

  return (
    <div style={{ height: '100%', position: 'relative' }}>
      {!content && (
        <div style={{
          position: 'absolute', top: 16, left: 24,
          color: '#525252', fontStyle: 'italic', fontSize: 13,
          pointerEvents: 'none', zIndex: 1,
          fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Menlo, monospace",
        }}>
          Start writing...
        </div>
      )}
      <Editor
        height="100%"
        defaultLanguage="markdown"
        value={content}
        onChange={handleChange}
        onMount={handleMount}
        theme="markdown-dark"
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Menlo, monospace",
          lineNumbers: 'off',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          lineHeight: 20,
          padding: { top: 16, bottom: 40 },
          readOnly,
          renderLineHighlight: 'none',
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          scrollbar: { vertical: 'auto', horizontal: 'hidden', verticalScrollbarSize: 8 },
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          acceptSuggestionOnEnter: 'off',
          tabCompletion: 'off',
          wordBasedSuggestions: 'off',
          folding: true,
          foldingStrategy: 'indentation',
          renderWhitespace: 'none',
          guides: { indentation: false },
        }}
      />
    </div>
  );
}
