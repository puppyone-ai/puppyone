'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { type McpToolPermissions } from '../../../../lib/mcpApi'
import { TOOL_ICONS, DEFAULT_TOOL_ICON } from '../../../../lib/toolIcons'
import { TOOL_TYPE_CONFIG } from '../../../../lib/toolConfig'

// 重新导出类型供其他组件使用
export type { McpToolPermissions }

// MCP 工具列表定义
const MCP_TOOLS = [
  { id: 'get_data_schema', label: 'Get Schema' },
  { id: 'query_data', label: 'Query' },
  { id: 'get_all_data', label: 'Get All' },
  { id: 'create', label: 'Create' },
  { id: 'update', label: 'Update' },
  { id: 'delete', label: 'Delete' },
]

interface RightAccessControlProps {
  path: string
  configuredAccess: McpToolPermissions | null
  // 外部传入的状态：行是否 hover，或者是否被其他行锁定
  isActive: boolean
  // 回调
  onAccessChange?: (path: string, permissions: McpToolPermissions) => void
  onRemove?: (path: string) => void
  onPopoverOpenChange?: (open: boolean) => void
}

export function RightAccessControl({
  path,
  configuredAccess,
  isActive,
  onAccessChange,
  onRemove,
  onPopoverOpenChange,
}: RightAccessControlProps) {
  const [showPopover, setShowPopover] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null)
  const [gutterHovered, setGutterHovered] = useState(false)
  const buttonRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const isConfigured = !!configuredAccess && Object.values(configuredAccess).some(Boolean)
  
  // 同步 popover 状态给父组件 (用于锁定其他行的 hover)
  // 使用 useRef 避免死循环
  const onPopoverOpenChangeRef = useRef(onPopoverOpenChange)
  useEffect(() => {
    onPopoverOpenChangeRef.current = onPopoverOpenChange
  }, [onPopoverOpenChange])

  // 记录上一次的状态
  const prevShowPopover = useRef(showPopover)

  useEffect(() => {
    if (prevShowPopover.current !== showPopover) {
      onPopoverOpenChangeRef.current?.(showPopover)
      prevShowPopover.current = showPopover
    }
  }, [showPopover])

  // Popover 位置计算 + 滚动监听
  useEffect(() => {
    if (!showPopover || !buttonRef.current) {
      setPopoverPosition(null)
      return
    }
    
    const updatePosition = () => {
      if (!buttonRef.current) return
      const rect = buttonRef.current.getBoundingClientRect()
      setPopoverPosition({
        top: rect.top,
        left: rect.left,
      })
    }
    
    updatePosition()
    
    const handleScroll = () => requestAnimationFrame(updatePosition)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [showPopover])

  // 点击外部关闭 Popover
  useEffect(() => {
    if (!showPopover) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const isInButton = buttonRef.current?.contains(target)
      const isInPopover = popoverRef.current?.contains(target)
      if (!isInButton && !isInPopover) {
        setShowPopover(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showPopover])

  const handleToggle = useCallback((toolId: string, enabled: boolean) => {
    const currentTools = configuredAccess || {}
    const newPermissions = {
      ...currentTools,
      [toolId]: enabled,
    }
    onAccessChange?.(path, newPermissions as McpToolPermissions)
  }, [configuredAccess, onAccessChange, path])

  // 渲染小狗爪子图标 + Popover
  return (
    <>
      {/* 触发按钮 */}
      <div
        ref={buttonRef}
        style={{
          marginLeft: 8,
          marginRight: 0,
          width: isConfigured && Object.values(configuredAccess || {}).filter(Boolean).length > 1 ? 'auto' : 26,
          minWidth: 26,
          height: 26,
          padding: isConfigured && Object.values(configuredAccess || {}).filter(Boolean).length > 1 ? '0 6px' : 0,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
          cursor: 'pointer',
          transition: 'all 0.12s',
          position: 'relative',
          // 只有在 已配置 OR 行激活 OR Popover打开 时才显示
          opacity: isConfigured || isActive || showPopover ? 1 : 0,
          background: (gutterHovered || showPopover) 
            ? 'rgba(255, 255, 255, 0.2)' 
            : 'rgba(255, 255, 255, 0.1)',
        }}
        onMouseEnter={(e) => {
          // e.stopPropagation() // 移除此行，允许冒泡以触发 VirtualRow 的 onMouseEnter/Leave
          setGutterHovered(true)
        }}
        onMouseLeave={(e) => {
          // e.stopPropagation() // 移除此行，确保 VirtualRow 能收到 onMouseLeave 并清除 hovered 状态
          setGutterHovered(false)
        }}
        onClick={(e) => {
          e.stopPropagation()
          setShowPopover(!showPopover)
        }}
        title="Configure MCP Tool Permissions"
      >
        {isConfigured ? (
          // 已配置：显示图标组
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', width: '100%' }}>
            {MCP_TOOLS.filter(t => (configuredAccess as any)?.[t.id]).map(tool => {
              // const config = TOOL_TYPE_CONFIG[tool.id] // 不再使用彩色配置
              return (
                <div 
                  key={tool.id} 
                  style={{ 
                    color: '#fb923c', // 使用橙色 (Orange-400)
                    display: 'flex', 
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 14, 
                    height: 14,
                    transition: 'color 0.15s',
                  }}
                  title={tool.label}
                  // Hover 时稍微变亮
                  onMouseEnter={(e) => e.currentTarget.style.color = '#fdba74'} // Orange-300
                  onMouseLeave={(e) => e.currentTarget.style.color = '#fb923c'}
                >
                  {TOOL_ICONS[tool.id]}
                </div>
              )
            })}
          </div>
        ) : (
          // 未配置：显示默认图标
          <div style={{ 
            color: (gutterHovered || showPopover) ? '#e2e8f0' : '#6b7280',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {DEFAULT_TOOL_ICON}
          </div>
        )}
      </div>

      {/* Popover 内容 */}
      {showPopover && popoverPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: 'fixed',
            top: popoverPosition.top + 26 + 4, // 按钮高度(26) + 间隙(4) -> 出现在正下方
            left: popoverPosition.left + 26, // 按钮宽度(26) -> 这是一个基准点
            transform: 'translateX(-100%)', // 向左延伸，实现右边缘对齐
            minWidth: 160,
            background: '#1a1a1e',
            border: '1px solid #333',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 10000,
            fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{ padding: '8px 12px 4px' }}>
            <div style={{ 
              fontSize: 10, 
              color: '#6b7280', 
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: 2,
            }}>Agent is allowed to</div>
          </div>
          
          {/* 工具列表 */}
          {MCP_TOOLS.map(tool => {
            const isEnabled = (configuredAccess as any)?.[tool.id] || false
            return (
              <button
                key={tool.id}
                onClick={(e) => {
                  e.stopPropagation()
                  handleToggle(tool.id, !isEnabled)
                }}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 8,
                  width: '100%',
                  height: 28,
                  padding: '0 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: isEnabled ? '#e2e8f0' : '#9ca3af',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  transition: 'all 0.1s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ 
                  width: 16, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  opacity: isEnabled ? 1 : 0.6,
                  color: isEnabled ? TOOL_TYPE_CONFIG[tool.id]?.color : 'inherit',
                }}>{TOOL_ICONS[tool.id]}</span>
                <span style={{ flex: 1 }}>{tool.label}</span>
                <span style={{ 
                  width: 16, 
                  height: 16,
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  borderRadius: 3,
                  background: isEnabled ? TOOL_TYPE_CONFIG[tool.id]?.bg : 'rgba(255,255,255,0.05)',
                  border: isEnabled ? `1px solid ${TOOL_TYPE_CONFIG[tool.id]?.color}40` : '1px solid rgba(255,255,255,0.1)',
                }}>
                  {isEnabled && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2.5 2.5L8 3" stroke={TOOL_TYPE_CONFIG[tool.id]?.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </span>
              </button>
            )
          })}

          {/* Delete 按钮 */}
          {isConfigured && (
            <>
              <div style={{ height: 1, background: '#333', margin: '4px 0' }} />
              <button
                onClick={() => {
                  onRemove?.(path)
                  setShowPopover(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  height: 28,
                  padding: '0 12px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  color: '#f87171',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(248,113,113,0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 013 11.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    <path d="M5.5 7v4M8.5 7v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </span>
                Delete
              </button>
            </>
          )}
          
          <div style={{ height: 1, background: '#333', margin: '4px 0' }} />
          
          {/* Path */}
          <div style={{ padding: '4px 12px 8px' }}>
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>Path</div>
            <code style={{ 
              fontSize: 11, 
              color: '#94a3b8',
              wordBreak: 'break-all',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            }}>{path || '/'}</code>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
