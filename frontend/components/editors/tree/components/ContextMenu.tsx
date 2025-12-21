'use client'

import React, { useState, useCallback, useRef, useEffect, CSSProperties } from 'react'

// ============================================
// Types
// ============================================
type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[]

export interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  path: string
  value: JsonValue
  anchorElement?: HTMLElement | null  // 触发菜单的元素，用于滚动时更新位置
  offsetX?: number  // 相对于 anchor 元素的 X 偏移
  offsetY?: number  // 相对于 anchor 元素的 Y 偏移
  align?: 'left' | 'right' // 对齐方式，right 表示菜单主体向左延伸（transform: translateX(-100%)）
}

interface ContextMenuProps {
  state: ContextMenuState
  onClose: () => void
  onAction: (action: string, payload?: any) => void
}

// ============================================
// Utils
// ============================================
function getTypeInfo(value: JsonValue): { type: string; color: string } {
  if (value === null) return { type: 'null', color: '#6b7280' }
  if (typeof value === 'string') return { type: 'string', color: '#e2e8f0' }
  if (typeof value === 'number') return { type: 'number', color: '#c084fc' }
  if (typeof value === 'boolean') return { type: 'boolean', color: '#fb7185' }
  if (Array.isArray(value)) return { type: 'array', color: '#fbbf24' }
  if (typeof value === 'object') return { type: 'object', color: '#34d399' }
  return { type: 'unknown', color: '#9ca3af' }
}

// ============================================
// Styles
// ============================================
const styles = {
  contextMenu: {
    position: 'fixed',
    background: '#1a1a1e',
    border: '1px solid #333',
    borderRadius: 8,
    padding: 4,
    minWidth: 160,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    zIndex: 1000,
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  } as CSSProperties,

  menuItem: (isDestructive = false): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    height: 28,
    padding: '0 12px',
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: isDestructive ? '#f87171' : '#d4d4d4',
    fontSize: 12,
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
  }),

  menuDivider: {
    height: 1,
    background: '#333',
    margin: '4px 0',
  } as CSSProperties,
}

// ============================================
// MenuItem Component
// ============================================
interface MenuItemProps {
  onClick?: () => void
  icon: React.ReactNode
  label: string
  destructive?: boolean
  hasSubmenu?: boolean
  onHover?: (show: boolean) => void
}

function MenuItem({ onClick, icon, label, destructive = false, hasSubmenu = false, onHover }: MenuItemProps) {
  return (
    <button
      style={styles.menuItem(destructive)}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = destructive ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.05)'
        onHover?.(true)
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <span style={{ width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {hasSubmenu && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5 }}>
          <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  )
}

// ============================================
// ContextMenu Component
// ============================================
export function ContextMenu({ state, onClose, onAction }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [showTurnInto, setShowTurnInto] = useState(false)
  const showTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null)
  const typeInfo = getTypeInfo(state.value)
  const isExpandable = state.value !== null && typeof state.value === 'object'
  
  // 动态位置（用于滚动时更新）
  const [position, setPosition] = useState({ x: state.x, y: state.y })
  
  // 滚动监听 - 实时更新菜单位置
  useEffect(() => {
    if (!state.visible) return
    
    // 如果有 anchor element，监听滚动并更新位置
    if (state.anchorElement) {
      const updatePosition = () => {
        if (!state.anchorElement) return
        const rect = state.anchorElement.getBoundingClientRect()
        setPosition({
          x: rect.left + (state.offsetX ?? 0),
          y: rect.top + (state.offsetY ?? 0),
        })
      }
      
      // 初始位置
      updatePosition()
      
      const handleScroll = () => {
        requestAnimationFrame(updatePosition)
      }
      
      window.addEventListener('scroll', handleScroll, true)
      window.addEventListener('resize', handleScroll)
      
      return () => {
        window.removeEventListener('scroll', handleScroll, true)
        window.removeEventListener('resize', handleScroll)
      }
    } else {
      // 没有 anchor element，使用传入的静态位置
      setPosition({ x: state.x, y: state.y })
    }
  }, [state.visible, state.anchorElement, state.x, state.y, state.offsetX, state.offsetY])

  // 延迟显示/隐藏子菜单
  const handleTurnIntoHover = useCallback((show: boolean) => {
    if (show) {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }
      showTimerRef.current = setTimeout(() => {
        setShowTurnInto(true)
      }, 150)
    } else {
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current)
        showTimerRef.current = null
      }
      hideTimerRef.current = setTimeout(() => {
        setShowTurnInto(false)
      }, 100)
    }
  }, [])

  const [showImportSubmenu, setShowImportSubmenu] = useState(false)
  const showImportTimerRef = useRef<NodeJS.Timeout | null>(null)
  const hideImportTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 延迟显示/隐藏 Import 子菜单
  const handleImportHover = useCallback((show: boolean) => {
    if (show) {
      if (hideImportTimerRef.current) {
        clearTimeout(hideImportTimerRef.current)
        hideImportTimerRef.current = null
      }
      showImportTimerRef.current = setTimeout(() => {
        setShowImportSubmenu(true)
      }, 150)
    } else {
      if (showImportTimerRef.current) {
        clearTimeout(showImportTimerRef.current)
        showImportTimerRef.current = null
      }
      hideImportTimerRef.current = setTimeout(() => {
        setShowImportSubmenu(false)
      }, 100)
    }
  }, [])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      if (showImportTimerRef.current) clearTimeout(showImportTimerRef.current)
      if (hideImportTimerRef.current) clearTimeout(hideImportTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  if (!state.visible) return null

  // Import 子菜单
  const ImportSubmenu = () => (
    <div 
      style={{
        position: 'absolute',
        left: '100%',
        top: 0,
        marginLeft: 4,
        background: '#1a1a1e',
        border: '1px solid #333',
        borderRadius: 8,
        padding: 4,
        minWidth: 140,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
      onMouseEnter={() => handleImportHover(true)}
      onMouseLeave={() => handleImportHover(false)}
    >
      <MenuItem 
        onClick={() => onAction('import-url')} 
        icon={
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v8M11 6L7 2 3 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 12h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        } 
        label="From URL..." 
      />
      <MenuItem 
        onClick={() => onAction('import-file')} 
        icon={
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 1H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5L9 1z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        } 
        label="From File..." 
      />
    </div>
  )

  const TurnIntoSubmenu = () => (
    <div 
      style={{
        position: 'absolute',
        left: '100%',
        top: 0,
        marginLeft: 4,
        background: '#1a1a1e',
        border: '1px solid #333',
        borderRadius: 8,
        padding: 4,
        minWidth: 140,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
      onMouseEnter={() => handleTurnIntoHover(true)}
      onMouseLeave={() => handleTurnIntoHover(false)}
    >
      {typeInfo.type !== 'object' && (
        <MenuItem onClick={() => onAction('convert', 'object')} icon="{ }" label="Object" />
      )}
      {typeInfo.type !== 'array' && (
        <MenuItem onClick={() => onAction('convert', 'array')} icon="[ ]" label="Array" />
      )}
      {typeInfo.type !== 'string' && (
        <MenuItem onClick={() => onAction('convert', 'string')} icon={`""`} label="String" />
      )}
      {typeInfo.type !== 'number' && (
        <MenuItem onClick={() => onAction('convert', 'number')} icon="123" label="Number" />
      )}
      {typeInfo.type !== 'boolean' && (
        <MenuItem onClick={() => onAction('convert', 'boolean')} icon="T/F" label="Boolean" />
      )}
      {typeInfo.type !== 'null' && (
        <MenuItem onClick={() => onAction('convert', 'null')} icon="∅" label="Null" />
      )}
    </div>
  )

  return (
    <div 
      ref={menuRef} 
      style={{ 
        ...styles.contextMenu, 
        left: position.x, 
        top: position.y,
        transform: state.align === 'right' ? 'translateX(-100%)' : 'none',
      }}
    >
      {/* 添加新元素 */}
      {isExpandable && (
        <>
          <MenuItem 
            onClick={() => onAction('add-child')} 
            icon={
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 3v8M3 7h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            }
            label={Array.isArray(state.value) ? 'Add Item' : 'Add Property'} 
          />
          <div style={styles.menuDivider} />
        </>
      )}

      {/* Copy 操作 */}
      <MenuItem 
        onClick={() => onAction('copy-value')} 
        icon={
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M4 4H2.5A1.5 1.5 0 001 5.5v6A1.5 1.5 0 002.5 13h6a1.5 1.5 0 001.5-1.5V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <rect x="5" y="1" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        } 
        label="Copy value" 
      />

      <MenuItem 
        onClick={() => onAction('copy-path')} 
        icon={
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 4l6-3M1 4l6 3M13 4l-6-3M13 4l-6 3M1 10l6-3M1 10l6 3M13 10l-6-3M13 10l-6 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        } 
        label="Copy path" 
      />

      <div style={styles.menuDivider} />

      {/* 数据操作 - Import Submenu */}
      <div 
        style={{ position: 'relative' }}
        onMouseEnter={() => handleImportHover(true)}
        onMouseLeave={() => handleImportHover(false)}
      >
        <MenuItem 
          icon={
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 10V3M7 3L4 6M7 3l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 10v1.5A1.5 1.5 0 003.5 13h7a1.5 1.5 0 001.5-1.5V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          } 
          label="Import Data" 
          hasSubmenu 
        />
        {showImportSubmenu && <ImportSubmenu />}
      </div>

      <div style={styles.menuDivider} />

      {/* 编辑操作 */}
      <MenuItem 
        onClick={() => onAction('duplicate')} 
        icon={
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M10 4V2.5A1.5 1.5 0 008.5 1H2.5A1.5 1.5 0 001 2.5v6A1.5 1.5 0 002.5 10H4" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        } 
        label="Duplicate" 
      />

      <div style={styles.menuDivider} />
      
      {/* Turn into 带子菜单 */}
      <div 
        style={{ position: 'relative' }}
        onMouseEnter={() => handleTurnIntoHover(true)}
        onMouseLeave={() => handleTurnIntoHover(false)}
      >
        <MenuItem 
          icon={
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2.5 7a4.5 4.5 0 018.1-2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M11 2v2.5H8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M11.5 7a4.5 4.5 0 01-8.1 2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <path d="M3 12V9.5h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          } 
          label="Turn into" 
          hasSubmenu 
        />
        {showTurnInto && <TurnIntoSubmenu />}
      </div>

      <div style={styles.menuDivider} />

      <MenuItem 
        onClick={() => onAction('clear-value')} 
        icon={
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 7m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M4 7l6 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        } 
        label="Clear Value" 
        destructive 
      />

      <div style={styles.menuDivider} />

      <MenuItem 
        onClick={() => onAction('delete')} 
        icon={
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 013 11.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <path d="M5.5 7v4M8.5 7v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        } 
        label="Delete Node" 
        destructive 
      />
    </div>
  )
}

export default ContextMenu

