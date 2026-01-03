'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const MIN_WIDTH = 180
const MAX_WIDTH = 320
const DEFAULT_WIDTH = 220
const COLLAPSED_WIDTH = 45

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Handle resize logic
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
    <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#040404' }}>
      
      {/* --- Settings Sidebar --- */}
      <aside
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
            <>
              <span style={{ 
                fontSize: 14, 
                fontWeight: 600, 
                color: '#EDEDED', 
                letterSpacing: '0.3px' 
              }}>
                Settings
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

        {/* Expanded Content */}
        {!isCollapsed && (
          <div style={{ flex: 1, overflowY: 'auto', paddingTop: 12 }}>
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
                  Workspace
                </span>
              </div>
              <div style={{ padding: '2px 8px 4px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                <NavItem 
                  href="/settings/connect"
                  active={pathname?.startsWith('/settings/connect')}
                  label="Import Settings"
                />
              </div>
            </div>
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
            <CollapsedNavItem 
              href="/settings/connect"
              active={pathname?.startsWith('/settings/connect')}
              title="Import Settings"
              icon={
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 9.5V2.5M7 9.5l-2.5-2.5M7 9.5l2.5-2.5M3.5 12h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              }
            />
          </div>
        )}

        {/* Resize Handle */}
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
      </aside>

      {/* --- Main Content Area --- */}
      <section style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </section>
    </div>
  )
}

// --- Sub Components ---

function NavItem({ active, href, label }: { active?: boolean, href: string, label: string }) {
  const [hovered, setHovered] = useState(false)
  
  return (
    <Link
      href={href}
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
        textDecoration: 'none',
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
      }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 9.5V2.5M7 9.5l-2.5-2.5M7 9.5l2.5-2.5M3.5 12h7" stroke={active ? '#CDCDCD' : (hovered ? '#9B9B9B' : '#5D6065')} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
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
    </Link>
  )
}

function CollapsedNavItem({ active, href, title, icon }: { active?: boolean, href: string, title: string, icon: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)

  return (
    <Link
      href={href}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 28,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active ? 'rgba(59, 130, 246, 0.15)' : (hovered ? 'rgba(255,255,255,0.08)' : 'transparent'),
        borderRadius: 5,
        cursor: 'pointer',
        color: active ? '#60a5fa' : (hovered ? '#e2e8f0' : '#808080'),
        transition: 'all 0.15s',
        textDecoration: 'none',
      }}
    >
      {icon}
    </Link>
  )
}
