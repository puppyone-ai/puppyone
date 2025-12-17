'use client'

import React, { useState, useCallback, useMemo, useRef, useEffect, CSSProperties, memo } from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import ReactMarkdown from 'react-markdown'
import { ContextMenu, type ContextMenuState } from './components/ContextMenu'
import { ImportModal } from './components/ImportModal'

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

// MCP 工具权限类型 - 对应后端 8 种工具
interface McpToolPermissions {
  get_data_schema?: boolean
  get_all_data?: boolean
  query_data?: boolean
  preview?: boolean
  select?: boolean
  create?: boolean
  update?: boolean
  delete?: boolean
}

// Access Point 类型，用于显示已配置的节点
interface ConfiguredAccessPoint {
  path: string
  permissions: McpToolPermissions
}

interface PendingConfig {
  path: string
  permissions: McpToolPermissions
}

interface TreeLineVirtualEditorProps {
  json: object
  onChange?: (json: object) => void
  onPathChange?: (path: string | null) => void
  onPublishPath?: (path: string) => void
  isSelectingAccessPoint?: boolean
  selectedAccessPath?: string | null
  onAddAccessPoint?: (path: string, permissions: McpToolPermissions) => void
  // 已配置的 Access Points，用于在 JSON Editor 中高亮显示
  configuredAccessPoints?: ConfiguredAccessPoint[]
  // Pending 配置 - 用于在节点旁边显示浮动配置面板
  pendingConfig?: PendingConfig | null
  onPendingConfigChange?: (config: PendingConfig | null) => void
  onPendingConfigSave?: () => void
  // 统一交互：右侧 Gutter 配置 Agent 权限
  onAccessPointChange?: (path: string, permissions: McpToolPermissions) => void
  onAccessPointRemove?: (path: string) => void
  // Import功能所需的项目和表格ID
  projectId?: number
  tableId?: number
  // 导入成功后的回调，用于刷新table数据
  onImportSuccess?: () => void
}

// ============================================
// Constants
// ============================================
const ROW_HEIGHT = 28
const BRANCH_WIDTH = 16     // ├─ 分支线宽度
const KEY_WIDTH = 64        // key 固定宽度
const SEP_WIDTH = 8         // ── 分隔线宽度
const MENU_WIDTH = 22       // 菜单按钮宽度 (absolute, 不占空间) - Increased to 22 to match text height
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
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
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
  scrollbarGutter: 'stable',  // 预留滚动条空间，避免切换时布局抖动
  paddingLeft: 24,
  paddingTop: 16,
  paddingRight: 8,
} as CSSProperties,

  row: (isSelected: boolean, isHovered: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'flex-start',  // 顶部对齐，支持多行内容
    minHeight: ROW_HEIGHT,
    paddingRight: 0,
    background: isSelected 
      ? 'rgba(255, 255, 255, 0.12)'  // 选中态更深
      : isHovered 
        ? 'rgba(255, 255, 255, 0.08)' // hover态明显提亮，确保视觉引导清晰
        : 'transparent',
    cursor: 'pointer',
    userSelect: 'none',
  }),

  // Notion 风格的菜单按钮 - absolute 定位，不占空间
  menuHandle: (visible: boolean, left: number, isHovered: boolean = false): CSSProperties => ({
    position: 'absolute',
    left: left - MENU_WIDTH - 4,  // 在 value 左侧
    top: 0, // 占满整行高度
    width: MENU_WIDTH,
    height: ROW_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // 默认 0.1，Hover 时 0.2，与右侧小爪子一致
    background: visible 
      ? (isHovered ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)')
      : 'transparent',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    opacity: visible ? 1 : 0,
    transition: 'opacity 0.12s, background 0.1s',
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
    fontSize: 14,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  } as CSSProperties,

  indexKey: {
    color: '#6b7280',  // 统一灰色
    fontWeight: 400,
    fontSize: 14,
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
  onContextMenu: (e: React.MouseEvent, path: string, value: JsonValue, anchorElement?: HTMLElement) => void
  onPublish?: (path: string) => void
  isSelectingAccessPoint?: boolean
  selectedAccessPath?: string | null
  onAddAccessPoint?: (path: string, permissions: McpToolPermissions) => void
  // 已配置的 Access Point（如果当前节点已配置）
  configuredAccess?: McpToolPermissions | null
  // 祖先 Access Point 信息（用于子孙节点的竖线和背景）
  ancestorAccess?: { 
    permissions: McpToolPermissions
    depth: number  // 祖先节点的 depth，用于计算竖线位置
  } | null
  // Pending 配置面板
  pendingConfig?: PendingConfig | null
  onPendingConfigChange?: (config: PendingConfig | null) => void
  onPendingConfigSave?: () => void
  // 右侧 Gutter 点击事件 - 用于配置 Agent 权限
  onGutterClick?: (path: string, permissions: McpToolPermissions) => void
  // 删除 Access Point
  onRemoveAccessPoint?: (path: string) => void
  // 锁定状态 - 当某个 popover 打开时，其他行不响应 hover
  lockedPopoverPath?: string | null
  onPopoverOpenChange?: (path: string | null) => void
  // Context Menu 是否在当前行打开
  isContextMenuOpen?: boolean
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
  onGutterClick,
  onRemoveAccessPoint,
  lockedPopoverPath,
  onPopoverOpenChange,
  isContextMenuOpen,
}: VirtualRowProps) {
  // 是否被锁定（其他行的 popover 打开了）
  const isLockedByOther = lockedPopoverPath !== null && lockedPopoverPath !== node.path
  // 当前行是否是打开 popover 的行
  const isPopoverOwner = lockedPopoverPath === node.path
  const [hovered, setHovered] = useState(false)
  const [gutterHovered, setGutterHovered] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null)
  // 使用 isPopoverOwner 作为初始值，确保组件重新挂载时能恢复 popover 状态
  const [showGutterPopover, setShowGutterPopover] = useState(isPopoverOwner)
  const [gutterPopoverPosition, setGutterPopoverPosition] = useState<{ top: number; left: number } | null>(null)
  
  // 同步 showGutterPopover 和 isPopoverOwner 状态
  // 当父组件的 lockedPopoverPath 改变时，同步本地状态
  useEffect(() => {
    setShowGutterPopover(isPopoverOwner)
  }, [isPopoverOwner])
  
  // Gutter Popover 位置计算 + 滚动监听（实时更新位置）
  useEffect(() => {
    if (!showGutterPopover || !gutterRef.current) {
      setGutterPopoverPosition(null)
      return
    }
    
    const updatePosition = () => {
      if (!gutterRef.current) return
      const rect = gutterRef.current.getBoundingClientRect()
      // 我们现在使用固定定位 + transform 来实现右边缘对齐
      // 所以这里只需要记录按钮的左上角位置即可
      setGutterPopoverPosition({
        top: rect.top,
        left: rect.left,
      })
    }
    
    // 初始位置
    updatePosition()
    
    // 监听滚动事件（捕获阶段，以便捕获所有滚动）
    const handleScroll = () => {
      requestAnimationFrame(updatePosition)
    }
    
    // 监听 window 和所有可能的滚动容器
    window.addEventListener('scroll', handleScroll, true) // true 表示捕获阶段
    window.addEventListener('resize', handleScroll)
    
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [showGutterPopover])
  
  // Check if this node is the currently selected access point
  const isAccessSelected = isSelectingAccessPoint && selectedAccessPath === node.path
  // Check if this node is already configured (for View Mode highlighting)
  const isConfigured = !!configuredAccess && Object.values(configuredAccess).some(Boolean)
  // Check if this node is a descendant of an access point (不再使用，但保留变量以避免其他地方报错)
  const isDescendant = !!ancestorAccess && !isConfigured
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  
  // Check if this node has a pending config panel
  const isPendingNode = pendingConfig?.path === node.path
  
  // 点击外部关闭 Gutter Popover
  useEffect(() => {
    if (!showGutterPopover) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      // 检查点击是否在 gutter 按钮或 popover 内部
      const isInGutter = gutterRef.current?.contains(target)
      const isInPopover = popoverRef.current?.contains(target)
      if (!isInGutter && !isInPopover) {
        setShowGutterPopover(false)
        onPopoverOpenChange?.(null) // 解除锁定
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showGutterPopover, onPopoverOpenChange])
  
  // 当组件卸载时，如果它是 popover 的 owner，则解除锁定
  useEffect(() => {
    return () => {
      // 只有当这个组件是 popover owner 时才清除锁定
      if (isPopoverOwner) {
        onPopoverOpenChange?.(null)
      }
    }
  }, [isPopoverOwner, onPopoverOpenChange])
  
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
              fontSize: 14,
              lineHeight: 1.5,
              padding: '3.5px 0', // 用户反馈水平边界 mismatch，原为 '3.5px 4px'，改为 0 以对齐父容器边缘
              margin: '0',        // 原为 '0 -4px'，现改为 0 避免溢出
              borderRadius: 3,
              outline: 'none',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              cursor: isSelectingAccessPoint ? 'pointer' : 'text',
              transition: 'background 0.15s',
              pointerEvents: isSelectingAccessPoint ? 'none' : 'auto',
            }}
            onFocus={(e) => {
              // 聚焦时不再需要背景色扩展，因为父容器已有 padding
              e.currentTarget.style.background = 'transparent' 
            }}
            onMouseEnter={(e) => {
              if (document.activeElement !== e.currentTarget) {
                // hover 效果由父容器控制，这里透明
                e.currentTarget.style.background = 'transparent'
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
    
    // 状态：图标是否 hover
    const [iconHovered, setIconHovered] = useState(false)
    
    return (
      <span
        onClick={isSelectingAccessPoint ? undefined : (e) => { e.stopPropagation(); onToggle(node.path) }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          cursor: isSelectingAccessPoint ? 'pointer' : 'pointer',
          fontFamily: 'inherit',
          pointerEvents: isSelectingAccessPoint ? 'none' : 'auto',
          userSelect: 'none',
          padding: '2px 0',
        }}
      >
        {/* 核心视觉：收起时为极简原点，展开时显示详细类型图标 */}
        {/* 在 hover 时显示加号/减号，否则显示原本的类型图标 */}
        <div 
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: -6 }}
          onMouseEnter={() => setIconHovered(true)}
          onMouseLeave={() => setIconHovered(false)}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: isArr ? '#fbbf24' : '#34d399' }}>
            {iconHovered ? (
              // Hover 状态：显示折线三角暗示 (展开/收起)
              node.isExpanded ? (
                // 已展开 (三角朝下 ▼)
                <path d="M5 7L9 12L13 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                // 已收起 (三角朝右 ▶)
                <path d="M7 5L12 9L7 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              )
            ) : (
              // 正常状态：显示类型图标
              isArr ? (
                !node.isExpanded ? (
                  // Array 收起：实心方块
                  <rect x="5" y="5" width="8" height="8" rx="1" fill="currentColor" />
                ) : (
                  // Array 展开：三条横线
                  <>
                    <path d="M3 4h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 9h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3 14h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </>
                )
              ) : (
                !node.isExpanded ? (
                  // Object 收起：实心六边形
                  <path d="M9 4L13.33 6.5V11.5L9 14L4.67 11.5V6.5L9 4Z" fill="currentColor" />
                ) : (
                  // Object 展开：立方体
                  <>
                    <path 
                      d="M9 1.5L15.5 5.25V12.75L9 16.5L2.5 12.75V5.25L9 1.5Z" 
                      stroke="currentColor" 
                      strokeWidth="1.5" 
                      strokeLinejoin="round"
                    />
                    <path 
                      d="M9 16V9M9 9L15.5 5.25M9 9L2.5 5.25" 
                      stroke="currentColor" 
                      strokeLinecap="round"
                    />
                  </>
                )
              )
            )}
          </svg>
          <span style={{ 
            fontSize: 10,
            fontWeight: 700,
            color: '#000000', // 亮灰色文字 (可读但不刺眼)
            background: '#4b5563', // 深灰实心气泡
            padding: '0 4px',
            borderRadius: 99,
            fontFamily: "'JetBrains Mono', monospace",
            marginLeft: 4,
            height: 14,
            minWidth: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>{count}</span>
        </div>
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
    const anchor = e.currentTarget as HTMLElement
    const rect = anchor.getBoundingClientRect()
    onContextMenu(
      { clientX: rect.left - 164, clientY: rect.top } as React.MouseEvent,
      node.path,
      node.value,
      anchor  // 传递 anchor element 用于滚动时更新位置
    )
  }, [node.path, node.value, onContextMenu])

  // Handle click - in selection mode, directly trigger onAddAccessPoint
  const handleRowClick = useCallback(() => {
    if (isSelectingAccessPoint) {
      onAddAccessPoint?.(node.path, { query_data: true })
    } else {
      onSelect(node.path)
    }
  }, [isSelectingAccessPoint, node.path, onSelect, onAddAccessPoint])

  return (
    <div
      ref={rowRef}
      style={{
        ...styles.row(isSelected, (hovered || isPopoverOwner) && !isSelectingAccessPoint),
        position: 'relative',
        display: 'flex',
        cursor: isSelectingAccessPoint ? 'pointer' : 'pointer',
      }}
      onClick={handleRowClick}
      onDoubleClick={isSelectingAccessPoint ? undefined : handleDoubleClick}
      onContextMenu={isSelectingAccessPoint ? undefined : handleContextMenu}
      onMouseEnter={() => setHovered(true)} // 移除 !isLockedByOther 限制
      onMouseLeave={() => setHovered(false)} // 移除 !isLockedByOther 限制
    >
        {/* 连接线（根节点不显示） */}
        {!isRootNode && (
          <LevelConnector 
            depth={node.depth} 
            isLast={node.isLast} 
            parentLines={node.parentLines} 
          />
        )}
        
        {/* 子孙节点的背景高亮已移除 - 只在配置节点上显示小狗爪子图标 */}
        
        {/* 菜单按钮 */}
        <button
          className="menu-handle-btn" // 添加 class 方便 hover 状态管理（或者直接在这里使用 state）
          style={styles.menuHandle(hovered || !!isContextMenuOpen, isRootNode ? contentLeft : (contentLeft + KEY_WIDTH + SEP_WIDTH))}
          // 我们需要在这个元素上 track hover 状态来改变它的背景色
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
            setHovered(true) // 移除 !isLockedByOther 限制
          }}
          onMouseLeave={(e) => {
            // 恢复默认背景色 (如果是可见状态)
            const isVisible = hovered || !!isContextMenuOpen
            e.currentTarget.style.background = isVisible ? 'rgba(255,255,255,0.1)' : 'transparent'
            setHovered(false) // 移除 !isLockedByOther 限制
          }}
          onClick={handleMenuClick}
          title="Actions Menu"
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
        
        {/* 内容区域 - 占满剩余宽度 */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'flex-start',
          marginLeft: contentLeft,
          paddingTop: 0,
          paddingRight: 0, // 移除右侧内边距，因为没有负 margin 了
          flex: 1,
        }}>
          {/* Key + 分隔线（根节点不显示） */}
          {!isRootNode && (
            <div style={{
              width: KEY_WIDTH + SEP_WIDTH,
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
              height: ROW_HEIGHT, // 28px，与行高一致，确保与左侧线条对齐
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
              padding: '0 8px',
              minHeight: 28,
              margin: '0', // 移除负 margin
              transition: 'all 0.12s',
              // 未配置时：popover 打开后显示橙色背景
              ...(isPopoverOwner && !isConfigured ? {
                background: 'rgba(255, 167, 61, 0.12)',
              } : {}),
              // 已配置节点：始终显示橙色背景
              ...(isConfigured ? {
                background: 'rgba(255, 167, 61, 0.1)',
                // hover 到爪子或 popover 打开时，背景更深
                ...((gutterHovered || isPopoverOwner) ? {
                  background: 'rgba(255, 167, 61, 0.18)',
                } : {}),
              } : {}),
            }}
          >
            {node.isExpandable ? renderExpandableValue() : renderPrimitiveValue()}
          </div>
        </div>
      
      {/* MCP 按钮容器 - position: relative 用于 popover 定位 */}
      <div style={{ position: 'relative' }}>
        {/* MCP 按钮 - 小狗爪子图标 + 右侧数字 */}
        <div
          ref={gutterRef}
          style={{
            marginLeft: 8, // 与左侧内容保持间距
            marginRight: 0, // 压缩右侧间距
            width: 28, // 固定宽度 28
            height: 28, // 固定高度 28，形成正方形
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center', // 内容居中
            borderRadius: 4,
            cursor: 'pointer',
            transition: 'all 0.12s',
            position: 'relative', // 用于定位角标
            // 只在 hover 或配置时显示，子节点不显示
            opacity: isConfigured || hovered || isPopoverOwner ? 1 : 0,
            // 默认带背景色（像左侧操作菜单按钮一样），hover/active 时更亮
            background: (gutterHovered || isPopoverOwner) 
              ? 'rgba(255, 255, 255, 0.2)'  // hover时更亮
              : 'rgba(255, 255, 255, 0.1)', // 默认态提高亮度，与左侧 menuHandle 一致
          }}
          onMouseEnter={() => setGutterHovered(true)} // 移除 !isLockedByOther 限制
          onMouseLeave={() => setGutterHovered(false)} // 移除 !isLockedByOther 限制
          onClick={(e) => {
            e.stopPropagation()
            const newState = !showGutterPopover
            setShowGutterPopover(newState)
            onPopoverOpenChange?.(newState ? node.path : null)
          }}
          title="Configure MCP Tool Permissions"
        >
          {/* 小狗爪子图标 - 使用用户提供的 SVG */}
          <svg 
            width="15" 
            height="12" 
            viewBox="0 0 33 26" 
            fill="none"
            style={{ 
              color: isConfigured ? '#FFA73D' : (gutterHovered || isPopoverOwner) ? '#e2e8f0' : '#6b7280',
              transition: 'color 0.12s',
            }}
          >
            <ellipse cx="27.9463" cy="11.0849" rx="3.45608" ry="4.0321" transform="rotate(14 27.9463 11.0849)" fill="currentColor"/>
            <ellipse cx="11.5129" cy="4.75922" rx="3.45608" ry="4.3201" transform="rotate(-8 11.5129 4.75922)" fill="currentColor"/>
            <ellipse cx="20.7294" cy="4.7593" rx="3.45608" ry="4.3201" transform="rotate(8 20.7294 4.7593)" fill="currentColor"/>
            <ellipse cx="4.32887" cy="11.0848" rx="3.45608" ry="4.0321" transform="rotate(-14 4.32887 11.0848)" fill="currentColor"/>
            <path d="M15.4431 11.5849C15.9709 11.499 16.0109 11.4991 16.5387 11.585C17.4828 11.7388 17.9619 12.099 18.7308 12.656C20.3528 13.8309 20.0223 15.0304 21.4709 16.4048C22.2387 17.1332 23.2473 17.7479 23.9376 18.547C24.7716 19.5125 25.1949 20.2337 25.3076 21.4924C25.4028 22.5548 25.3449 23.2701 24.7596 24.1701C24.1857 25.0527 23.5885 25.4635 22.5675 25.7768C21.6486 26.0587 21.0619 25.8454 20.1014 25.7768C18.4688 25.66 17.6279 24.9515 15.9912 24.9734C14.4592 24.994 13.682 25.655 12.155 25.7768C11.1951 25.8533 10.6077 26.0587 9.68884 25.7768C8.66788 25.4635 8.07066 25.0527 7.49673 24.1701C6.91143 23.2701 6.85388 22.5546 6.94907 21.4922C7.06185 20.2335 7.57596 19.5812 8.31877 18.547C9.01428 17.5786 9.71266 17.2943 10.5109 16.4048C11.7247 15.0521 11.7621 13.7142 13.251 12.656C14.0251 12.1059 14.499 11.7387 15.4431 11.5849Z" fill="currentColor"/>
          </svg>
          
          {/* 已配置时：右侧纯数字（木已成舟感） */}
          {isConfigured && (
            <span style={{
              position: 'absolute',
              top: '50%',
              right: -10, // 移出按钮区域
              transform: 'translateY(-50%)', // 垂直居中
              fontSize: 11,
              fontWeight: 600,
              color: '#FFA73D',
              pointerEvents: 'none',
              fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
            }}>{Object.values(configuredAccess || {}).filter(Boolean).length}</span>
          )}
        </div>
        
        {/* Gutter Popover - MCP 工具配置面板 (使用 createPortal + 滚动监听) */}
        {showGutterPopover && gutterPopoverPosition && typeof document !== 'undefined' && createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              top: gutterPopoverPosition.top + 28 + 4, // 按钮高度(28) + 间隙(4) -> 出现在正下方
              left: gutterPopoverPosition.left + 28, // 按钮宽度(28) -> 这是一个基准点
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
          {/* Header - "Agent is allowed to" */}
          <div style={{ 
            padding: '8px 12px 4px',
          }}>
            <div style={{ 
              fontSize: 10, 
              color: '#6b7280', 
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: 2,
            }}>Agent is allowed to</div>
          </div>
          
          {/* 6 种 MCP 工具 - 按后端定义，使用 SVG 图标 */}
          {[
            { 
              id: 'query', 
              label: 'Query', 
              icon: (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              )
            },
            { 
              id: 'preview', 
              label: 'Preview', 
              icon: (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
                </svg>
              )
            },
            { 
              id: 'select', 
              label: 'Select', 
              icon: (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M4 7l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )
            },
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
          ].map(tool => {
            const isEnabled = (configuredAccess as any)?.[tool.id] || false
            return (
              <button
                key={tool.id}
                onClick={(e) => {
                  e.stopPropagation()
                  const currentTools = configuredAccess || {}
                  const newPermissions = {
                    ...currentTools,
                    [tool.id]: !isEnabled,
                  }
                  if (onGutterClick) {
                    onGutterClick(node.path, newPermissions as McpToolPermissions)
                  }
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
                {/* 左侧图标 */}
                <span style={{ 
                  width: 16, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  opacity: isEnabled ? 1 : 0.6,
                  color: isEnabled ? '#FFA73D' : 'inherit',
                }}>{tool.icon}</span>
                
                {/* 工具名称 */}
                <span style={{ flex: 1 }}>{tool.label}</span>
                
                {/* 右侧勾选框 */}
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

          {/* 删除按钮（仅当已配置时显示） */}
          {isConfigured && (
            <>
              <div style={{ height: 1, background: '#333', margin: '4px 0' }} />
              <button
                onClick={() => {
                  onRemoveAccessPoint?.(node.path)
                  setShowGutterPopover(false)
                  onPopoverOpenChange?.(null) // 解除锁定
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
          
          {/* JSON Path 显示 */}
          <div style={{ 
            padding: '4px 12px 8px',
          }}>
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4 }}>Path</div>
            <code style={{ 
              fontSize: 11, 
              color: '#94a3b8',
              wordBreak: 'break-all',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            }}>{node.path || '/'}</code>
          </div>
        </div>,
        document.body
      )}
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
          {/* MCP 工具列表 */}
          <div style={{ padding: '4px 0' }}>
            {[
              { id: 'query', label: 'Query', icon: '🔍' },
              { id: 'preview', label: 'Preview', icon: '👁' },
              { id: 'select', label: 'Select', icon: '☑' },
              { id: 'create', label: 'Create', icon: '➕' },
              { id: 'update', label: 'Update', icon: '✏' },
              { id: 'delete', label: 'Delete', icon: '🗑' },
            ].map(tool => (
              <label 
                key={tool.id}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 6,
                  padding: '5px 10px',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <input
                  type="checkbox"
                  checked={(pendingConfig.permissions as any)[tool.id] || false}
                  onChange={() => onPendingConfigChange({
                    ...pendingConfig,
                    permissions: { ...pendingConfig.permissions, [tool.id]: !(pendingConfig.permissions as any)[tool.id] }
                  })}
                  style={{ width: 12, height: 12, accentColor: '#34d399' }}
                />
                <span style={{ fontSize: 11, width: 14 }}>{tool.icon}</span>
                <span style={{ fontSize: 10, color: '#e2e8f0' }}>{tool.label}</span>
              </label>
            ))}
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
                const hasAnyTool = Object.values(pendingConfig.permissions).some(Boolean)
                if (hasAnyTool) {
                  onPendingConfigSave?.()
                }
              }} 
              style={{ 
                flex: 1, 
                height: 26, 
                background: Object.values(pendingConfig.permissions).some(Boolean) ? '#34d399' : 'rgba(52, 211, 153, 0.3)', 
                border: 'none', 
                borderRadius: 4, 
                color: Object.values(pendingConfig.permissions).some(Boolean) ? '#000' : '#525252', 
                fontSize: 10, 
                fontWeight: 600, 
                cursor: Object.values(pendingConfig.permissions).some(Boolean) ? 'pointer' : 'not-allowed',
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
  onAccessPointChange,
  onAccessPointRemove,
  projectId,
  tableId,
  onImportSuccess,
}: TreeLineVirtualEditorProps) {
  // 创建 path -> permissions 的快速查找表
  const configuredAccessMap = useMemo(() => {
    const map = new Map<string, McpToolPermissions>()
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
  
  // Import Modal状态
  const [showImportModal, setShowImportModal] = useState(false)
  const [importTargetPath, setImportTargetPath] = useState<string>('')
  const [importTargetValue, setImportTargetValue] = useState<any>(null)
  
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
  
  // 当前打开 MCP Popover 的节点路径（用于锁定 hover 状态）
  const [lockedPopoverPath, setLockedPopoverPath] = useState<string | null>(null)

  // 扁平化节点列表
  const flatNodes = useMemo(() => {
    return flattenJson(json, expandedPaths)
  }, [json, expandedPaths])

  // 创建祖先 access point 查找函数
  const getAncestorAccess = useMemo(() => {
    // 建立 path -> depth 的映射
    const pathToDepth = new Map<string, number>()
    flatNodes.forEach(node => pathToDepth.set(node.path, node.depth))
    
    return (nodePath: string): { permissions: McpToolPermissions; depth: number } | null => {
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

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, value: JsonValue, anchorElement?: HTMLElement) => {
    if (anchorElement) {
      // 从按钮触发：使用 anchor element 以便滚动时更新位置
      const rect = anchorElement.getBoundingClientRect()
      setContextMenu({
        visible: true,
        x: rect.right,  // 基准点设为 Handle 右边缘
        y: rect.bottom + 4, // Handle 正下方
        path,
        value,
        anchorElement,
        offsetX: rect.width, // X 轴偏移量 = Handle 宽度 (让基准点移动到 Handle 右侧)
        offsetY: rect.height + 4, 
        align: 'right', // 启用右对齐模式 -> 菜单向左延伸
      })
    } else {
      // 右键菜单触发：使用鼠标位置
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        path,
        value,
      })
    }
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

  const handleMenuAction = useCallback((action: string, payload?: any) => {
    const { path, value } = contextMenu

    // Handle copy-path separately (doesn't need onChange)
    if (action === 'copy-path') {
      const displayPath = path || '/' // 根节点显示为 '/'
      navigator.clipboard.writeText(displayPath).then(() => {
        console.log('Path copied to clipboard:', displayPath)
      }).catch(err => {
        console.error('Failed to copy path:', err)
      })
      closeContextMenu()
      return
    }

    // Handle upload separately (doesn't need onChange for now)
    if (action === 'upload') {
      console.log('Upload action for path:', path)
      // TODO: Implement upload functionality
      closeContextMenu()
      return
    }

    // Handle import-from-url
    if (action === 'import-from-url') {
      if (!projectId || !tableId) {
        console.error('Cannot import: projectId or tableId is missing')
        closeContextMenu()
        return
      }
      setImportTargetPath(path)
      setImportTargetValue(value)
      setShowImportModal(true)
      closeContextMenu()
      return
    }

    if (!onChange) return

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
  
  // 当菜单打开时禁用滚动
  const isMenuOpen = contextMenu.visible || lockedPopoverPath !== null

  return (
    <div style={styles.container}>
      <div ref={scrollRef} style={{
        ...styles.scrollContainer,
        overflow: isMenuOpen ? 'hidden' : 'auto',
      }}>
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
                  onGutterClick={onAccessPointChange}
                  onRemoveAccessPoint={onAccessPointRemove}
                  lockedPopoverPath={lockedPopoverPath}
                  onPopoverOpenChange={setLockedPopoverPath}
                  isContextMenuOpen={contextMenu.visible && contextMenu.path === node.path}
                />
              </div>
            )
          })}
        </div>
      </div>

      <ContextMenu
        key={contextMenu.path} // 添加 key 以强制重新挂载，避免切换时的状态残留和跳跃
        state={contextMenu}
        onClose={closeContextMenu}
        onAction={handleMenuAction}
      />

      {/* Import Modal */}
      {showImportModal && projectId && tableId && (
        <ImportModal
          visible={showImportModal}
          targetPath={importTargetPath}
          currentValue={importTargetValue}
          tableId={tableId}
          projectId={projectId}
          mode="import_to_table"
          onClose={() => setShowImportModal(false)}
          onSuccess={() => {
            setShowImportModal(false)
            onImportSuccess?.()
          }}
        />
      )}
    </div>
  )
}

export default TreeLineVirtualEditor

