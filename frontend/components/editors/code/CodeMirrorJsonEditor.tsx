'use client';

import React, { useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';

interface CodeMirrorJsonEditorProps {
  json: object;
  onChange?: (json: object) => void;
  onPathChange?: (path: string | null) => void;
}

export function CodeMirrorJsonEditor({
  json,
  onChange,
  onPathChange,
}: CodeMirrorJsonEditorProps) {
  const handleChange = useCallback(
    (value: string) => {
      if (!onChange) return;

      try {
        const parsed = JSON.parse(value);
        onChange(parsed);
      } catch (error) {
        // Invalid JSON, don't update
      }
    },
    [onChange]
  );

  const handleUpdate = useCallback(
    (viewUpdate: any) => {
      if (!onPathChange) return;

      try {
        const { state } = viewUpdate;
        const pos = state.selection.main.head;
        const content = state.doc.toString();

        // Simple path extraction
        const path = getJsonPathAtOffset(content, pos);
        onPathChange(path);
      } catch (error) {
        // Ignore errors
      }
    },
    [onPathChange]
  );

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <CodeMirror
        value={JSON.stringify(json, null, 2)}
        height='100%'
        theme='dark'
        extensions={[(json as any)()]}
        onChange={handleChange}
        onUpdate={handleUpdate}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: true,
          foldGutter: true,
          drawSelection: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          searchKeymap: true,
          foldKeymap: true,
          completionKeymap: true,
          lintKeymap: true,
        }}
        style={{
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        }}
      />
    </div>
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

    for (let i = 0; i < before.length; i++) {
      const char = before[i];

      if (char === '"' && (i === 0 || before[i - 1] !== '\\')) {
        inString = !inString;
        if (!inString && depth > 0) {
          const colonIndex = before.indexOf(':', i);
          if (
            colonIndex !== -1 &&
            (before.indexOf(',', i) === -1 ||
              colonIndex < before.indexOf(',', i))
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
          }
          depth++;
        } else if (char === '}' || char === ']') {
          depth--;
          if (depth < path.length) {
            path.pop();
          }
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

export default CodeMirrorJsonEditor;
