'use client';

import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';

// Custom dark theme CSS
// Design: line-height 24px + margin 8px = 40px visual rhythm
const darkThemeStyles = `
  .milkdown-editor {
    background: #0a0a0a;
    color: #d4d4d4;
    font-family: 'SF Pro Text', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 14px;
    line-height: 24px;
    padding: 24px 32px;
    min-height: 100%;
    outline: none;
    max-width: 800px;
    margin: 0 auto;
  }

  .milkdown-editor .editor {
    outline: none;
  }

  /* Headings */
  .milkdown-editor h1 {
    font-size: 24px;
    font-weight: 600;
    line-height: 32px;
    color: #f9fafb;
    margin: 24px 0 8px 0;
    padding-bottom: 8px;
    border-bottom: 1px solid #262626;
  }

  .milkdown-editor h2 {
    font-size: 20px;
    font-weight: 600;
    line-height: 28px;
    color: #f9fafb;
    margin: 20px 0 8px 0;
    padding-bottom: 6px;
    border-bottom: 1px solid #1a1a1a;
  }

  .milkdown-editor h3 {
    font-size: 16px;
    font-weight: 600;
    line-height: 24px;
    color: #f9fafb;
    margin: 16px 0 8px 0;
  }

  .milkdown-editor h4, .milkdown-editor h5, .milkdown-editor h6 {
    font-size: 14px;
    font-weight: 600;
    line-height: 24px;
    color: #e5e5e5;
    margin: 12px 0 8px 0;
  }

  /* Paragraphs */
  .milkdown-editor p {
    margin: 8px 0;
  }

  /* Links */
  .milkdown-editor a {
    color: #60a5fa;
    text-decoration: none;
  }

  .milkdown-editor a:hover {
    text-decoration: underline;
  }

  /* Lists */
  .milkdown-editor ul, .milkdown-editor ol {
    margin: 8px 0;
    padding-left: 24px;
  }

  .milkdown-editor li {
    margin: 4px 0;
  }

  .milkdown-editor li::marker {
    color: #737373;
  }

  /* Blockquote */
  .milkdown-editor blockquote {
    margin: 8px 0;
    padding: 8px 16px;
    border-left: 3px solid #404040;
    background: #141414;
    border-radius: 0 6px 6px 0;
    color: #a1a1aa;
    line-height: 24px;
  }

  /* Code */
  .milkdown-editor code {
    font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', Menlo, monospace;
    font-size: 13px;
    background: #1a1a1a;
    padding: 1px 5px;
    border-radius: 3px;
    color: #86efac;
  }

  .milkdown-editor pre {
    margin: 8px 0;
    padding: 12px 16px;
    background: #0f0f0f;
    border: 1px solid #1a1a1a;
    border-radius: 6px;
    overflow-x: auto;
  }

  .milkdown-editor pre code {
    background: transparent;
    padding: 0;
    font-size: 13px;
    line-height: 20px;
  }

  /* Table */
  .milkdown-editor table {
    width: 100%;
    margin: 8px 0;
    border-collapse: separate;
    border-spacing: 0;
    border: 1px solid #262626;
    border-radius: 6px;
    overflow: hidden;
    font-size: 13px;
    line-height: 20px;
  }

  .milkdown-editor th {
    padding: 8px 12px;
    text-align: left;
    font-weight: 600;
    color: #d4d4d4;
    background: #141414;
    border-bottom: 1px solid #262626;
    border-right: 1px solid #1a1a1a;
  }

  .milkdown-editor td {
    padding: 6px 12px;
    border-bottom: 1px solid #1a1a1a;
    border-right: 1px solid #1a1a1a;
    color: #a1a1aa;
  }

  .milkdown-editor th:last-child, .milkdown-editor td:last-child {
    border-right: none;
  }

  .milkdown-editor tr:last-child td {
    border-bottom: none;
  }

  /* Horizontal rule */
  .milkdown-editor hr {
    border: none;
    border-top: 1px solid #262626;
    margin: 16px 0;
  }

  /* Task list */
  .milkdown-editor .task-list-item {
    list-style: none;
    margin-left: -24px;
    padding-left: 24px;
    position: relative;
  }

  .milkdown-editor .task-list-item input[type="checkbox"] {
    position: absolute;
    left: 0;
    top: 6px;
    width: 16px;
    height: 16px;
    accent-color: #f97316;
  }

  /* Strong & Em */
  .milkdown-editor strong {
    font-weight: 600;
    color: #f9fafb;
  }

  .milkdown-editor em {
    font-style: italic;
    color: #d4d4d4;
  }

  /* Strikethrough */
  .milkdown-editor del {
    text-decoration: line-through;
    color: #737373;
  }

  /* Selection */
  .milkdown-editor ::selection {
    background: #3f3f46;
  }

  /* Placeholder - show when editor is empty */
  .milkdown-editor .ProseMirror > p:first-child:last-child:empty::before,
  .milkdown-editor .ProseMirror > p:first-child:last-child:has(br:only-child)::before {
    content: 'Start writing...';
    color: #525252;
    pointer-events: none;
    position: absolute;
    font-style: italic;
  }
  
  /* Also handle completely empty editor */
  .milkdown-editor .ProseMirror:empty::before {
    content: 'Start writing...';
    color: #525252;
    pointer-events: none;
    font-style: italic;
  }

  /* Focus */
  .milkdown-editor:focus-within {
    outline: none;
  }
  
  /* Ensure clicking anywhere focuses the editor */
  .milkdown-editor .ProseMirror {
    min-height: calc(100vh - 150px);
    cursor: text;
  }

  /* Image */
  .milkdown-editor img {
    max-width: 100%;
    border-radius: 8px;
    margin: 16px 0;
  }
`;

interface MilkdownEditorContentProps {
  defaultValue: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
}

function MilkdownEditorContent({ defaultValue, onChange, readOnly }: MilkdownEditorContentProps) {
  const { get } = useEditor((root) => {
    return Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, defaultValue);
        
        if (onChange) {
          ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
            onChange(markdown);
          });
        }
      })
      .use(commonmark)
      .use(gfm)
      .use(listener);
  }, []);

  return <Milkdown />;
}

export interface MilkdownEditorRef {
  getMarkdown: () => string;
}

interface MilkdownEditorProps {
  content: string;
  onChange?: (content: string) => void;
  readOnly?: boolean;
}

export const MilkdownEditor = forwardRef<MilkdownEditorRef, MilkdownEditorProps>(
  function MilkdownEditor({ content, onChange, readOnly = false }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      getMarkdown: () => content,
    }));

    return (
      <div
        ref={containerRef}
        className="milkdown-editor"
        style={{
          height: '100%',
          width: '100%',
          overflow: 'auto',
          background: '#0a0a0a',
        }}
      >
        <style>{darkThemeStyles}</style>
        <MilkdownProvider>
          <MilkdownEditorContent
            defaultValue={content}
            onChange={onChange}
            readOnly={readOnly}
          />
        </MilkdownProvider>
      </div>
    );
  }
);

export default MilkdownEditor;

