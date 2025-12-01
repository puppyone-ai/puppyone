'use client'

import type { CSSProperties } from 'react'
import { useState, useRef, useEffect } from 'react'
import { McpBar } from './McpBar'

export type EditorType = 'treeline-virtual' | 'monaco'

type ProjectsHeaderProps = {
  pathSegments: string[]
  projectId: string | null
  tableId?: string | null
  currentTreePath: string | null
  onProjectsRefresh?: () => void
  onLog?: (type: 'error' | 'warning' | 'info' | 'success', message: string) => void
  detailPanelOpen?: boolean
  onToggleDetailPanel?: () => void
  editorType?: EditorType
  onEditorTypeChange?: (type: EditorType) => void
  tableInfo?: {
    rows?: number
    fields?: number
    lastSync?: string
  }
}

const editorOptions: { id: EditorType; label: string; icon: string }[] = [
  { id: 'treeline-virtual', label: 'Tree', icon: '├─' },
  { id: 'monaco', label: 'Raw', icon: '{ }' },
]

export function ProjectsHeader({
  pathSegments,
  projectId,
  tableId,
  currentTreePath,
  onProjectsRefresh,
  onLog,
  detailPanelOpen = false,
  onToggleDetailPanel,
  editorType = 'treeline-virtual',
  onEditorTypeChange,
  tableInfo,
}: ProjectsHeaderProps) {
  const [showEditorMenu, setShowEditorMenu] = useState(false)
  const [editorMenuHeight, setEditorMenuHeight] = useState(0)
  const mcpBarRef = useRef<{ closeMenus: () => void } | null>(null)

  const currentEditor = editorOptions.find(e => e.id === editorType) || editorOptions[0]

  // Handle editor menu animation
  useEffect(() => {
    if (showEditorMenu) {
      setTimeout(() => setEditorMenuHeight(120), 0) // Set height for animation
    } else {
      setEditorMenuHeight(0) // Reset height for next animation
    }
  }, [showEditorMenu])

  // Close editor menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      const editorButton = document.getElementById('editor-switch-button')
      const editorMenu = document.getElementById('editor-menu')

      if (editorButton && !editorButton.contains(target) &&
          editorMenu && !editorMenu.contains(target)) {
        setShowEditorMenu(false)
      }
    }

    if (showEditorMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showEditorMenu])

  return (
    <header style={headerStyle}>
      <span style={pathStyle}>{pathSegments.join(' / ')}</span>
      <div style={headerRightStyle}>
        {projectId && <McpBar ref={mcpBarRef} projectId={projectId} tableId={tableId || undefined} currentTreePath={currentTreePath} onProjectsRefresh={onProjectsRefresh} onLog={onLog} onCloseOtherMenus={() => setShowEditorMenu(false)} />}
        
        {/* Editor Type Switcher */}
        <div style={{ position: 'relative' }}>
          <button
            id="editor-switch-button"
            onClick={() => {
              setShowEditorMenu(!showEditorMenu)
              mcpBarRef.current?.closeMenus()
            }}
            style={editorSwitchBtnStyle}
            title="Switch editor"
          >
            <span style={{ fontSize: 12 }}>{currentEditor.icon}</span>
            <span style={{ fontSize: 11, color: '#9B9B9B' }}>{currentEditor.label}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: '#6D7177' }}>
              <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          
          {showEditorMenu && (
            <div
              id="editor-menu"
              style={{
                ...editorMenuStyle,
                opacity: editorMenuHeight > 0 ? 1 : 0,
                transform: `translateY(${editorMenuHeight > 0 ? 0 : -10}px) scaleY(${editorMenuHeight > 0 ? 1 : 0.8})`,
                transformOrigin: 'top',
                maxHeight: editorMenuHeight,
                overflow: 'hidden',
                transition: 'all 0.2s cubic-bezier(0.2, 0, 0.2, 1)',
                boxShadow: '0 8px 25px rgba(0, 0, 0, 0.4), 0 4px 10px rgba(0, 0, 0, 0.2)',
              }}
            >
              {editorOptions.map((option) => {
                const isSelected = option.id === editorType
                return (
                  <button
                    key={option.id}
                    onClick={() => {
                      onEditorTypeChange?.(option.id)
                      setShowEditorMenu(false)
                    }}
                    style={{
                      ...editorMenuItemStyle,
                      background: isSelected ? 'rgba(107,114,128,0.15)' : 'transparent',
                      fontWeight: isSelected ? 500 : 400,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = '#2a2a2a'
                        e.currentTarget.style.borderColor = '#444'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.borderColor = '#333'
                      }
                    }}
                  >
                    <span>{option.icon}</span>
                    <span>{option.label}</span>
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 'auto', color: '#2563eb' }}>
                        <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Toggle Detail Panel Button */}
        <button 
          onClick={onToggleDetailPanel}
          style={toggleBtnStyle}
          title={detailPanelOpen ? 'Hide details' : 'Show details'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M10 2v12" stroke="currentColor" strokeWidth="1.2"/>
            {detailPanelOpen && (
              <>
                <path d="M12 5h1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M12 8h1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </>
            )}
          </svg>
        </button>
      </div>
    </header>
  )
}

const headerStyle: CSSProperties = {
  height: 44,
  padding: '0 20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid rgba(46,46,46,0.7)',
  background: 'rgba(10,10,12,0.78)',
  backdropFilter: 'blur(12px)',
  position: 'relative',
  zIndex: 10,
}

const toggleBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  background: 'transparent',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  color: '#6D7177',
  transition: 'background 0.15s, color 0.15s',
}

const pathStyle: CSSProperties = {
  fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: 13,
  fontWeight: 500,
  color: '#CDCDCD',
}

const headerRightStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
}

const editorSwitchBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 6,
  cursor: 'pointer',
  color: '#CDCDCD',
  fontSize: 12,
  transition: 'background 0.15s, border-color 0.15s',
}

const editorMenuStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 4,
  width: 180, // Match MCP menu width
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 8,
  padding: 10, // Match MCP menu padding
  zIndex: 100,
  display: 'flex',
  flexDirection: 'column',
  gap: 4, // Match MCP menu gap
}

const editorMenuItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 28, // Match MCP menu item height
  padding: '6px 8px', // Match MCP menu padding
  background: 'transparent',
  border: '1px solid #333',
  borderRadius: 4, // Match MCP menu border radius
  cursor: 'pointer',
  color: '#CDCDCD',
  fontSize: 10, // Match MCP menu font size
  textAlign: 'left',
  transition: 'background 0.15s, border-color 0.15s',
  fontWeight: 400,
}


