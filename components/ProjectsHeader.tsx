'use client'

import type { CSSProperties } from 'react'
import { useState, useRef, useEffect } from 'react'
import { ImportMenu } from './ImportMenu'

export type EditorType = 'treeline-virtual' | 'monaco'
export type SidebarContent = 'none' | 'chat' | 'publish'

type ProjectsHeaderProps = {
  pathSegments: string[]
  projectId: string | null
  tableId?: string | null
  currentTreePath: string | null
  onProjectsRefresh?: () => void
  onLog?: (type: 'error' | 'warning' | 'info' | 'success', message: string) => void
  editorType?: EditorType
  onEditorTypeChange?: (type: EditorType) => void
  onTargetPathChange?: (path: string | null) => void
  sidebarContent?: SidebarContent
  onSidebarContentChange?: (content: SidebarContent) => void
}

const editorOptions: { id: EditorType; label: string; icon: string }[] = [
  { id: 'treeline-virtual', label: 'Tree', icon: '☷' },
  { id: 'monaco', label: 'Raw', icon: '{ }' },
]

export function ProjectsHeader({
  pathSegments,
  projectId,
  tableId,
  currentTreePath,
  onProjectsRefresh,
  onLog,
  editorType = 'treeline-virtual',
  onEditorTypeChange,
  onTargetPathChange,
  sidebarContent = 'none',
  onSidebarContentChange,
}: ProjectsHeaderProps) {
  const [showEditorMenu, setShowEditorMenu] = useState(false)
  const [editorMenuHeight, setEditorMenuHeight] = useState(0)
  
  // Refs for closing menus
  const importMenuRef = useRef<{ close: () => void } | null>(null)

  const currentEditor = editorOptions.find(e => e.id === editorType) || editorOptions[0]

  // Handle editor menu animation
  useEffect(() => {
    if (showEditorMenu) {
      setTimeout(() => setEditorMenuHeight(100), 0)
    } else {
      setEditorMenuHeight(0)
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

  const closeAllMenus = () => {
    setShowEditorMenu(false)
  }

  return (
    <header style={headerStyle}>
      {/* LEFT SIDE: Context Definition (Breadcrumbs + View Switcher) */}
      <div style={headerLeftStyle}>
        {/* Breadcrumbs */}
        <span style={pathStyle}>{pathSegments.join(' / ')}</span>
        
        {/* View Switcher - Segmented Control Style */}
        <div style={viewSwitcherContainerStyle}>
          {editorOptions.map((option) => {
            const isSelected = option.id === editorType
            return (
              <button
                key={option.id}
                onClick={() => onEditorTypeChange?.(option.id)}
                style={{
                  ...viewSwitcherBtnStyle,
                  background: isSelected ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: isSelected ? '#e2e8f0' : '#6b7280',
                }}
              >
                <span style={{ fontSize: 11 }}>{option.icon}</span>
                <span style={{ fontSize: 10 }}>{option.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* RIGHT SIDE: Action Flow (Sync -> Publish -> Chat) */}
      <div style={headerRightStyle}>
        {/* Sync Button (Input) */}
        {projectId && (
          <ImportMenu
            projectId={projectId}
            onProjectsRefresh={onProjectsRefresh}
            onLog={onLog}
            onCloseOtherMenus={closeAllMenus}
          />
        )}
        
        {/* Divider */}
        <div style={{ 
          width: 1, 
          height: 20, 
          background: '#333',
          margin: '0 4px',
        }} />
        
        {/* Publish Button - Opens Sidebar */}
        <button
          onClick={() => onSidebarContentChange?.(sidebarContent === 'publish' ? 'none' : 'publish')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            height: 28,
            padding: '0 12px',
            borderRadius: 6,
            border: '1px solid',
            borderColor: sidebarContent === 'publish' ? '#22c55e' : '#404040',
            background: sidebarContent === 'publish' ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
            color: sidebarContent === 'publish' ? '#22c55e' : '#9ca3af',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            if (sidebarContent !== 'publish') {
              e.currentTarget.style.borderColor = '#525252'
              e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
              e.currentTarget.style.color = '#e2e8f0'
            }
          }}
          onMouseLeave={(e) => {
            if (sidebarContent !== 'publish') {
              e.currentTarget.style.borderColor = '#404040'
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#9ca3af'
            }
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
          <span>Publish</span>
        </button>

        {/* Chat Button - Opens Sidebar */}
        <button
          onClick={() => onSidebarContentChange?.(sidebarContent === 'chat' ? 'none' : 'chat')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            height: 28,
            padding: '0 12px',
            borderRadius: 6,
            border: '1px solid',
            borderColor: sidebarContent === 'chat' ? '#d97706' : '#404040',
            background: sidebarContent === 'chat' ? 'rgba(217, 119, 6, 0.1)' : 'transparent',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            if (sidebarContent !== 'chat') {
              e.currentTarget.style.borderColor = '#525252'
              e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
            }
          }}
          onMouseLeave={(e) => {
            if (sidebarContent !== 'chat') {
              e.currentTarget.style.borderColor = '#404040'
              e.currentTarget.style.background = 'transparent'
            }
          }}
          title="Chat with context"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={sidebarContent === 'chat' ? '#d97706' : '#9ca3af'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span style={{ 
            fontSize: 12, 
            fontWeight: 500, 
            color: sidebarContent === 'chat' ? '#d97706' : '#9ca3af',
          }}>
            Chat
          </span>
        </button>
      </div>
    </header>
  )
}

// Styles
const headerStyle: CSSProperties = {
  height: 48,
  padding: '0 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid rgba(46,46,46,0.7)',
  background: 'rgba(10,10,12,0.85)',
  backdropFilter: 'blur(12px)',
  position: 'relative',
  zIndex: 10,
}

const headerLeftStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
}

const headerRightStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const pathStyle: CSSProperties = {
  fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: 13,
  fontWeight: 500,
  color: '#CDCDCD',
}

const viewSwitcherContainerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  background: 'rgba(255,255,255,0.04)',
  borderRadius: 6,
  padding: 2,
  gap: 2,
}

const viewSwitcherBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  borderRadius: 4,
  border: 'none',
  cursor: 'pointer',
  transition: 'all 0.15s',
  fontFamily: 'inherit',
}

