'use client'

import React, { useState, useEffect } from 'react'
import { ToolsPanel, type AccessPoint, type SaveToolsResult } from './ToolsPanel'
import { DocumentEditor } from './DocumentEditor'
import { type McpToolDefinition } from '../../lib/mcpApi'

// 面板类型
export type RightPanelContent = 'NONE' | 'TOOLS' | 'EDITOR'

// 编辑器目标类型
export interface EditorTarget {
  path: string
  value: string
}

// 重新导出类型
export type { AccessPoint, SaveToolsResult }

interface RightAuxiliaryPanelProps {
  content: RightPanelContent
  onClose: () => void
  
  // Tools 面板相关
  accessPoints: AccessPoint[]
  setAccessPoints: React.Dispatch<React.SetStateAction<AccessPoint[]>>
  activeBaseName?: string
  activeTableName?: string
  onSaveTools: (toolsDefinition: Record<string, McpToolDefinition>) => void  // 保存 Tools
  isSaving: boolean
  saveError: string | null
  savedResult: SaveToolsResult | null
  setSavedResult: React.Dispatch<React.SetStateAction<SaveToolsResult | null>>
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
  activeTableName,
  onSaveTools,
  isSaving,
  saveError,
  savedResult,
  setSavedResult,
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
  const [isResizeHovered, setIsResizeHovered] = useState(false)
  
  // 记录拖拽开始时的状态（用于相对拖拽计算）
  const [dragStart, setDragStart] = useState<{ startX: number; startWidth: number } | null>(null)

  // Handle Resize - 使用相对拖拽逻辑，不依赖面板在页面中的绝对位置
  useEffect(() => {
    if (!isResizing || !dragStart) return

    const handleMouseMove = (e: MouseEvent) => {
      // 向左拖动（X减小）= 宽度增加，向右拖动（X增大）= 宽度减小
      const deltaX = dragStart.startX - e.clientX
      const newWidth = dragStart.startWidth + deltaX
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      setDragStart(null)
      setIsResizeHovered(false)
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
  }, [isResizing, dragStart])

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
      // borderLeft: isVisible ? '1px solid #2a2a2a' : 'none', // 移除边框，由子组件控制
      // background: '#161618', // 移除背景色，由子组件控制
      position: 'relative',
      flexShrink: 0,
      overflow: 'visible', // 允许子组件的阴影溢出
      // 滑动动画 - 和左侧 Sidebar 保持一致
      transition: isResizing ? 'none' : 'width 0.2s ease',
    }}>
      {/* 左边缘 - 仅拖拽手柄 */}
      <div
        onMouseEnter={() => setIsResizeHovered(true)}
        onMouseLeave={() => !isResizing && setIsResizeHovered(false)}
        style={{
          width: 20,
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isResizing || isResizeHovered ? 1 : 0,
          transition: 'opacity 0.15s ease',
        }}
      >
        {/* 拖拽手柄 */}
        <div
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            // 记录拖拽开始时的鼠标位置和当前宽度
            setDragStart({ startX: e.clientX, startWidth: width })
            setIsResizing(true)
          }}
          style={{
            width: 12,
            height: 40,
            borderRadius: 6,
            background: isResizing 
              ? 'rgba(59, 130, 246, 0.4)' 
              : 'rgba(255, 255, 255, 0.08)',
            border: isResizing 
              ? '1px solid rgba(59, 130, 246, 0.5)'
              : '1px solid rgba(255, 255, 255, 0.06)',
            cursor: 'col-resize',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            transition: 'all 0.15s',
          }}
        >
          {/* 纹理线 */}
          {[0, 1, 2].map(i => (
            <div 
              key={i}
              style={{
                width: 4,
                height: 1,
                background: isResizing ? 'rgba(59, 130, 246, 0.8)' : 'rgba(255, 255, 255, 0.3)',
                borderRadius: 1,
              }}
            />
          ))}
        </div>
      </div>

      {/* Content Container - 外层 Padding 制造浮动卡片效果 */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        overflow: 'hidden',
        padding: 12, // 外层 Padding，让卡片悬浮
        // 内容淡入动画
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.15s ease',
      }}>
        {/* 浮动卡片容器 - 所有子组件共享 */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: '#0f0f11',
          borderRadius: 12,
          border: '1px solid #1a1a1c',
          overflow: 'hidden',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}>
        {content === 'TOOLS' && (
          <ToolsPanel
            accessPoints={accessPoints}
            setAccessPoints={setAccessPoints}
            activeBaseName={activeBaseName}
            activeTableName={activeTableName}
            onClose={onClose}
            onSaveTools={onSaveTools}
            isSaving={isSaving}
            saveError={saveError}
            savedResult={savedResult}
            setSavedResult={setSavedResult}
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
    </div>
  )
}

// 导出子组件以便独立使用
export { ToolsPanel } from './ToolsPanel'
export { DocumentEditor } from './DocumentEditor'
