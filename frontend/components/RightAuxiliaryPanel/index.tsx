'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { ToolsPanel } from './ToolsPanel'
import { DocumentEditor } from './DocumentEditor'
import { type McpToolPermissions } from '../../lib/mcpApi'

// 面板类型
export type RightPanelContent = 'NONE' | 'TOOLS' | 'EDITOR'

// Access Point 类型定义
interface AccessPoint {
  id: string
  path: string
  permissions: McpToolPermissions
}

// 编辑器目标类型
export interface EditorTarget {
  path: string
  value: string
}

interface RightAuxiliaryPanelProps {
  content: RightPanelContent
  onClose: () => void
  
  // Tools 面板相关
  accessPoints: AccessPoint[]
  setAccessPoints: React.Dispatch<React.SetStateAction<AccessPoint[]>>
  activeBaseName?: string
  onPublishMcp: () => void
  isPublishing: boolean
  publishError: string | null
  publishedResult: { api_key: string; url: string } | null
  setPublishedResult: React.Dispatch<React.SetStateAction<{ api_key: string; url: string } | null>>
  onViewAllMcp?: () => void
  
  // 文档编辑器相关
  editorTarget: EditorTarget | null
  onEditorSave: (path: string, newValue: string) => void
  
  // 全屏状态
  isEditorFullScreen?: boolean
  onToggleEditorFullScreen?: () => void
}

const MIN_WIDTH = 300
const MAX_WIDTH = 800
const DEFAULT_WIDTH = 450

export function RightAuxiliaryPanel({
  content,
  onClose,
  // Tools props
  accessPoints,
  setAccessPoints,
  activeBaseName,
  onPublishMcp,
  isPublishing,
  publishError,
  publishedResult,
  setPublishedResult,
  onViewAllMcp,
  // Editor props
  editorTarget,
  onEditorSave,
  // Fullscreen props
  isEditorFullScreen = false,
  onToggleEditorFullScreen,
}: RightAuxiliaryPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)

  // Handle Resize
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      // 计算新宽度：屏幕宽度 - 鼠标X坐标
      // 因为面板在右侧，鼠标往左移（X减小）宽度应该增加
      const newWidth = document.body.clientWidth - e.clientX
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = 'default'
      document.body.style.userSelect = 'auto'
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    
    // 防止拖拽时选中文字
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'default'
      document.body.style.userSelect = 'auto'
    }
  }, [isResizing])

  // 全屏模式：占据全部空间
  if (isEditorFullScreen && content === 'EDITOR') {
    return (
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#161618',
        overflow: 'hidden',
        // 全屏时的淡入动画
        animation: 'fadeIn 0.2s ease',
      }}>
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>
        {editorTarget && (
          <DocumentEditor
            path={editorTarget.path}
            value={editorTarget.value}
            onSave={(newValue) => onEditorSave(editorTarget.path, newValue)}
            onClose={onClose}
            isFullScreen={isEditorFullScreen}
            onToggleFullScreen={onToggleEditorFullScreen}
          />
        )}
      </div>
    )
  }

  // 面板是否应该显示
  const isVisible = content !== 'NONE'

  return (
    <div style={{
      width: isVisible ? width : 0,
      display: 'flex',
      flexDirection: 'row',
      height: '100%',
      borderLeft: isVisible ? '1px solid #2a2a2a' : 'none',
      background: '#161618',
      position: 'relative',
      flexShrink: 0,
      overflow: 'hidden',
      // 滑动动画 - 和左侧 Sidebar 保持一致
      transition: isResizing ? 'none' : 'width 0.2s ease, border 0.2s ease',
    }}>
      {/* Resize Handle */}
      <div
        onMouseDown={(e) => {
          e.preventDefault()
          setIsResizing(true)
        }}
        style={{
          width: 4,
          cursor: 'col-resize',
          position: 'absolute',
          left: -2, // 跨越边框
          top: 0,
          bottom: 0,
          zIndex: 10,
          background: isResizing ? 'rgba(59, 130, 246, 0.5)' : 'transparent',
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.5)'}
        onMouseLeave={(e) => !isResizing && (e.currentTarget.style.background = 'transparent')}
      />

      {/* Content Container */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        overflow: 'hidden',
        // 内容淡入动画
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.15s ease',
      }}>
        {content === 'TOOLS' && (
          <ToolsPanel
            accessPoints={accessPoints}
            setAccessPoints={setAccessPoints}
            activeBaseName={activeBaseName}
            onClose={onClose}
            onPublishMcp={onPublishMcp}
            isPublishing={isPublishing}
            publishError={publishError}
            publishedResult={publishedResult}
            setPublishedResult={setPublishedResult}
            onViewAllMcp={onViewAllMcp}
          />
        )}
        
        {content === 'EDITOR' && editorTarget && (
          <DocumentEditor
            path={editorTarget.path}
            value={editorTarget.value}
            onSave={(newValue) => onEditorSave(editorTarget.path, newValue)}
            onClose={onClose}
            isFullScreen={isEditorFullScreen}
            onToggleFullScreen={onToggleEditorFullScreen}
          />
        )}
      </div>
    </div>
  )
}

// 导出子组件以便独立使用
export { ToolsPanel } from './ToolsPanel'
export { DocumentEditor } from './DocumentEditor'
