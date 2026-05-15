'use client';

import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
} from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { PROJECT_CONTENT_RAIL_WIDTH } from '@/lib/layout';

// Theme-aware Milkdown CSS.
// Design: line-height 24px + margin 8px = 40px visual rhythm
const editorThemeStyles = `
  .milkdown-editor {
    background: var(--po-canvas);
    color: var(--po-text-muted);
    font-family: var(--po-font-sans);
    font-size: 14px;
    line-height: 24px;
    padding: 24px 32px;
    box-sizing: border-box;
    outline: none;
    max-width: ${PROJECT_CONTENT_RAIL_WIDTH}px;
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
    color: var(--po-text);
    margin: 24px 0 8px 0;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--po-border);
  }

  .milkdown-editor h2 {
    font-size: 20px;
    font-weight: 600;
    line-height: 28px;
    color: var(--po-text);
    margin: 20px 0 8px 0;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--po-border-subtle);
  }

  .milkdown-editor h3 {
    font-size: 16px;
    font-weight: 600;
    line-height: 24px;
    color: var(--po-text);
    margin: 16px 0 8px 0;
  }

  .milkdown-editor h4, .milkdown-editor h5, .milkdown-editor h6 {
    font-size: 14px;
    font-weight: 600;
    line-height: 24px;
    color: var(--po-text);
    margin: 12px 0 8px 0;
  }

  /* Paragraphs */
  .milkdown-editor p {
    margin: 8px 0;
    color: var(--po-text-muted);
  }

  /* Links */
  .milkdown-editor a {
    color: var(--po-accent);
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

  .milkdown-editor .ProseMirror li {
    margin: 4px 0;
    color: var(--po-text-muted);
  }

  .milkdown-editor .ProseMirror ul > li::marker,
  .milkdown-editor .ProseMirror ol > li::marker {
    color: var(--po-text-subtle) !important;
  }

  /* Blockquote */
  .milkdown-editor blockquote {
    margin: 8px 0;
    padding: 8px 16px;
    border-left: 3px solid var(--po-border-strong);
    background: var(--po-control);
    border-radius: 0 6px 6px 0;
    color: var(--po-text-muted);
    line-height: 24px;
  }

  /* Code */
  .milkdown-editor code {
    font-family: var(--po-font-sans);
    font-size: 13px;
    background: var(--po-control);
    padding: 1px 5px;
    border-radius: 3px;
    color: var(--po-success);
  }

  .milkdown-editor pre {
    margin: 8px 0;
    padding: 12px 16px;
    background: var(--po-inset);
    border: 1px solid var(--po-border);
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
    border: 1px solid var(--po-border);
    border-radius: 6px;
    overflow: hidden;
    font-size: 13px;
    line-height: 20px;
  }

  .milkdown-editor th {
    padding: 8px 12px;
    text-align: left;
    font-weight: 600;
    color: var(--po-text);
    background: var(--po-control);
    border-bottom: 1px solid var(--po-border);
    border-right: 1px solid var(--po-border-subtle);
  }

  .milkdown-editor td {
    padding: 6px 12px;
    border-bottom: 1px solid var(--po-border-subtle);
    border-right: 1px solid var(--po-border-subtle);
    color: var(--po-text-muted);
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
    border-top: 1px solid var(--po-border);
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
    border: 2px solid var(--po-text-disabled);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  /* Checked state */
  .milkdown-editor li[data-item-type="task"][data-checked="true"]::before {
    background: var(--po-success);
    border-color: var(--po-success);
  }

  /* Checkmark icon for checked items */
  .milkdown-editor li[data-item-type="task"][data-checked="true"]::after {
    content: '';
    position: absolute;
    left: 6px;
    top: 8px;
    width: 5px;
    height: 9px;
    border: solid var(--po-inset);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  /* Strikethrough text for completed tasks */
  .milkdown-editor li[data-item-type="task"][data-checked="true"] {
    color: var(--po-text-subtle);
  }

  .milkdown-editor li[data-item-type="task"][data-checked="true"] > p {
    text-decoration: line-through;
  }

  /* Unchecked hover state */
  .milkdown-editor li[data-item-type="task"][data-checked="false"]::before,
  .milkdown-editor li[data-item-type="task"]:not([data-checked="true"])::before {
    border-color: var(--po-text-disabled);
  }

  .milkdown-editor li[data-item-type="task"][data-checked="false"]:hover::before,
  .milkdown-editor li[data-item-type="task"]:not([data-checked="true"]):hover::before {
    border-color: var(--po-border-strong);
    background: var(--po-panel-raised);
  }

  /* Ensure task list container doesn't show bullets */
  .milkdown-editor ul:has(> li[data-item-type="task"]) {
    list-style: none !important;
  }

  /* Strong & Em */
  .milkdown-editor strong {
    font-weight: 600;
    color: var(--po-text);
  }

  .milkdown-editor em {
    font-style: italic;
    color: var(--po-text-muted);
  }

  /* Strikethrough */
  .milkdown-editor del {
    text-decoration: line-through;
    color: var(--po-text-subtle);
  }

  /* Selection */
  .milkdown-editor ::selection {
    background: var(--po-selected);
  }

  /* Placeholder - show when editor is empty */
  .milkdown-editor .ProseMirror > p:first-child:last-child:empty::before,
  .milkdown-editor .ProseMirror > p:first-child:last-child:has(br:only-child)::before {
    content: 'Start writing...';
    color: var(--po-text-disabled);
    pointer-events: none;
    position: absolute;
    font-style: italic;
  }

  /* Also handle completely empty editor */
  .milkdown-editor .ProseMirror:empty::before {
    content: 'Start writing...';
    color: var(--po-text-disabled);
    pointer-events: none;
    font-style: italic;
  }

  /* Focus */
  .milkdown-editor:focus-within {
    outline: none;
  }

  /* Ensure clicking anywhere focuses the editor */
  .milkdown-editor .ProseMirror {
    min-height: 100%;
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
  // Snapshot the initial readOnly into a ref. ``useEditor`` runs
  // its callback once and we don't want stale-closure surprises:
  // the live update path below pushes any later changes into the
  // running editor view via ``setProps``.
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const { get } = useEditor((root) => {
    return Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, defaultValue);

        // Tell ProseMirror whether typing should be accepted. The
        // ``editable`` predicate is re-invoked on every input
        // event, so we read from the ref instead of capturing the
        // ``readOnly`` prop value at editor-construction time.
        ctx.update(editorViewOptionsCtx, (prev) => ({
          ...prev,
          editable: () => !readOnlyRef.current,
        }));

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

  // Keep the running editor in sync when ``readOnly`` toggles
  // (e.g. user flips Live view ↔ Read only via the picker). We
  // call ``setProps`` so ProseMirror re-checks editable on the
  // next event, and refresh attributes so the cursor doesn't
  // remain on a now-locked surface.
  useEffect(() => {
    const editor = get();
    if (!editor) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.setProps({ editable: () => !readOnlyRef.current });
      // Force ProseMirror to re-render its decorations so the
      // contenteditable attribute on the dom flips immediately.
      view.updateState(view.state);
    });
  }, [readOnly, get]);

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
          background: 'var(--po-canvas)',
        }}
      >
        <style>{editorThemeStyles}</style>
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
