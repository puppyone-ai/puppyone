'use client'

import type { CSSProperties } from 'react'
import { useState, useEffect } from 'react'
import { ImportMenu } from './ImportMenu'

export type EditorType = 'treeline-virtual' | 'monaco'

type ProjectsHeaderProps = {
  pathSegments: string[]
  projectId: string | null
  onProjectsRefresh?: () => void
  editorType?: EditorType
  onEditorTypeChange?: (type: EditorType) => void
  // Publish (Context Level)
  isPublishOpen?: boolean
  onPublishOpenChange?: (open: boolean) => void
  // Chat (Global Level)
  isChatOpen?: boolean
  onChatOpenChange?: (open: boolean) => void
}

const editorOptions: { id: EditorType; label: string; icon: string }[] = [
  { id: 'treeline-virtual', label: 'Tree', icon: '☷' },
  { id: 'monaco', label: 'Raw', icon: '{ }' },
]

export function ProjectsHeader({ 
  pathSegments, 
  projectId, 
  onProjectsRefresh, 
  editorType = 'treeline-virtual',
  onEditorTypeChange,
  isPublishOpen = false,
  onPublishOpenChange,
  isChatOpen = false,
  onChatOpenChange,
}: ProjectsHeaderProps) {
  const [showEditorMenu, setShowEditorMenu] = useState(false)

  const currentEditor = editorOptions.find(e => e.id === editorType) || editorOptions[0]

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
        
      {/* RIGHT SIDE: Context Actions (Sync + Publish) + Chat Toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginLeft: 'auto',
      }}>
        {/* Sync Button */}
        {projectId && (
          <ImportMenu
            projectId={projectId}
            onProjectsRefresh={onProjectsRefresh}
          />
        )}
        
        {/* View Toggle: Human ↔ Agent */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          height: 28,
          borderRadius: 6,
          border: '1px solid #333',
          background: 'rgba(0,0,0,0.3)',
          padding: 2,
          gap: 2,
        }}>
          <button 
            onClick={() => isPublishOpen && onPublishOpenChange?.(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              height: 22,
              padding: '0 10px',
              borderRadius: 4,
              border: 'none',
              background: !isPublishOpen ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: !isPublishOpen ? '#e2e8f0' : '#6b7280',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            You
          </button>
          <button 
            onClick={() => !isPublishOpen && onPublishOpenChange?.(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              height: 22,
              padding: '0 10px',
              borderRadius: 4,
              border: 'none',
              background: isPublishOpen ? 'rgba(52, 211, 153, 0.15)' : 'transparent',
              color: isPublishOpen ? '#34d399' : '#6b7280',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.9 2-2 2h-4c-1.1 0-2-.9-2-2a4 4 0 0 1 4-4z"/>
              <path d="M12 8v8"/>
              <path d="M8 12h8"/>
              <circle cx="12" cy="20" r="2"/>
            </svg>
            Agent
          </button>
        </div>
        
        {/* Vertical Divider + Chat Toggle - Hidden when chat is open */}
        {!isChatOpen ? (
          <>
            <div style={{
              width: 1,
              height: 45,
              background: '#262626',
              marginLeft: 4,
            }} />
            
            {/* Chat Toggle Block - 28x28 to match left sidebar toggle */}
            <div
              onClick={() => onChatOpenChange?.(true)}
              style={{
                width: 28,
                height: 28,
                background: 'transparent',
                borderRadius: 5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s',
                marginRight: 8,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
              title="Open Chat"
            >
              {/* Sidebar toggle icon - Rectangle like OpenAI, 14px to match left sidebar */}
              <svg 
                width="14" 
                height="14" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="#6b7280"
                strokeWidth="1.5" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <line x1="15" y1="3" x2="15" y2="21"/>
              </svg>
            </div>
          </>
        ) : (
          /* Right padding when chat is open */
          <div style={{ width: 8 }} />
        )}
      </div>
    </header>
  )
}

// Styles
const headerStyle: CSSProperties = {
  height: 45,
  paddingLeft: 16,
  paddingRight: 0, // No right padding, Chat toggle goes to edge
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

