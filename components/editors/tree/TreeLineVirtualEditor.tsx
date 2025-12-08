'use client'

import React, { useState, useCallback, useMemo, useRef, useEffect, CSSProperties, memo } from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import ReactMarkdown from 'react-markdown'
import { ContextMenu, type ContextMenuState } from './components/ContextMenu'

// ============================================
// Types
// ============================================
type JsonValue = string | number | boolean | null | JsonObject | JsonArray
interface JsonObject { [key: string]: JsonValue }
type JsonArray = JsonValue[]

interface FlatNode {
  path: string
  key: string | number
  value: JsonValue
  depth: number
  isLast: boolean
  isExpanded: boolean
  isExpandable: boolean
  parentLines: boolean[] // 用于绘制连接线
}

// ContextMenuState is imported from './components/ContextMenu'

// Access Point 类型，用于显示已配置的节点
interface ConfiguredAccessPoint {
  path: string
  permissions: { read: boolean; write: boolean }
}

interface PendingConfig {
  path: string
  permissions: { read: boolean; write: boolean }
}

interface TreeLineVirtualEditorProps {
  json: object
  onChange?: (json: object) => void
  onPathChange?: (path: string | null) => void
  onPublishPath?: (path: string) => void
  isSelectingAccessPoint?: boolean
  selectedAccessPath?: string | null
  onAddAccessPoint?: (path: string, permissions: { read: boolean; write: boolean }) => void
  // 已配置的 Access Points，用于在 JSON Editor 中高亮显示
  configuredAccessPoints?: ConfiguredAccessPoint[]
  // Pending 配置 - 用于在节点旁边显示浮动配置面板
  pendingConfig?: PendingConfig | null
  onPendingConfigChange?: (config: PendingConfig | null) => void
  onPendingConfigSave?: () => void
}

// ============================================
// Constants
// ============================================
const ROW_HEIGHT = 28
const BRANCH_WIDTH = 16     // ├─ 分支线宽度
const KEY_WIDTH = 64        // key 固定宽度
const SEP_WIDTH = 8         // ── 分隔线宽度
const MENU_WIDTH = 20       // 菜单按钮宽度 (absolute, 不占空间)
const LEVEL_WIDTH = BRANCH_WIDTH + KEY_WIDTH + SEP_WIDTH +12  // 每层 80px (不含菜单按钮)

const LINE_COLOR = '#3a3f47'


// ============================================
// Utils
// ============================================
function getTypeInfo(value: JsonValue): { type: string; color: string } {
  if (value === null) return { type: 'null', color: '#6b7280' }
  if (typeof value === 'string') return { type: 'string', color: '#e2e8f0' }  // 主题白
  if (typeof value === 'number') return { type: 'number', color: '#c084fc' }
  if (typeof value === 'boolean') return { type: 'boolean', color: '#fb7185' }
  if (Array.isArray(value)) return { type: 'array', color: '#fbbf24' }  // 亮黄
  if (typeof value === 'object') return { type: 'object', color: '#34d399' }  // 亮绿
  return { type: 'unknown', color: '#9ca3af' }
}

// 扁平化 JSON 树（内部递归）
function flattenJsonRecursive(
  json: any,
  expandedPaths: Set<string>,
  path: string,
  depth: number,
  parentLines: boolean[]
): FlatNode[] {
  if (json === null || typeof json !== 'object') return []
  
  const result: FlatNode[] = []
  const entries = Array.isArray(json) 
    ? json.map((v, i) => [i, v] as [number, any])
    : Object.entries(json)
  
  entries.forEach(([key, value], index) => {
    const nodePath = `${path}/${key}`
    const isExpandable = value !== null && typeof value === 'object'
    const isExpanded = expandedPaths.has(nodePath)
    const isLast = index === entries.length - 1
    
    result.push({
      path: nodePath,
      key,
      value,
      depth,
      isLast,
      isExpanded,
      isExpandable,
      parentLines: [...parentLines],
    })
    
    if (isExpandable && isExpanded) {
      const childParentLines = [...parentLines, !isLast]
      result.push(...flattenJsonRecursive(value, expandedPaths, nodePath, depth + 1, childParentLines))
    }
  })
  
  return result
}

// 扁平化 JSON 树（带根节点）
function flattenJson(json: any, expandedPaths: Set<string>): FlatNode[] {
  const ROOT_PATH = ''
  const isRootExpanded = expandedPaths.has(ROOT_PATH)
  const isRootExpandable = json !== null && typeof json === 'object'
  
  // 根节点（depth = -1，不占用缩进空间）
  const rootNode: FlatNode = {
    path: ROOT_PATH,
    key: '$root',
    value: json,
    depth: -1,
    isLast: true,
    isExpanded: isRootExpanded,
    isExpandable: isRootExpandable,
    parentLines: [],
  }
  
  const result: FlatNode[] = [rootNode]
  
  // 根节点展开时添加子节点（子节点 depth 从 0 开始）
  if (isRootExpandable && isRootExpanded) {
    result.push(...flattenJsonRecursive(json, expandedPaths, ROOT_PATH, 0, []))
  }
  
  return result
}

// 根据路径更新 JSON
function updateJsonAtPath(json: any, path: string, newValue: JsonValue): any {
  const parts = path.split('/').filter(Boolean)
  const result = JSON.parse(JSON.stringify(json))
  
  let current = result
  for (let i = 0; i < parts.length - 1; i++) {
    current = current[parts[i]]
  }
  current[parts[parts.length - 1]] = newValue
  
  return result
}

// ============================================
// Styles
// ============================================
const styles = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'transparent',
    color: '#d4d4d4',
    overflow: 'hidden',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: 13,
  } as CSSProperties,

  header: {
    padding: '10px 14px',
    borderBottom: '1px solid #1f1f1f',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: '#0d0d0f',
  } as CSSProperties,

  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } as CSSProperties,

  rootLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: '#569cd6',
  } as CSSProperties,

  stats: {
    fontSize: 10,
    color: '#555',
    background: 'rgba(255,255,255,0.05)',
    padding: '2px 8px',
    borderRadius: 4,
  } as CSSProperties,

  scrollContainer: {
  flex: 1,
  overflow: 'auto',
  paddingLeft: 24,
  paddingTop: 16,
} as CSSProperties,

  row: (isSelected: boolean, isHovered: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'flex-start',  // 顶部对齐，支持多行内容
    minHeight: ROW_HEIGHT,
    paddingRight: 12,
    background: isSelected 
      ? 'rgba(255, 255, 255, 0.04)'  // 浅灰色
      : isHovered 
        ? 'rgba(255, 255, 255, 0.02)' 
        : 'transparent',
    cursor: 'pointer',
    userSelect: 'none',
  }),

  // Notion 风格的菜单按钮 - absolute 定位，不占空间
  menuHandle: (visible: boolean, left: number): CSSProperties => ({
    position: 'absolute',
    left: left - MENU_WIDTH - 4,  // 在 value 左侧
    top: 4,
    width: MENU_WIDTH,
    height: MENU_WIDTH,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: visible ? 'rgba(255,255,255,0.1)' : 'transparent',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    opacity: visible ? 1 : 0,
    transition: 'opacity 0.12s',
    color: '#9ca3af',
    zIndex: 1,
  }),

  toggleBtn: {
    width: 18,
    height: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    borderRadius: 3,
    flexShrink: 0,
  } as CSSProperties,

  keyName: {
    color: '#6b7280',  // 与 index 相近的灰色
    fontWeight: 400,
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  } as CSSProperties,

  indexKey: {
    color: '#6b7280',  // 统一灰色
    fontWeight: 400,
    fontSize: 12,
    flexShrink: 0,
  } as CSSProperties,

  value: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  } as CSSProperties,
}

// ============================================
// Line Drawing Helpers
// ============================================
// 绘制一个层级的连接线：从父节点的值位置延伸下来
// 连接线组件 - 支持动态行高
const LevelConnector = React.memo(function LevelConnector({ 
  depth, 
  isLast, 
  parentLines 
}: { 
  depth: number
  isLast: boolean 
  parentLines: boolean[]
}) {
  const hh = ROW_HEIGHT / 2  // 水平线的垂直位置（基于最小行高）
  const branchX = 8 + depth * LEVEL_WIDTH

  return (
    <svg 
      style={{ 
        position: 'absolute',
        left: 0,
        top: 0,
        width: branchX + BRANCH_WIDTH,
        height: '100%',  // 适应实际行高
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      preserveAspectRatio="none"
    >
      {/* 父级竖线：parentLines[i]=true → depth=i 的祖先不是最后一个，画竖线延伸 */}
      {parentLines.map((showLine, i) => {
        if (!showLine) return null
        const x = 8 + i * LEVEL_WIDTH
        return (
          <line 
            key={i}
            x1={x} y1={0} 
            x2={x} y2="100%" 
            stroke={LINE_COLOR} 
            strokeWidth={1} 
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
      
      {/* 当前节点的 ├─ 或 └─ */}
      <line 
        x1={branchX} y1={0} 
        x2={branchX} y2={isLast ? hh : '100%'} 
        stroke={LINE_COLOR} 
        strokeWidth={1} 
        vectorEffect="non-scaling-stroke"
      />
      <line 
        x1={branchX} y1={hh} 
        x2={branchX + BRANCH_WIDTH - 2} y2={hh} 
        stroke={LINE_COLOR} 
        strokeWidth={1} 
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
})

// ============================================
// Virtual Row Component
// ============================================
interface VirtualRowProps {
  node: FlatNode
  isSelected: boolean
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  onValueChange: (path: string, value: JsonValue) => void
  onContextMenu: (e: React.MouseEvent, path: string, value: JsonValue) => void
  onPublish?: (path: string) => void
  isSelectingAccessPoint?: boolean
  selectedAccessPath?: string | null
  onAddAccessPoint?: (path: string, permissions: { read: boolean; write: boolean }) => void
  // 已配置的 Access Point（如果当前节点已配置）
  configuredAccess?: { read: boolean; write: boolean } | null
  // 祖先 Access Point 信息（用于子孙节点的竖线和背景）
  ancestorAccess?: { 
    permissions: { read: boolean; write: boolean }
    depth: number  // 祖先节点的 depth，用于计算竖线位置
  } | null
  // Pending 配置面板
  pendingConfig?: PendingConfig | null
  onPendingConfigChange?: (config: PendingConfig | null) => void
  onPendingConfigSave?: () => void
}

// 编辑时也要选中当前行
const handleEditClick = (e: React.MouseEvent, onSelect: () => void) => {
  e.stopPropagation()
  onSelect()  // 点击编辑区也触发选中
}

const VirtualRow = React.memo(function VirtualRow({
  node,
  isSelected,
  onToggle,
  onSelect,
  onValueChange,
  onContextMenu,
  onPublish,
  isSelectingAccessPoint,
  selectedAccessPath,
  onAddAccessPoint,
  configuredAccess,
  ancestorAccess,
  pendingConfig,
  onPendingConfigChange,
  onPendingConfigSave,
}: VirtualRowProps) {
  const [hovered, setHovered] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null)
  
  // Check if this node is the currently selected access point
  const isAccessSelected = isSelectingAccessPoint && selectedAccessPath === node.path
  // Check if this node is already configured (for View Mode highlighting)
  const isConfigured = !!configuredAccess
  const hasWriteAccess = configuredAccess?.write
  // Check if this node is a descendant of an access point
  const isDescendant = !!ancestorAccess && !isConfigured
  const ancestorHasWrite = ancestorAccess?.permissions.write
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  
  // Check if this node has a pending config panel
  const isPendingNode = pendingConfig?.path === node.path
  
  // 计算浮动面板位置
  useEffect(() => {
    if (isPendingNode && rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect()
      setPanelPosition({
        top: rect.bottom + 4,
        left: rect.right - 180, // 面板宽度 180px，靠右对齐
      })
    } else {
      setPanelPosition(null)
    }
  }, [isPendingNode])
  
  const typeInfo = getTypeInfo(node.value)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, node.path, node.value)
  }, [node.path, node.value, onContextMenu])

  const handleDoubleClick = useCallback(() => {
    if (!node.isExpandable) {
      setEditing(true)
      setEditValue(node.value === null ? 'null' : String(node.value))
    }
  }, [node.isExpandable, node.value])

  const handleEditSubmit = useCallback(() => {
    setEditing(false)
    let newValue: JsonValue = editValue
    if (editValue === 'null') newValue = null
    else if (editValue === 'true') newValue = true
    else if (editValue === 'false') newValue = false
    else if (!isNaN(Number(editValue)) && editValue.trim() !== '') newValue = Number(editValue)
    onValueChange(node.path, newValue)
  }, [editValue, node.path, onValueChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleEditSubmit()
    else if (e.key === 'Escape') setEditing(false)
  }, [handleEditSubmit])

  // 渲染值（基础类型）
  const [expanded, setExpanded] = useState(false)
  const PREVIEW_CHARS = 250

  // Markdown 渲染组件
  const MarkdownContent = ({ content }: { content: string }) => (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p style={{ margin: '4px 0' }}>{children}</p>,
        h1: ({ children }) => <h1 style={{ fontSize: 15, margin: '8px 0 4px', fontWeight: 600, color: '#e2e8f0' }}>{children}</h1>,
        h2: ({ children }) => <h2 style={{ fontSize: 14, margin: '6px 0 4px', fontWeight: 600, color: '#e2e8f0' }}>{children}</h2>,
        h3: ({ children }) => <h3 style={{ fontSize: 13, margin: '4px 0', fontWeight: 600, color: '#e2e8f0' }}>{children}</h3>,
        code: ({ children }) => (
          <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre style={{ background: 'rgba(0,0,0,0.3)', padding: 8, borderRadius: 4, overflow: 'auto', fontSize: 11 }}>
            {children}
          </pre>
        ),
        ul: ({ children }) => <ul style={{ margin: '4px 0', paddingLeft: 16 }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ margin: '4px 0', paddingLeft: 16 }}>{children}</ol>,
        li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
        a: ({ href, children }) => (
          <a href={href} style={{ color: '#60a5fa', textDecoration: 'underline' }} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )

  const editableRef = useRef<HTMLDivElement>(null)

  // 处理 contentEditable 保存
  const handleContentEditableBlur = useCallback(() => {
    if (editableRef.current) {
      const newValue = editableRef.current.innerText
      if (newValue !== String(node.value)) {
        // 尝试解析为正确的类型
        let parsedValue: JsonValue = newValue
        if (newValue === 'true') parsedValue = true
        else if (newValue === 'false') parsedValue = false
        else if (newValue === 'null') parsedValue = null
        else if (!isNaN(Number(newValue)) && newValue.trim() !== '') parsedValue = Number(newValue)
        
        onValueChange(node.path, parsedValue)
      }
    }
    setEditing(false)
  }, [node.path, node.value, onValueChange])

  const handleContentEditableKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // 恢复原值
      if (editableRef.current) {
        editableRef.current.innerText = String(node.value)
      }
      editableRef.current?.blur()
      return
    }
    
    // 字符串类型：Enter 正常换行，Cmd/Ctrl+Enter 保存
    // 其他类型：Enter 直接保存
    if (e.key === 'Enter') {
      if (typeof node.value === 'string') {
        // 字符串：Cmd/Ctrl+Enter 保存，普通 Enter 换行
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault()
          editableRef.current?.blur()
        }
        // 普通 Enter 不阻止，让浏览器插入换行
      } else {
        // 非字符串：Enter 保存
        e.preventDefault()
        editableRef.current?.blur()
      }
    }
  }, [node.value])

  const renderPrimitiveValue = () => {
    // 字符串：无感式编辑（Notion 风格）
    if (typeof node.value === 'string') {
      const str = node.value
      const processedStr = str.replace(/\\n/g, '\n')
      const isLong = processedStr.length > PREVIEW_CHARS
      const displayContent = (expanded || !isLong) ? processedStr : processedStr.slice(0, PREVIEW_CHARS)
      
      return (
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            ref={editableRef}
            contentEditable={!isSelectingAccessPoint}
            suppressContentEditableWarning
            onBlur={handleContentEditableBlur}
            onKeyDown={handleContentEditableKeyDown}
            onClick={isSelectingAccessPoint ? undefined : (e) => handleEditClick(e, () => onSelect(node.path))}
          style={{
              color: typeInfo.color,
              fontSize: 12,
              lineHeight: 1.6,
              padding: '2px 4px',
              margin: '-2px -4px',
            borderRadius: 3,
            outline: 'none',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              cursor: isSelectingAccessPoint ? 'pointer' : 'text',
              transition: 'background 0.15s',
              pointerEvents: isSelectingAccessPoint ? 'none' : 'auto',
            }}
            onFocus={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'
            }}
            onMouseEnter={(e) => {
              if (document.activeElement !== e.currentTarget) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
              }
            }}
            onMouseLeave={(e) => {
              if (document.activeElement !== e.currentTarget) {
                e.currentTarget.style.background = 'transparent'
              }
            }}
          >
            {displayContent}
          </div>
          {isLong && !expanded && !isSelectingAccessPoint && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(true) }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 6,
                padding: '3px 10px',
                background: 'transparent',
                border: '1px solid #3a3f47',
                borderRadius: 4,
                color: '#9ca3af',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {`Expand (${processedStr.length} chars)`}
            </button>
          )}
          {isLong && expanded && !isSelectingAccessPoint && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(false) }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 6,
                padding: '3px 10px',
                background: 'transparent',
                border: '1px solid #3a3f47',
                borderRadius: 4,
                color: '#9ca3af',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 6.5L5 3.5L8 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Collapse
            </button>
          )}
        </div>
      )
    }

    // 其他类型（number, boolean, null）也支持无感编辑
    return (
      <div
        ref={editableRef}
        contentEditable={!isSelectingAccessPoint}
        suppressContentEditableWarning
        onBlur={handleContentEditableBlur}
        onKeyDown={handleContentEditableKeyDown}
        onClick={isSelectingAccessPoint ? undefined : (e) => handleEditClick(e, () => onSelect(node.path))}
        style={{
          color: typeInfo.color,
          padding: '2px 4px',
          margin: '-2px -4px',
          borderRadius: 3,
          outline: 'none',
          cursor: isSelectingAccessPoint ? 'pointer' : 'text',
          transition: 'background 0.15s',
          pointerEvents: isSelectingAccessPoint ? 'none' : 'auto',
        }}
        onFocus={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'
        }}
        onMouseEnter={(e) => {
          if (document.activeElement !== e.currentTarget) {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'
          }
        }}
        onMouseLeave={(e) => {
          if (document.activeElement !== e.currentTarget) {
            e.currentTarget.style.background = 'transparent'
          }
        }}
      >
        {String(node.value)}
      </div>
    )
  }

  // 渲染可展开的值：简洁的 {n} 或 [n] + 展开箭头
  const renderExpandableValue = () => {
    const count = Array.isArray(node.value) 
      ? node.value.length 
      : Object.keys(node.value as object).length
    const isArr = Array.isArray(node.value)
    const color = isArr ? '#fbbf24' : '#34d399'  // 亮黄/亮绿
    
    return (
      <span
        onClick={isSelectingAccessPoint ? undefined : (e) => { e.stopPropagation(); onToggle(node.path) }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          cursor: isSelectingAccessPoint ? 'pointer' : 'pointer',
          fontSize: 13,
          fontFamily: 'inherit',
          pointerEvents: isSelectingAccessPoint ? 'none' : 'auto',
        }}
      >
        {/* 括号内放三角形 */}
        <span style={{ color, display: 'inline-flex', alignItems: 'center' }}>
          <span>{isArr ? '[' : '{'}</span>
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            fill="none"
            style={{
              transform: node.isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.12s',
              margin: '0 1px',
            }}
          >
            <path d="M2 1L6 4L2 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{isArr ? ']' : '}'}</span>
        </span>
        {/* 数字放外面 */}
        <span style={{ color: '#64748b', fontSize: 11 }}>{count}</span>
      </span>
    )
  }

  // 是否是根节点
  const isRootNode = node.key === '$root'
  
  // 计算当前节点的内容起始位置
  // 根节点：marginLeft = -1，让 toggleBtn (18px) 的中心对齐到 x=8（子节点竖线位置）
  // 子节点：正常计算
  const contentLeft = isRootNode ? -1 : (8 + node.depth * LEVEL_WIDTH + BRANCH_WIDTH)

  // 点击菜单按钮 - 直接调用父组件的 onContextMenu
  const handleMenuClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    onContextMenu(
      { clientX: rect.left - 164, clientY: rect.top } as React.MouseEvent,
      node.path,
      node.value
    )
  }, [node.path, node.value, onContextMenu])

  // Handle click - in selection mode, directly trigger onAddAccessPoint
  const handleRowClick = useCallback(() => {
    if (isSelectingAccessPoint) {
      onAddAccessPoint?.(node.path, { read: true, write: false })
    } else {
      onSelect(node.path)
    }
  }, [isSelectingAccessPoint, node.path, onSelect, onAddAccessPoint])

  return (
    <div
      ref={rowRef}
      style={{
        ...styles.row(isSelected, hovered && !isSelectingAccessPoint),
        position: 'relative',
        cursor: isSelectingAccessPoint ? 'pointer' : 'pointer',
      }}
      onClick={handleRowClick}
      onDoubleClick={isSelectingAccessPoint ? undefined : handleDoubleClick}
      onContextMenu={isSelectingAccessPoint ? undefined : handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 连接线（根节点不显示） */}
      {!isRootNode && (
        <LevelConnector 
          depth={node.depth} 
          isLast={node.isLast} 
          parentLines={node.parentLines} 
        />
      )}
      
      {/* 子孙节点的 Access Point 背景和竖线 */}
      {isDescendant && ancestorAccess && (() => {
        // 计算祖先节点的 contentLeft
        const ancestorContentLeft = ancestorAccess.depth === -1 
          ? -1  // root node
          : (8 + ancestorAccess.depth * LEVEL_WIDTH + BRANCH_WIDTH)
        
        // 背景起始位置 = 祖先的 value 框左边缘
        // 对于 root：value 直接在 contentLeft，box 左边缘 = contentLeft - 8 (margin)
        // 对于非 root：value 在 contentLeft + KEY_WIDTH + SEP_WIDTH，box 左边缘 = 那个位置 - 8
        const bgStartX = ancestorAccess.depth === -1
          ? ancestorContentLeft - 8  // root: -1 - 8 = -9
          : ancestorContentLeft + KEY_WIDTH + SEP_WIDTH - 8  // others: contentLeft + 64
        
        return (
          <div
            style={{
              position: 'absolute',
              left: bgStartX,
              top: 0,
              right: 0,
              bottom: 0,
              // 纯背景色块，像荧光笔一样标记区域
              background: ancestorHasWrite ? 'rgba(251, 191, 36, 0.12)' : 'rgba(52, 211, 153, 0.12)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
        )
      })()}
      
      {/* 菜单按钮 */}
      <button
        style={styles.menuHandle(hovered, isRootNode ? contentLeft : (contentLeft + KEY_WIDTH + SEP_WIDTH))}
        onClick={handleMenuClick}
        title="操作菜单"
      >
        <svg width="8" height="12" viewBox="0 0 8 12" fill="none">
          <circle cx="2" cy="2" r="1.2" fill="currentColor"/>
          <circle cx="2" cy="6" r="1.2" fill="currentColor"/>
          <circle cx="2" cy="10" r="1.2" fill="currentColor"/>
          <circle cx="6" cy="2" r="1.2" fill="currentColor"/>
          <circle cx="6" cy="6" r="1.2" fill="currentColor"/>
          <circle cx="6" cy="10" r="1.2" fill="currentColor"/>
        </svg>
      </button>
      
      {/* 内容区域 */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'flex-start',
        marginLeft: contentLeft,
        paddingTop: 4,
        flex: 1,
      }}>
        {/* Key + 分隔线（根节点不显示） */}
        {!isRootNode && (
          <div style={{
            width: KEY_WIDTH + SEP_WIDTH,
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            height: 20,
          }}>
            <span style={{
              flexShrink: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: KEY_WIDTH,
              ...(typeof node.key === 'number' ? styles.indexKey : styles.keyName),
            }}>
              {node.key}
            </span>
            <span style={{
              flex: 1,
              height: 1,
              background: LINE_COLOR,
              marginLeft: 6,
              minWidth: 12,
            }} />
          </div>
        )}
        
        {/* Value */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flex: 1,
            borderRadius: 4,
            transition: 'all 0.12s ease',
            padding: '3px 8px',
            margin: '-3px -8px',
            // 优先级：Selection Mode 交互 > 已配置节点
            ...(isSelectingAccessPoint && (isAccessSelected || hovered) ? {
              // Selection Mode 交互样式（选中或 hover）
              ...(isAccessSelected ? {
                background: 'rgba(52, 211, 153, 0.15)',
                outline: '2px solid rgba(52, 211, 153, 0.8)',
              } : {
                background: 'rgba(52, 211, 153, 0.08)',
                outline: '1.5px dashed rgba(52, 211, 153, 0.6)',
              }),
            } : 
            // 已配置节点的圈起来效果
            isConfigured ? {
              // 背景色与子节点呼应，略深一点作为 Header
              background: hasWriteAccess ? 'rgba(251, 191, 36, 0.15)' : 'rgba(52, 211, 153, 0.15)',
              // 统一的柔和边框
              border: `1px solid ${hasWriteAccess ? 'rgba(251, 191, 36, 0.4)' : 'rgba(52, 211, 153, 0.4)'}`,
              // 左侧短粗线强调，作为权限区块的入口锚点
              borderLeft: `3px solid ${hasWriteAccess ? 'rgba(251, 191, 36, 0.7)' : 'rgba(52, 211, 153, 0.7)'}`,
            } : {}),
            // 子孙节点的背景已经通过绝对定位的 div 实现，这里不需要额外样式
          }}
        >
          {node.isExpandable ? renderExpandableValue() : renderPrimitiveValue()}
          
          {/* 已配置节点的权限标签（始终显示，Selection Mode 下也显示） */}
          {isConfigured && (
            <div style={{ 
              display: 'flex', 
              gap: 3, 
              marginLeft: 8,
              flexShrink: 0,
            }}>
              {configuredAccess?.read && (
                <span style={{
                  padding: '1px 4px',
                  background: 'rgba(52, 211, 153, 0.2)',
                  color: '#34d399',
                  fontSize: 9,
                  fontWeight: 600,
                  borderRadius: 3,
                  letterSpacing: '0.5px',
                }}>R</span>
              )}
              {configuredAccess?.write && (
                <span style={{
                  padding: '1px 4px',
                  background: 'rgba(251, 191, 36, 0.2)',
                  color: '#fbbf24',
                  fontSize: 9,
                  fontWeight: 600,
                  borderRadius: 3,
                  letterSpacing: '0.5px',
                }}>W</span>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Pending Config 浮动面板 - 使用 Portal 渲染到 body，避免被 overflow 裁剪 */}
      {isPendingNode && pendingConfig && onPendingConfigChange && panelPosition && typeof document !== 'undefined' && createPortal(
        <div
          style={{
            position: 'fixed',
            top: panelPosition.top,
            left: panelPosition.left,
            width: 180,
            background: 'rgba(15, 15, 18, 0.98)',
            border: '1px solid rgba(52, 211, 153, 0.4)',
            borderRadius: 6,
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            zIndex: 10000,
            overflow: 'hidden',
            fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Checkbox 列表 */}
          <div style={{ padding: '6px 0' }}>
            {/* Read 选项 */}
            <label 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8,
                padding: '6px 10px',
                cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div 
                onClick={() => onPendingConfigChange({
                  ...pendingConfig,
                  permissions: { ...pendingConfig.permissions, read: !pendingConfig.permissions.read }
                })}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  border: '1px solid',
                  borderColor: pendingConfig.permissions.read ? '#34d399' : '#404040',
                  background: pendingConfig.permissions.read ? '#34d399' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
              >
                {pendingConfig.permissions.read && (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span style={{ fontSize: 11, color: '#e2e8f0' }}>Read</span>
            </label>
            
            {/* Write 选项 */}
            <label 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8,
                padding: '6px 10px',
                cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <div 
                onClick={() => onPendingConfigChange({
                  ...pendingConfig,
                  permissions: { ...pendingConfig.permissions, write: !pendingConfig.permissions.write }
                })}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  border: '1px solid',
                  borderColor: pendingConfig.permissions.write ? '#fbbf24' : '#404040',
                  background: pendingConfig.permissions.write ? '#fbbf24' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
              >
                {pendingConfig.permissions.write && (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span style={{ fontSize: 11, color: '#e2e8f0' }}>Write</span>
            </label>
          </div>
          
          {/* 按钮 */}
          <div style={{ 
            display: 'flex', 
            gap: 6, 
            padding: '8px 10px',
            borderTop: '1px solid rgba(45,45,50,0.5)',
          }}>
            <button 
              onClick={() => onPendingConfigChange(null)} 
              style={{ 
                flex: 1, 
                height: 26, 
                background: 'transparent', 
                border: '1px solid rgba(255,255,255,0.1)', 
                borderRadius: 4, 
                color: '#6b7280', 
                fontSize: 10, 
                fontWeight: 500, 
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button 
              onClick={() => {
                if (pendingConfig.permissions.read || pendingConfig.permissions.write) {
                  onPendingConfigSave?.()
                }
              }} 
              style={{ 
                flex: 1, 
                height: 26, 
                background: (pendingConfig.permissions.read || pendingConfig.permissions.write) ? '#34d399' : 'rgba(52, 211, 153, 0.3)', 
                border: 'none', 
                borderRadius: 4, 
                color: (pendingConfig.permissions.read || pendingConfig.permissions.write) ? '#000' : '#525252', 
                fontSize: 10, 
                fontWeight: 600, 
                cursor: (pendingConfig.permissions.read || pendingConfig.permissions.write) ? 'pointer' : 'not-allowed',
              }}
            >
              Save
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
})

// ============================================
// Main Component
// ============================================
export function TreeLineVirtualEditor({ 
  json, 
  onChange, 
  onPathChange, 
  onPublishPath,
  isSelectingAccessPoint = false,
  selectedAccessPath = null,
  onAddAccessPoint,
  configuredAccessPoints = [],
  pendingConfig = null,
  onPendingConfigChange,
  onPendingConfigSave,
}: TreeLineVirtualEditorProps) {
  // 创建 path -> permissions 的快速查找表
  const configuredAccessMap = useMemo(() => {
    const map = new Map<string, { read: boolean; write: boolean }>()
    configuredAccessPoints.forEach(ap => {
      map.set(ap.path, ap.permissions)
    })
    return map
  }, [configuredAccessPoints])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    path: '',
    value: null,
  })
  
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    // 默认展开根节点和前两层
    const paths = new Set<string>()
    paths.add('') // 根节点
    const expand = (obj: any, path: string, depth: number) => {
      if (depth > 1 || obj === null || typeof obj !== 'object') return
      paths.add(path)
      const entries = Array.isArray(obj) ? obj.map((v, i) => [i, v]) : Object.entries(obj)
      entries.forEach(([k, v]) => expand(v, `${path}/${k}`, depth + 1))
    }
    const entries = Array.isArray(json) ? json.map((v, i) => [i, v]) : Object.entries(json)
    entries.forEach(([k, v]) => {
      const p = `/${k}`
      paths.add(p)
      expand(v, p, 1)
    })
    return paths
  })
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  // 扁平化节点列表
  const flatNodes = useMemo(() => {
    return flattenJson(json, expandedPaths)
  }, [json, expandedPaths])

  // 创建祖先 access point 查找函数
  const getAncestorAccess = useMemo(() => {
    // 建立 path -> depth 的映射
    const pathToDepth = new Map<string, number>()
    flatNodes.forEach(node => pathToDepth.set(node.path, node.depth))
    
    return (nodePath: string): { permissions: { read: boolean; write: boolean }; depth: number } | null => {
      // 如果自身是 access point，跳过
      if (configuredAccessMap.has(nodePath)) return null
      
      // 找最近的祖先 access point
      for (const ap of configuredAccessPoints) {
        if (nodePath.startsWith(ap.path + '/')) {
          const ancestorDepth = pathToDepth.get(ap.path)
          if (ancestorDepth !== undefined) {
            return { permissions: ap.permissions, depth: ancestorDepth }
          }
        }
      }
      return null
    }
  }, [flatNodes, configuredAccessPoints, configuredAccessMap])

  // 虚拟滚动
  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  // 使用 ResizeObserver 监测行高变化
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const observedElementsRef = useRef<Set<Element>>(new Set())

  useEffect(() => {
    // 创建 ResizeObserver
    resizeObserverRef.current = new ResizeObserver((entries) => {
      let needsRemeasure = false
      for (const entry of entries) {
        const element = entry.target as HTMLElement
        const index = element.dataset.index
        if (index !== undefined) {
          needsRemeasure = true
        }
      }
      if (needsRemeasure) {
        virtualizer.measure()
      }
    })

    return () => {
      resizeObserverRef.current?.disconnect()
    }
  }, [virtualizer])

  // 观察元素的 ref callback
  const observeElement = useCallback((element: HTMLDivElement | null, index: number) => {
    if (!resizeObserverRef.current) return
    
    if (element) {
      if (!observedElementsRef.current.has(element)) {
        resizeObserverRef.current.observe(element)
        observedElementsRef.current.add(element)
      }
      // 同时调用 virtualizer 的 measureElement
      virtualizer.measureElement(element)
    }
  }, [virtualizer])

  // 清理不再显示的元素
  useEffect(() => {
    const visibleIndices = new Set(virtualizer.getVirtualItems().map(item => item.index))
    observedElementsRef.current.forEach(element => {
      const index = parseInt((element as HTMLElement).dataset.index || '-1', 10)
      if (!visibleIndices.has(index)) {
        resizeObserverRef.current?.unobserve(element)
        observedElementsRef.current.delete(element)
      }
    })
  })

  // 当节点数量变化时，强制重新测量
  const prevCountRef = useRef(flatNodes.length)
  useEffect(() => {
    if (prevCountRef.current !== flatNodes.length) {
      prevCountRef.current = flatNodes.length
      requestAnimationFrame(() => {
        virtualizer.measure()
      })
    }
  }, [flatNodes.length, virtualizer])

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const handleSelect = useCallback((path: string) => {
    setSelectedPath(path)
    onPathChange?.(path)
  }, [onPathChange])

  const handleValueChange = useCallback((path: string, newValue: JsonValue) => {
    if (!onChange) return
    const updated = updateJsonAtPath(json, path, newValue)
    onChange(updated)
  }, [json, onChange])

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, value: JsonValue) => {
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      path,
      value,
    })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  const handleMenuAction = useCallback((action: string, payload?: any) => {
    if (!onChange) return

    const { path, value } = contextMenu
    const parts = path.split('/').filter(Boolean)
    const newJson = JSON.parse(JSON.stringify(json))

    // Navigate to parent
    let parent: any = newJson
    for (let i = 0; i < parts.length - 1; i++) {
      parent = parent[parts[i]]
    }
    const lastKey = parts[parts.length - 1]

    switch (action) {
      case 'convert': {
        let newValue: JsonValue
        switch (payload) {
          case 'object':
            if (typeof value === 'object' && value !== null) {
              newValue = Array.isArray(value)
                ? Object.fromEntries(value.map((v, i) => [String(i), v]))
                : value
            } else {
              newValue = { value: value }
            }
            break
          case 'array':
            if (typeof value === 'object' && value !== null) {
              newValue = Array.isArray(value) ? value : Object.values(value)
            } else {
              newValue = [value]
            }
            break
          case 'string':
            newValue = String(value ?? '')
            break
          case 'number':
            newValue = Number(value) || 0
            break
          case 'boolean':
            newValue = Boolean(value)
            break
          case 'null':
            newValue = null
            break
          default:
            newValue = value
        }
        parent[lastKey] = newValue
        // Auto-expand if converted to object/array
        if (payload === 'object' || payload === 'array') {
          setExpandedPaths(prev => new Set([...prev, path]))
        }
        break
      }

      case 'add-child': {
        if (Array.isArray(parent[lastKey])) {
          parent[lastKey].push(null)
        } else if (typeof parent[lastKey] === 'object' && parent[lastKey] !== null) {
          const newKey = `newKey${Object.keys(parent[lastKey]).length}`
          parent[lastKey][newKey] = null
        }
        // Ensure expanded
        setExpandedPaths(prev => new Set([...prev, path]))
        break
      }

      case 'duplicate': {
        const duplicated = JSON.parse(JSON.stringify(value))
        if (Array.isArray(parent)) {
          parent.splice(Number(lastKey) + 1, 0, duplicated)
        } else {
          parent[`${lastKey}_copy`] = duplicated
        }
        break
      }

      case 'delete': {
        if (Array.isArray(parent)) {
          parent.splice(Number(lastKey), 1)
        } else {
          delete parent[lastKey]
        }
        break
      }
    }

    onChange(newJson)
    closeContextMenu()
  }, [json, onChange, contextMenu, closeContextMenu])

  const totalNodes = useMemo(() => {
    const count = (obj: any): number => {
      if (obj === null || typeof obj !== 'object') return 0
      const entries = Array.isArray(obj) ? obj : Object.values(obj)
      return entries.length + entries.reduce((sum, v) => sum + count(v), 0)
    }
    return count(json)
  }, [json])

  const isArray = Array.isArray(json)
  const isPrimitive = json === null || typeof json !== 'object'

  return (
    <div style={styles.container}>
      <div ref={scrollRef} style={styles.scrollContainer}>
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const node = flatNodes[virtualRow.index]
            return (
              <div
                key={node.path || '$root'}
                data-index={virtualRow.index}
                ref={(el) => observeElement(el, virtualRow.index)}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <VirtualRow
                  node={node}
                  isSelected={selectedPath === node.path}
                  onToggle={handleToggle}
                  onSelect={handleSelect}
                  onValueChange={handleValueChange}
                  onContextMenu={handleContextMenu}
                  onPublish={onPublishPath}
                  isSelectingAccessPoint={isSelectingAccessPoint}
                  selectedAccessPath={selectedAccessPath}
                  onAddAccessPoint={onAddAccessPoint}
                  configuredAccess={configuredAccessMap.get(node.path) || null}
                  ancestorAccess={getAncestorAccess(node.path)}
                  pendingConfig={pendingConfig}
                  onPendingConfigChange={onPendingConfigChange}
                  onPendingConfigSave={onPendingConfigSave}
                />
              </div>
            )
          })}
        </div>
      </div>

      <ContextMenu
        state={contextMenu}
        onClose={closeContextMenu}
        onAction={handleMenuAction}
      />
    </div>
  )
}

export default TreeLineVirtualEditor

