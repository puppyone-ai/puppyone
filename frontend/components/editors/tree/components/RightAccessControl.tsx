'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

// MCP 工具权限类型
export interface McpToolPermissions {
  get_data_schema?: boolean
  get_all_data?: boolean
  query_data?: boolean
  // preview?: boolean
  // select?: boolean
  create?: boolean
  update?: boolean
  delete?: boolean
}

// MCP 工具定义 - 包含图标和标签
const MCP_TOOLS = [
  { 
    id: 'get_data_schema', 
    label: 'Get Schema', 
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M5.2 3.2c-1.2.6-2 1.8-2 3.8s.8 3.2 2 3.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        <path d="M8.8 3.2c1.2.6 2 1.8 2 3.8s-.8 3.2-2 3.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        <path d="M6.2 5.4h1.6M6.2 7h1.6M6.2 8.6h1.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    )
  },
  { 
    id: 'query_data', 
    label: 'Query', 
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    )
  },
  { 
    id: 'get_all_data', 
    label: 'Get All', 
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="2" y="2" width="10" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
        <rect x="2" y="6" width="10" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
        <rect x="2" y="10" width="10" height="2" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
      </svg>
    )
  },
  // { 
  //   id: 'preview', 
  //   label: 'Preview', 
  //   icon: (
  //     <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
  //       <path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
  //       <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
  //     </svg>
  //   )
  // },
  // { 
  //   id: 'select', 
  //   label: 'Select', 
  //   icon: (
  //     <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
  //       <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/>
  //       <path d="M4 7l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  //     </svg>
  //   )
  // },
  { 
    id: 'create', 
    label: 'Create', 
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    )
  },
  { 
    id: 'update', 
    label: 'Update', 
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M10 2l2 2-7 7H3v-2l7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      </svg>
    )
  },
  { 
    id: 'delete', 
    label: 'Delete', 
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 013 11.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    )
  },
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
          width: 26,
          height: 26,
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
        <svg 
          width="15" 
          height="12" 
          viewBox="0 0 33 26" 
          fill="none"
          style={{ 
            color: isConfigured ? '#FFA73D' : (gutterHovered || showPopover) ? '#e2e8f0' : '#6b7280',
            transition: 'color 0.12s',
          }}
        >
          <ellipse cx="27.9463" cy="11.0849" rx="3.45608" ry="4.0321" transform="rotate(14 27.9463 11.0849)" fill="currentColor"/>
          <ellipse cx="11.5129" cy="4.75922" rx="3.45608" ry="4.3201" transform="rotate(-8 11.5129 4.75922)" fill="currentColor"/>
          <ellipse cx="20.7294" cy="4.7593" rx="3.45608" ry="4.3201" transform="rotate(8 20.7294 4.7593)" fill="currentColor"/>
          <ellipse cx="4.32887" cy="11.0848" rx="3.45608" ry="4.0321" transform="rotate(-14 4.32887 11.0848)" fill="currentColor"/>
          <path d="M15.4431 11.5849C15.9709 11.499 16.0109 11.4991 16.5387 11.585C17.4828 11.7388 17.9619 12.099 18.7308 12.656C20.3528 13.8309 20.0223 15.0304 21.4709 16.4048C22.2387 17.1332 23.2473 17.7479 23.9376 18.547C24.7716 19.5125 25.1949 20.2337 25.3076 21.4924C25.4028 22.5548 25.3449 23.2701 24.7596 24.1701C24.1857 25.0527 23.5885 25.4635 22.5675 25.7768C21.6486 26.0587 21.0619 25.8454 20.1014 25.7768C18.4688 25.66 17.6279 24.9515 15.9912 24.9734C14.4592 24.994 13.682 25.655 12.155 25.7768C11.1951 25.8533 10.6077 26.0587 9.68884 25.7768C8.66788 25.4635 8.07066 25.0527 7.49673 24.1701C6.91143 23.2701 6.85388 22.5546 6.94907 21.4922C7.06185 20.2335 7.57596 19.5812 8.31877 18.547C9.01428 17.5786 9.71266 17.2943 10.5109 16.4048C11.7247 15.0521 11.7621 13.7142 13.251 12.656C14.0251 12.1059 14.499 11.7387 15.4431 11.5849Z" fill="currentColor"/>
        </svg>
        
        {/* 数字角标 */}
        {isConfigured && (
          <span style={{
            position: 'absolute',
            top: '50%',
            right: -10,
            transform: 'translateY(-50%)',
            fontSize: 11,
            fontWeight: 600,
            color: '#FFA73D',
            pointerEvents: 'none',
            fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          }}>{Object.values(configuredAccess || {}).filter(Boolean).length}</span>
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
                  color: isEnabled ? '#FFA73D' : 'inherit',
                }}>{tool.icon}</span>
                <span style={{ flex: 1 }}>{tool.label}</span>
                <span style={{ 
                  width: 16, 
                  height: 16,
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  borderRadius: 3,
                  background: isEnabled ? 'rgba(255, 167, 61, 0.2)' : 'rgba(255,255,255,0.05)',
                  border: isEnabled ? '1px solid rgba(255, 167, 61, 0.4)' : '1px solid rgba(255,255,255,0.1)',
                }}>
                  {isEnabled && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2.5 2.5L8 3" stroke="#FFA73D" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
