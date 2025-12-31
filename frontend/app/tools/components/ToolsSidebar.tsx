'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type ViewMode = { type: 'library' } | { type: 'server'; apiKey: string }

const MIN_WIDTH = 180
const MAX_WIDTH = 320
const DEFAULT_WIDTH = 220
const COLLAPSED_WIDTH = 45

export function ToolsSidebar({ 
  currentView, 
  onChangeView, 
  toolsCount, 
  mcpInstances, 
  loading = false,
  onShowCreateFlow,
}: any) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isCollapsed) return
    e.preventDefault()
    setIsResizing(true)
  }, [isCollapsed])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarRef.current) return
      const rect = sidebarRef.current.getBoundingClientRect()
      const newWidth = e.clientX - rect.left
      const clampedWidth = Math.min(Math.max(newWidth, MIN_WIDTH), MAX_WIDTH)
      setSidebarWidth(clampedWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  return (
    <div 
      ref={sidebarRef}
      style={{
        width: isCollapsed ? COLLAPSED_WIDTH : sidebarWidth,
        borderRight: '1px solid #404040',
        display: 'flex',
        flexDirection: 'column',
        background: '#181818',
        fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        boxSizing: 'border-box',
        position: 'relative',
        flexShrink: 0,
        transition: isResizing ? 'none' : 'width 0.2s ease',
      }}
    >
      {/* Header */}
      <div style={{
        height: 46,
        minHeight: 46,
        maxHeight: 46,
        display: 'flex',
        alignItems: 'center',
        justifyContent: isCollapsed ? 'center' : 'space-between',
        padding: isCollapsed ? '0' : '0 9px 0 16px',
        borderBottom: '1px solid #404040',
        boxSizing: 'border-box',
      }}>
        {isCollapsed ? (
          // Collapsed: show expand button
          <button
            onClick={() => setIsCollapsed(false)}
            title="Expand sidebar"
            style={{
              width: 28,
              height: 28,
              background: 'transparent',
              border: 'none',
              borderRadius: 5,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6b7280',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
              e.currentTarget.style.color = '#9ca3af'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#6b7280'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </button>
        ) : (
          // Expanded: show title and collapse button
          <>
            <span style={{ 
              fontSize: 14, 
              fontWeight: 600, 
              color: '#EDEDED', 
              letterSpacing: '0.3px' 
            }}>
              Tools & MCP
            </span>
            <button
              onClick={() => setIsCollapsed(true)}
              title="Collapse sidebar"
              style={{
                width: 28,
                height: 28,
                background: 'transparent',
                border: 'none',
                borderRadius: 5,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6b7280',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                e.currentTarget.style.color = '#9ca3af'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = '#6b7280'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <line x1="9" y1="3" x2="9" y2="21"/>
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Content - hidden when collapsed */}
      {!isCollapsed && (
        <div style={{ flex: 1, overflowY: 'auto', paddingTop: 12 }}>
          
          {loading ? (
            /* Skeleton Loading */
            <>
              <style>{`
                @keyframes shimmer {
                  0% { transform: translateX(-100%); }
                  100% { transform: translateX(100%); }
                }
              `}</style>
              <div style={{ padding: '0 12px', marginBottom: 4 }}>
                <div style={{ height: 28, display: 'flex', alignItems: 'center' }}>
                  <div style={{ width: 50, height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 4 }} />
                </div>
                <div style={{ padding: '2px 0 4px 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <SkeletonItem width="70%" />
                </div>
              </div>
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #333', padding: '8px 12px 0 12px' }}>
                <div style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ width: 90, height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 4 }} />
                </div>
                <div style={{ padding: '2px 0 4px 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <SkeletonItem width="60%" />
                  <SkeletonItem width="75%" />
                  <SkeletonItem width="50%" />
                </div>
              </div>
            </>
          ) : (
            <>
          {/* Library Section */}
          <div style={{ marginBottom: 4 }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              padding: '0 12px',
              height: 28,
            }}>
              <span style={{ 
                fontSize: 12, 
                fontWeight: 600, 
                color: '#6D7177',
              }}>
                Library
              </span>
            </div>
            <div style={{ padding: '2px 8px 4px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
              <NavItem 
                active={currentView.type === 'library'}
                onClick={() => onChangeView({ type: 'library' })}
                label="Tools List"
                count={toolsCount}
              />
            </div>
          </div>
          
          {/* Servers Section */}
          <div style={{ 
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px solid #333',
          }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              padding: '0 12px',
              height: 28,
            }}>
              <span style={{ 
                fontSize: 12, 
                fontWeight: 600, 
                color: '#6D7177',
              }}>
                Deployed Servers
              </span>
              <button
                onClick={onShowCreateFlow}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 26,
                  height: 26,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: '#5D6065',
                  transition: 'all 0.15s',
                }}
                title="New Server"
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                  e.currentTarget.style.color = '#EDEDED'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = '#5D6065'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 10 10" fill="none">
                  <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            
            <div style={{ padding: '2px 8px 4px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
              {mcpInstances.map((mcp: any) => (
                <NavItem 
                  key={mcp.api_key}
                  active={currentView.type === 'server' && currentView.apiKey === mcp.api_key}
                  onClick={() => onChangeView({ type: 'server', apiKey: mcp.api_key })}
                  label={mcp.name || 'Unnamed'}
                  status={mcp.status}
                  isServer
                />
              ))}
              {mcpInstances.length === 0 && (
                <button 
                  onClick={onShowCreateFlow}
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 28,
                    padding: '0 4px 0 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 5,
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#2C2C2C'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 16,
                    height: 16,
                    color: '#6D7177',
                  }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </span>
                  <span style={{ fontSize: 13, color: '#6D7177' }}>New Server</span>
                </button>
              )}
            </div>
          </div>
            </>
          )}
        </div>
      )}

      {/* Collapsed Navigation */}
      {isCollapsed && (
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center',
          padding: '12px 0',
          gap: 4,
        }}>
          {/* Tools List */}
          <button
            onClick={() => onChangeView({ type: 'library' })}
            title="Tools List"
            style={{
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: currentView.type === 'library' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
              border: 'none',
              borderRadius: 5,
              cursor: 'pointer',
              color: currentView.type === 'library' ? '#60a5fa' : '#808080',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              if (currentView.type !== 'library') {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                e.currentTarget.style.color = '#e2e8f0'
              }
            }}
            onMouseLeave={e => {
              if (currentView.type !== 'library') {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = '#808080'
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M8.5 3.5a1 1 0 0 0 0 1l1 1a1 1 0 0 0 1 0l2.5-2.5a4 4 0 0 1-5.3 5.3L4 12a1.4 1.4 0 0 1-2-2l3.7-3.7a4 4 0 0 1 5.3-5.3L8.5 3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Servers */}
          {mcpInstances.map((mcp: any) => {
            const isActive = currentView.type === 'server' && currentView.apiKey === mcp.api_key
            return (
              <button
                key={mcp.api_key}
                onClick={() => onChangeView({ type: 'server', apiKey: mcp.api_key })}
                title={mcp.name || 'Unnamed Server'}
                style={{
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isActive ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                  border: 'none',
                  borderRadius: 5,
                  cursor: 'pointer',
                  color: isActive ? '#60a5fa' : '#808080',
                  transition: 'all 0.15s',
                  position: 'relative',
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                    e.currentTarget.style.color = '#e2e8f0'
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = '#808080'
                  }
                }}
              >
                {/* MCP Server Icon - 六边形 */}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path 
                    d="M7 1L12.2 4v6L7 13L1.8 10V4L7 1z" 
                    stroke="currentColor"
                    strokeWidth="1.2" 
                    strokeLinejoin="round"
                    fill="none"
                  />
                  <circle cx="7" cy="7" r="1.5" fill="currentColor"/>
                  <path 
                    d="M7 5.5V3.5M5.7 8L4 9.5M8.3 8L10 9.5" 
                    stroke="currentColor"
                    strokeWidth="1.2" 
                    strokeLinecap="round"
                  />
                </svg>
                {/* Status dot */}
                {mcp.status !== undefined && (
                  <div style={{
                    position: 'absolute',
                    bottom: 3,
                    right: 3,
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: mcp.status ? '#22c55e' : '#525252',
                    border: '1.5px solid #181818',
                  }} />
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Resize Handle - only when expanded */}
      {!isCollapsed && (
        <div
          onMouseDown={handleMouseDown}
          style={{
            position: 'absolute',
            top: 0,
            right: -2,
            width: 4,
            height: '100%',
            cursor: 'col-resize',
            zIndex: 10,
            background: isResizing ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => {
            if (!isResizing) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
          }}
          onMouseLeave={e => {
            if (!isResizing) e.currentTarget.style.background = 'transparent'
          }}
        />
      )}
    </div>
  )
}

function NavItem({ active, onClick, label, count, status, isServer }: any) {
  const [hovered, setHovered] = useState(false)
  
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 28,
        display: 'flex', 
        alignItems: 'center', 
        gap: 8,
        padding: '0 4px 0 12px',
        borderRadius: 6, 
        cursor: 'pointer', 
        background: active || hovered ? '#2C2C2C' : 'transparent',
        border: 'none',
        width: '100%',
        textAlign: 'left',
        transition: 'background 0.15s',
        boxSizing: 'border-box',
      }}
    >
      {/* Icon */}
      <span style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        flexShrink: 0,
        position: 'relative',
      }}>
        {isServer ? (
          // MCP Server Icon - 六边形代表协议/模块化
          <>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              {/* 六边形外框 */}
              <path 
                d="M7 1L12.2 4v6L7 13L1.8 10V4L7 1z" 
                stroke={active ? '#60a5fa' : (hovered ? '#9B9B9B' : '#5D6065')}
                strokeWidth="1.2" 
                strokeLinejoin="round"
                fill="none"
              />
              {/* 中心连接点 */}
              <circle 
                cx="7" cy="7" r="1.5" 
                fill={active ? '#60a5fa' : (hovered ? '#9B9B9B' : '#5D6065')}
              />
              {/* 三条辐射线 */}
              <path 
                d="M7 5.5V3.5M5.7 8L4 9.5M8.3 8L10 9.5" 
                stroke={active ? '#60a5fa' : (hovered ? '#9B9B9B' : '#5D6065')}
                strokeWidth="1.2" 
                strokeLinecap="round"
              />
            </svg>
            {/* Status dot */}
            {status !== undefined && (
              <div style={{
                position: 'absolute',
                bottom: -1,
                right: -1,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: status ? '#22c55e' : '#525252',
                border: '1.5px solid #181818',
              }} />
            )}
          </>
        ) : (
          // Tools icon
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path 
              d="M8.5 3.5a1 1 0 0 0 0 1l1 1a1 1 0 0 0 1 0l2.5-2.5a4 4 0 0 1-5.3 5.3L4 12a1.4 1.4 0 0 1-2-2l3.7-3.7a4 4 0 0 1 5.3-5.3L8.5 3.5z" 
              stroke={active ? '#CDCDCD' : (hovered ? '#9B9B9B' : '#5D6065')}
              strokeWidth="1.2" 
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      
      {/* Label */}
      <span style={{ 
        flex: 1, 
        fontSize: 13, 
        fontWeight: 500, 
        color: active ? '#FFFFFF' : (hovered ? '#F0EFED' : '#9B9B9B'),
        overflow: 'hidden', 
        textOverflow: 'ellipsis', 
        whiteSpace: 'nowrap',
        transition: 'color 0.15s',
      }}>
        {label}
      </span>
      
      {/* Count Badge */}
      {count !== undefined && count > 0 && (
        <span style={{ 
          fontSize: 10, 
          color: '#6D7177',
          padding: '2px 6px',
          background: '#2A2A2A',
          borderRadius: 4,
          flexShrink: 0,
        }}>
          {count}
        </span>
      )}
    </button>
  )
}

function SkeletonItem({ width = '60%' }: { width?: string }) {
  return (
    <div style={{
      height: 28,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '0 4px',
    }}>
      <div style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        background: 'rgba(255,255,255,0.06)',
        flexShrink: 0,
      }} />
      <div style={{
        width,
        height: 10,
        borderRadius: 4,
        background: 'rgba(255,255,255,0.06)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)',
          animation: 'shimmer 1.5s infinite',
        }} />
      </div>
    </div>
  )
}