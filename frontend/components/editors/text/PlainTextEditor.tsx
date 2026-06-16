'use client';

import React from 'react';
import { PROJECT_CONTENT_RAIL_WIDTH } from '@/lib/layout';
import { ConflictMarkerBanner } from '@/components/editors/ConflictMarkerBanner';

const technicalTextExtensions = ['.env', '.log'];

const plainTextStyles = `
  .plain-text-editor {
    width: 100%;
    height: 100%;
    overflow: auto;
    background: var(--po-editor-bg);
    color: var(--po-text-muted);
    font-family: var(--po-font-sans);
  }

  .plain-text-editor__rail {
    box-sizing: border-box;
    width: 100%;
    max-width: ${PROJECT_CONTENT_RAIL_WIDTH}px;
    min-height: 100%;
    margin: 0 auto;
    padding: var(--po-editor-padding-block) var(--po-editor-padding-inline) var(--po-editor-padding-bottom);
  }

  .plain-text-editor__surface {
    box-sizing: border-box;
    width: 100%;
    min-height: 100%;
    margin: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--po-text-muted);
    font-family: var(--po-font-sans);
    font-size: 14px;
    font-weight: var(--po-text-weight-medium);
    line-height: 1.68;
    letter-spacing: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    tab-size: 2;
  }

  .plain-text-editor__surface[data-technical='true'] {
    font-family: var(--po-font-mono);
    font-size: 13px;
    line-height: 20px;
  }

  .plain-text-editor__input {
    display: block;
    height: 100%;
    resize: none;
  }

  .plain-text-editor__input::placeholder {
    color: var(--po-text-disabled);
    font-style: italic;
  }

  .plain-text-editor__surface::selection {
    background: var(--po-selected);
  }

`;

interface PlainTextEditorProps {
  content: string;
  nodeName?: string;
  readOnly?: boolean;
  onChange?: (content: string) => void;
}

export function PlainTextEditor({
  content,
  nodeName = '',
  readOnly = true,
  onChange,
}: Readonly<PlainTextEditorProps>) {
  const lowerName = nodeName.toLowerCase();
  const isTechnicalText = technicalTextExtensions.some((ext) => lowerName.endsWith(ext));

  return (
    <div className="plain-text-editor">
      <style>{plainTextStyles}</style>
      {/* ConflictMarkerBanner detects Git-style merge markers
        * (``<<<<<<< current`` / ``=======`` / ``>>>>>>> incoming``)
        * that the engine embedded under ``last_write_wins`` policy and
        * offers per-block resolution. Plaintext editors handle .env /
        * .log / .yml / generic .txt files that absolutely can carry
        * markers, so the banner sits at the top of the rail in both
        * read-only and editable modes. ``onResolve`` is only wired
        * when ``onChange`` is available — a read-only viewer can still
        * surface the warning. */}
      <ConflictMarkerBanner
        content={content}
        onResolve={readOnly ? undefined : onChange}
      />
      <div className="plain-text-editor__rail">
        {readOnly ? (
          <pre
            className="plain-text-editor__surface"
            data-technical={isTechnicalText}
            aria-label={nodeName ? `Read ${nodeName}` : 'Read text file'}
          >
            {content}
          </pre>
        ) : (
          <textarea
            className="plain-text-editor__surface plain-text-editor__input"
            data-technical={isTechnicalText}
            value={content}
            onChange={(event) => onChange?.(event.target.value)}
            placeholder="Start writing..."
            aria-label={nodeName ? `Edit ${nodeName}` : 'Edit text file'}
          />
        )}
      </div>
    </div>
  );
}

export default PlainTextEditor;
