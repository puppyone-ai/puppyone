'use client';

import Editor, { OnMount, Monaco } from '@monaco-editor/react';
import { useRef, useCallback, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { EditorLoadingSurface } from '@/components/loading';
import { definePuppyoneMonacoThemes, getPuppyoneMonacoTheme } from '@/lib/theme/monacoThemes';
import { ConflictMarkerBanner } from '@/components/editors/ConflictMarkerBanner';

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

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    definePuppyoneMonacoThemes(monaco);
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
    <div style={{ height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <ConflictMarkerBanner
        content={content}
        onResolve={readOnly ? undefined : onChange}
      />
      {!content && (
        <div style={{
          position: 'absolute',
          top: 16,
          left: 24,
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
      <Editor
        height="100%"
        defaultLanguage="markdown"
        value={content}
        onChange={handleChange}
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
