'use client';

import React, { useEffect, useRef } from 'react';
import { JSONEditor, Mode, Content, OnChange } from 'vanilla-jsoneditor';

interface VanillaJsonEditorProps {
  json: object;
  onChange?: (json: object) => void;
  onPathChange?: (path: string | null) => void;
}

export function VanillaJsonEditor({
  json,
  onChange,
  onPathChange,
}: VanillaJsonEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const content: Content = { json };

    const handleChange: OnChange = (
      updatedContent,
      previousContent,
      { contentErrors }
    ) => {
      if (!onChange) return;

      if (
        !contentErrors &&
        'json' in updatedContent &&
        updatedContent.json !== undefined
      ) {
        onChange(updatedContent.json as object);
      }
    };

    editorRef.current = new (JSONEditor as any)({
      target: containerRef.current,
      props: {
        content,
        mode: Mode.tree,
        onChange: handleChange,
        mainMenuBar: true,
        navigationBar: true,
        statusBar: true,
        readOnly: false,
        indentation: 2,
        tabSize: 2,
        escapeControlCharacters: false,
        escapeUnicodeCharacters: false,
        flattenColumns: true,
      },
    });

    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
    };
  }, []);

  // Update content when json prop changes
  useEffect(() => {
    if (editorRef.current) {
      const currentContent = editorRef.current.get();
      if (
        'json' in currentContent &&
        JSON.stringify(currentContent.json) !== JSON.stringify(json)
      ) {
        editorRef.current.set({ json });
      }
    }
  }, [json]);

  return (
    <div
      ref={containerRef}
      style={
        {
          height: '100%',
          width: '100%',
          '--jse-theme-color': 'var(--po-accent)',
          '--jse-theme-color-highlight': 'var(--po-accent)',
          '--jse-background-color': 'var(--po-editor-bg)',
          '--jse-text-color': 'var(--po-text)',
          '--jse-text-color-inverse': 'var(--po-text-inverse)',
          '--jse-error-color': 'var(--po-danger)',
          '--jse-warning-color': 'var(--po-warning)',
          '--jse-key-color': 'var(--po-json-key)',
          '--jse-value-color': 'var(--po-json-string)',
          '--jse-value-color-number': 'var(--po-json-number)',
          '--jse-value-color-boolean': 'var(--po-json-boolean)',
          '--jse-value-color-null': 'var(--po-text-muted)',
          '--jse-value-color-string': 'var(--po-json-string)',
          '--jse-delimiter-color': 'var(--po-text-muted)',
          '--jse-edit-outline': '2px solid var(--po-accent)',
          '--jse-selection-background-color': 'var(--po-selected)',
          '--jse-selection-background-inactive-color': 'var(--po-active)',
          '--jse-hover-background-color': 'var(--po-hover)',
          '--jse-active-line-background-color': 'var(--po-active)',
          '--jse-search-match-color': 'var(--po-warning)',
          '--jse-search-match-background-color': 'color-mix(in srgb, var(--po-warning) 18%, transparent)',
          '--jse-search-match-active-color': 'var(--po-text-inverse)',
          '--jse-search-match-active-background-color': 'var(--po-warning)',
          '--jse-collapsed-items-background-color': 'var(--po-control)',
          '--jse-collapsed-items-link-color': 'var(--po-accent-text)',
          '--jse-collapsed-items-link-color-highlight': 'var(--po-accent)',
          '--jse-context-menu-background': 'var(--po-overlay)',
          '--jse-context-menu-background-highlight': 'var(--po-hover)',
          '--jse-context-menu-separator-color': 'var(--po-border)',
          '--jse-context-menu-color': 'var(--po-text)',
          '--jse-context-menu-button-background': 'var(--po-control)',
          '--jse-context-menu-button-background-highlight': 'var(--po-control-hover)',
          '--jse-context-menu-button-color': 'var(--po-text)',
          '--jse-modal-background': 'var(--po-overlay)',
          '--jse-modal-overlay-background': 'var(--po-backdrop)',
          '--jse-modal-code-background': 'var(--po-editor-bg)',
          '--jse-panel-background': 'var(--po-panel)',
          '--jse-panel-color': 'var(--po-text)',
          '--jse-panel-color-readonly': 'var(--po-text-muted)',
          '--jse-panel-border': 'var(--po-border)',
          '--jse-panel-button-background': 'var(--po-control)',
          '--jse-panel-button-background-highlight': 'var(--po-control-hover)',
          '--jse-panel-button-color': 'var(--po-text)',
          '--jse-scrollbar-track': 'var(--po-inset)',
          '--jse-scrollbar-thumb': 'var(--po-scrollbar-thumb)',
          '--jse-scrollbar-thumb-highlight': 'var(--po-scrollbar-thumb-hover)',
          '--jse-input-background': 'var(--po-editor-bg)',
          '--jse-input-border': 'var(--po-border)',
          '--jse-button-background': 'var(--po-control)',
          '--jse-button-background-highlight': 'var(--po-control-hover)',
          '--jse-button-color': 'var(--po-text)',
          '--jse-a-color': 'var(--po-accent-text)',
          '--jse-a-color-highlight': 'var(--po-accent)',
        } as React.CSSProperties
      }
    />
  );
}

export default VanillaJsonEditor;
