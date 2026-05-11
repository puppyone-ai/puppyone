'use client';

import React, { useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { EditorLoadingSurface } from '@/components/loading';

/**
 * Monaco's default loading state is a spinning ring while the worker
 * scripts and theme registration finish. The `<Editor />` component
 * accepts a `loading` prop for replacement; we feed it the unified
 * `<PageLoading />` (block + "Loading" label) so the brand-consistent
 * loader takes over from the generic Monaco spinner.
 */
const MONACO_LOADING = (
  <EditorLoadingSurface />
);

const JSON_SOURCE_FONT =
  "'JetBrains Mono', 'SF Mono', 'Fira Code', Menlo, monospace";

const DARK_THEME_CONFIG = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: '', foreground: 'd4d4d4', background: '0a0a0a' },
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f97316' },
    { token: 'string', foreground: '86efac' },
    { token: 'string.key.json', foreground: 'a5b4fc' },
    { token: 'string.value.json', foreground: '86efac' },
    { token: 'number', foreground: '7dd3fc' },
    { token: 'delimiter', foreground: '737373' },
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

interface MonacoJsonEditorProps {
  json: object;
  onChange?: (json: object) => void;
  onPathChange?: (path: string | null) => void;
}

export function MonacoJsonEditor({
  json,
  onChange,
  onPathChange,
}: MonacoJsonEditorProps) {
  const editorRef = useRef<any>(null);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    monaco.editor.defineTheme('json-dark', DARK_THEME_CONFIG);
    monaco.editor.setTheme('json-dark');

    editor.onDidChangeCursorPosition((e: any) => {
      if (!onPathChange) return;

      try {
        const model = editor.getModel();
        if (!model) return;

        const position = e.position;
        const offset = model.getOffsetAt(position);
        const content = model.getValue();

        const path = getJsonPathAtOffset(content, offset);
        onPathChange(path);
      } catch (error) {
        // Ignore errors
      }
    });
  };

  const handleEditorChange = (value: string | undefined) => {
    if (!value || !onChange) return;

    try {
      const parsed = JSON.parse(value);
      onChange(parsed);
    } catch (error) {
      // Invalid JSON, don't update
    }
  };

  return (
    <Editor
      height='100%'
      defaultLanguage='json'
      value={JSON.stringify(json, null, 2)}
      onChange={handleEditorChange}
      onMount={handleEditorMount}
      theme='json-dark'
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

// Helper function to extract JSON path at cursor offset
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
          // End of a key
          const colonIndex = before.indexOf(':', i);
          if (
            (colonIndex !== -1 && colonIndex < before.indexOf(',', i)) ||
            before.indexOf(',', i) === -1
          ) {
            currentKey = before.substring(
              before.lastIndexOf('"', i - 1) + 1,
              i
            );
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
          if (depth < path.length) {
            path.pop();
          }
        } else if (char === ',') {
          arrayIndex++;
        }
      }
    }

    if (currentKey) {
      path.push(currentKey);
    }

    return path.length > 0 ? '/' + path.join('/') : null;
  } catch (error) {
    return null;
  }
}

export default MonacoJsonEditor;
