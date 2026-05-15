'use client';

import React, { useEffect, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useTheme } from 'next-themes';
import { EditorLoadingSurface } from '@/components/loading';
import { definePuppyoneMonacoThemes, getPuppyoneMonacoTheme } from '@/lib/theme/monacoThemes';

const MONACO_LOADING = <EditorLoadingSurface />;
const JSON_SOURCE_FONT = 'var(--po-font-sans)';

interface MonacoJsonEditorProps {
  json: object;
  onChange?: (json: object) => void;
  onPathChange?: (path: string | null) => void;
}

export function MonacoJsonEditor({ json, onChange, onPathChange }: MonacoJsonEditorProps) {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const { resolvedTheme } = useTheme();
  const themeName = getPuppyoneMonacoTheme('json', resolvedTheme);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    definePuppyoneMonacoThemes(monaco);
    monaco.editor.setTheme(themeName);

    editor.onDidChangeCursorPosition((e: any) => {
      if (!onPathChange) return;

      try {
        const model = editor.getModel();
        if (!model) return;
        const offset = model.getOffsetAt(e.position);
        const path = getJsonPathAtOffset(model.getValue(), offset);
        onPathChange(path);
      } catch {
        // Ignore cursor parsing errors.
      }
    });
  };

  useEffect(() => {
    monacoRef.current?.editor?.setTheme(themeName);
  }, [themeName]);

  const handleEditorChange = (value: string | undefined) => {
    if (!value || !onChange) return;
    try {
      onChange(JSON.parse(value));
    } catch {
      // Invalid JSON: keep local editor state, don't publish upstream.
    }
  };

  return (
    <Editor
      height="100%"
      defaultLanguage="json"
      value={JSON.stringify(json, null, 2)}
      onChange={handleEditorChange}
      onMount={handleEditorMount}
      theme={themeName}
      loading={MONACO_LOADING}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: JSON_SOURCE_FONT,
        fontWeight: '400',
        lineHeight: 20,
        lineNumbers: 'on',
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        padding: { top: 16, bottom: 40 },
        folding: true,
        bracketPairColorization: { enabled: true },
        formatOnPaste: true,
        formatOnType: true,
        renderLineHighlight: 'none',
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        scrollbar: {
          vertical: 'auto',
          horizontal: 'hidden',
          verticalScrollbarSize: 8,
        },
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        acceptSuggestionOnEnter: 'off',
        tabCompletion: 'off',
        wordBasedSuggestions: 'off',
        renderWhitespace: 'none',
        guides: { indentation: false },
      }}
    />
  );
}

function getJsonPathAtOffset(content: string, offset: number): string | null {
  try {
    const before = content.substring(0, offset);
    const path: string[] = [];
    let depth = 0;
    let inString = false;
    let currentKey = '';
    let arrayIndex = 0;

    for (let i = 0; i < before.length; i++) {
      const char = before[i];

      if (char === '"' && (i === 0 || before[i - 1] !== '\\')) {
        inString = !inString;
        if (!inString && depth > 0) {
          const colonIndex = before.indexOf(':', i);
          if (
            (colonIndex !== -1 && colonIndex < before.indexOf(',', i)) ||
            before.indexOf(',', i) === -1
          ) {
            currentKey = before.substring(before.lastIndexOf('"', i - 1) + 1, i);
          }
        }
      } else if (!inString) {
        if (char === '{' || char === '[') {
          if (currentKey) {
            path.push(currentKey);
            currentKey = '';
          } else if (char === '[') {
            arrayIndex = 0;
          }
          depth++;
        } else if (char === '}' || char === ']') {
          depth--;
          if (depth < path.length) path.pop();
        } else if (char === ',') {
          arrayIndex++;
        }
      }
    }

    if (currentKey) path.push(currentKey);
    return path.length > 0 ? `/${path.join('/')}` : null;
  } catch {
    return null;
  }
}

export default MonacoJsonEditor;
