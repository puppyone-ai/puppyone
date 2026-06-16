'use client';

import Editor, { OnMount, Monaco } from '@monaco-editor/react';
import { useRef, useCallback, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { EditorLoadingSurface } from '@/components/loading';
import { definePuppyoneMonacoThemes, getPuppyoneMonacoTheme } from '@/lib/theme/monacoThemes';

const MONACO_LOADING = <EditorLoadingSurface />;

interface Props {
  content: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}

export default function MonacoMarkdownEditor({ content, onChange, readOnly }: Props) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const { resolvedTheme } = useTheme();
  const themeName = getPuppyoneMonacoTheme('markdown', resolvedTheme);

  const handleBeforeMount = (monaco: Monaco) => {
    definePuppyoneMonacoThemes(monaco);
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.setTheme(themeName);
    monaco.languages.setLanguageConfiguration('markdown', {
      wordPattern: /(-?\d*\.\d\w*)|([^`~!@#%^&*()=\-[\]{}\\|;:'",.<>/?\s]+)/g,
    });
  };

  useEffect(() => {
    monacoRef.current?.editor?.setTheme(themeName);
  }, [themeName]);

  const handleChange = useCallback((value: string | undefined) => {
    if (onChange && !readOnly) onChange(value || '');
  }, [onChange, readOnly]);

  return (
    <div
      style={{
        height: '100%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--po-editor-bg)',
      }}
    >
      {!content && (
        <div style={{
          position: 'absolute',
          top: 'var(--po-editor-code-padding-block)',
          left: 'var(--po-editor-code-padding-inline)',
          color: 'var(--po-text-disabled)',
          fontStyle: 'italic',
          fontSize: 13,
          pointerEvents: 'none',
          zIndex: 1,
          fontFamily: 'var(--po-font-sans)',
        }}>
          Start writing...
        </div>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding:
            'var(--po-editor-code-padding-block) var(--po-editor-code-padding-inline) var(--po-editor-code-padding-bottom)',
          boxSizing: 'border-box',
        }}
      >
        <Editor
          height="100%"
          defaultLanguage="markdown"
          value={content}
          onChange={handleChange}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          theme={themeName}
          loading={MONACO_LOADING}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: 'var(--po-font-mono)',
            fontWeight: '500',
            lineNumbers: 'off',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: 'on',
            lineHeight: 20,
            padding: { top: 0, bottom: 0 },
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
    </div>
  );
}
