'use client'

import React, { useEffect, useRef } from 'react'
import { JSONEditor, Mode, Content, OnChange } from 'vanilla-jsoneditor'

interface VanillaJsonEditorProps {
  json: object
  onChange?: (json: object) => void
  onPathChange?: (path: string | null) => void
}

export function VanillaJsonEditor({ json, onChange, onPathChange }: VanillaJsonEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<any>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const content: Content = { json }

    const handleChange: OnChange = (updatedContent, previousContent, { contentErrors }) => {
      if (!onChange) return
      
      if (!contentErrors && 'json' in updatedContent && updatedContent.json !== undefined) {
        onChange(updatedContent.json as object)
      }
    }

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
      }
    })

    return () => {
      if (editorRef.current) {
        editorRef.current.destroy()
        editorRef.current = null
      }
    }
  }, [])

  // Update content when json prop changes
  useEffect(() => {
    if (editorRef.current) {
      const currentContent = editorRef.current.get()
      if ('json' in currentContent && JSON.stringify(currentContent.json) !== JSON.stringify(json)) {
        editorRef.current.set({ json })
      }
    }
  }, [json])

  return (
    <div 
      ref={containerRef} 
      style={{ 
        height: '100%', 
        width: '100%',
        '--jse-theme-color': '#3b82f6',
        '--jse-theme-color-highlight': '#60a5fa',
        '--jse-background-color': '#0d1117',
        '--jse-text-color': '#c9d1d9',
        '--jse-text-color-inverse': '#0d1117',
        '--jse-error-color': '#f85149',
        '--jse-warning-color': '#d29922',
        '--jse-key-color': '#7ee787',
        '--jse-value-color': '#a5d6ff',
        '--jse-value-color-number': '#79c0ff',
        '--jse-value-color-boolean': '#ff7b72',
        '--jse-value-color-null': '#8b949e',
        '--jse-value-color-string': '#a5d6ff',
        '--jse-delimiter-color': '#8b949e',
        '--jse-edit-outline': '2px solid #3b82f6',
        '--jse-selection-background-color': '#264f78',
        '--jse-selection-background-inactive-color': '#3a3a3a',
        '--jse-hover-background-color': '#1f2937',
        '--jse-active-line-background-color': '#1c1c1c',
        '--jse-search-match-color': '#e2c08d',
        '--jse-search-match-background-color': '#613315',
        '--jse-search-match-active-color': '#0d1117',
        '--jse-search-match-active-background-color': '#e2c08d',
        '--jse-collapsed-items-background-color': '#21262d',
        '--jse-collapsed-items-link-color': '#58a6ff',
        '--jse-collapsed-items-link-color-highlight': '#79c0ff',
        '--jse-context-menu-background': '#161b22',
        '--jse-context-menu-background-highlight': '#21262d',
        '--jse-context-menu-separator-color': '#30363d',
        '--jse-context-menu-color': '#c9d1d9',
        '--jse-context-menu-button-background': '#21262d',
        '--jse-context-menu-button-background-highlight': '#30363d',
        '--jse-context-menu-button-color': '#c9d1d9',
        '--jse-modal-background': '#161b22',
        '--jse-modal-overlay-background': 'rgba(1, 4, 9, 0.8)',
        '--jse-modal-code-background': '#0d1117',
        '--jse-panel-background': '#161b22',
        '--jse-panel-color': '#c9d1d9',
        '--jse-panel-color-readonly': '#8b949e',
        '--jse-panel-border': '#30363d',
        '--jse-panel-button-background': '#21262d',
        '--jse-panel-button-background-highlight': '#30363d',
        '--jse-panel-button-color': '#c9d1d9',
        '--jse-scrollbar-track': '#161b22',
        '--jse-scrollbar-thumb': '#484f58',
        '--jse-scrollbar-thumb-highlight': '#6e7681',
        '--jse-input-background': '#0d1117',
        '--jse-input-border': '#30363d',
        '--jse-button-background': '#21262d',
        '--jse-button-background-highlight': '#30363d',
        '--jse-button-color': '#c9d1d9',
        '--jse-a-color': '#58a6ff',
        '--jse-a-color-highlight': '#79c0ff',
      } as React.CSSProperties}
    />
  )
}

export default VanillaJsonEditor

