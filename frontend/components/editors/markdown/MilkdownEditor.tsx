'use client';

import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';

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

  /* Task list - Milkdown uses data-item-type="task" and data-checked */
  .milkdown-editor li[data-item-type="task"] {
    list-style: none !important;
    position: relative;
    padding-left: 28px;
    margin-left: -4px;
  }

  /* Checkbox visual using ::before pseudo-element */
  .milkdown-editor li[data-item-type="task"]::before {
    content: '';
    position: absolute;
    left: 0;
    top: 5px;
    width: 16px;
    height: 16px;
    border: 2px solid #525252;
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  /* Checked state */
  .milkdown-editor li[data-item-type="task"][data-checked="true"]::before {
    background: #22c55e;
    border-color: #22c55e;
  }

  /* Checkmark icon for checked items */
  .milkdown-editor li[data-item-type="task"][data-checked="true"]::after {
    content: '';
    position: absolute;
    left: 6px;
    top: 8px;
    width: 5px;
    height: 9px;
    border: solid #0a0a0a;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  /* Strikethrough text for completed tasks */
  .milkdown-editor li[data-item-type="task"][data-checked="true"] {
    color: #6b7280;
  }

  .milkdown-editor li[data-item-type="task"][data-checked="true"] > p {
    text-decoration: line-through;
  }

  /* Unchecked hover state */
  .milkdown-editor li[data-item-type="task"][data-checked="false"]::before,
  .milkdown-editor li[data-item-type="task"]:not([data-checked="true"])::before {
    border-color: #525252;
  }

  .milkdown-editor li[data-item-type="task"][data-checked="false"]:hover::before,
  .milkdown-editor li[data-item-type="task"]:not([data-checked="true"]):hover::before {
    border-color: #737373;
    background: #1a1a1a;
  }

  /* Ensure task list container doesn't show bullets */
  .milkdown-editor ul:has(> li[data-item-type="task"]) {
    list-style: none !important;
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

// Plugin to handle task list checkbox clicks
const taskListClickPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey('task-list-click'),
    props: {
      handleClick(view, pos, event) {
        const { target } = event;
        if (!(target instanceof HTMLElement)) return false;
        
        // Check if clicked on a task list item (within the checkbox area)
        const li = target.closest('li[data-item-type="task"]');
        if (!li) return false;
        
        // Only toggle if clicked on the left side (checkbox area)
        const rect = li.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        if (clickX > 28) return false; // Only respond to clicks in the checkbox area
        
        // Find the node position
        const $pos = view.state.doc.resolve(pos);
        let nodePos = $pos.before($pos.depth);
        let node = view.state.doc.nodeAt(nodePos);
        
        // Walk up to find the list item node
        for (let depth = $pos.depth; depth >= 0; depth--) {
          const n = view.state.doc.nodeAt($pos.before(depth));
          if (n?.type.name === 'list_item' && n.attrs.checked != null) {
            nodePos = $pos.before(depth);
            node = n;
            break;
          }
        }
        
        if (!node || node.attrs.checked == null) return false;
        
        // Toggle the checked state
        const tr = view.state.tr.setNodeMarkup(nodePos, undefined, {
          ...node.attrs,
          checked: !node.attrs.checked,
        });
        view.dispatch(tr);
        return true;
      },
    },
  });
});

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
      .use(listener)
      .use(taskListClickPlugin);
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

