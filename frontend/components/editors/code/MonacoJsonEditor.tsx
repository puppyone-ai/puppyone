'use client';

import React, { useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';

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

    // Set up cursor position change listener for path tracking
    editor.onDidChangeCursorPosition((e: any) => {
      if (!onPathChange) return;

      try {
        const model = editor.getModel();
        if (!model) return;

        const position = e.position;
        const offset = model.getOffsetAt(position);
        const content = model.getValue();

        // Simple JSON path extraction based on cursor position
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
      theme='vs-dark'
      options={{
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
        formatOnPaste: true,
        formatOnType: true,
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
