'use client';

import React, { useEffect, useRef } from 'react';
import Editor, { OnMount, type Monaco } from '@monaco-editor/react';
import { useTheme } from 'next-themes';
import { EditorLoadingSurface } from '@/components/loading';
import { definePuppyoneMonacoThemes, getPuppyoneMonacoTheme } from '@/lib/theme/monacoThemes';

const MONACO_LOADING = <EditorLoadingSurface />;

interface MonacoCodeViewerProps {
  content: string;
  language?: string;
  fileName?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}

function getThemeKindForLanguage(language: string): 'code' | 'json' | 'markdown' {
  const normalized = language.toLowerCase();
  if (normalized === 'json' || normalized === 'jsonc' || normalized === 'json5') return 'json';
  if (normalized === 'markdown' || normalized === 'mdx') return 'markdown';
  return 'code';
}

export function MonacoCodeViewer({
  content,
  language = 'plaintext',
  fileName,
  readOnly = true,
  onChange,
}: MonacoCodeViewerProps) {
  const editorRef = useRef<unknown>(null);
  const monacoRef = useRef<any>(null);
  const { resolvedTheme } = useTheme();
  const themeName = getPuppyoneMonacoTheme(getThemeKindForLanguage(language), resolvedTheme);

  const handleBeforeMount = (monaco: Monaco) => {
    definePuppyoneMonacoThemes(monaco);
  };

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.setTheme(themeName);
  };

  useEffect(() => {
    monacoRef.current?.editor?.setTheme(themeName);
  }, [themeName]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: 'var(--po-editor-bg)',
      }}
    >
      {fileName && (
        <div
          style={{
            padding: '8px var(--po-editor-code-padding-inline)',
            borderBottom: '1px solid var(--po-border)',
            fontSize: 12,
            color: 'var(--po-text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 500 }}>{fileName}</span>
          <span style={{ color: 'var(--po-text-disabled)', textTransform: 'uppercase' }}>{language}</span>
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          padding:
            'var(--po-editor-code-padding-block) var(--po-editor-code-padding-inline) var(--po-editor-code-padding-bottom)',
          boxSizing: 'border-box',
          background: 'var(--po-editor-bg)',
        }}
      >
        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            height="100%"
            language={language}
            value={content}
            onChange={(value) => onChange?.(value ?? '')}
            beforeMount={handleBeforeMount}
            onMount={handleEditorMount}
            theme={themeName}
            loading={MONACO_LOADING}
            options={{
              readOnly,
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: 'var(--po-font-mono)',
              lineNumbers: 'on',
              lineNumbersMinChars: 3,
              lineDecorationsWidth: 12,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: 'on',
              folding: true,
              bracketPairColorization: { enabled: true },
              renderWhitespace: 'none',
              padding: { top: 0, bottom: 0 },
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default MonacoCodeViewer;
