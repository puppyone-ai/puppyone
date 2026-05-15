'use client';

import React, { useEffect, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
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
  const themeName = getPuppyoneMonacoTheme('code', resolvedTheme);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    definePuppyoneMonacoThemes(monaco);
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
        background: 'var(--po-inset)',
      }}
    >
      {fileName && (
        <div
          style={{
            padding: '8px 16px',
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
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          height="100%"
          language={language}
          value={content}
          onChange={(value) => onChange?.(value ?? '')}
          onMount={handleEditorMount}
          theme={themeName}
          loading={MONACO_LOADING}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: 'var(--po-font-sans)',
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
