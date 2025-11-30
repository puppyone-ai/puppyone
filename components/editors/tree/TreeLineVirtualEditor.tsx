'use client'

import React, { useState, useCallback, useMemo, useRef, useEffect, CSSProperties, memo } from 'react'
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

interface TreeLineVirtualEditorProps {
  json: object
  onChange?: (json: object) => void
  onPathChange?: (path: string | null) => void
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

// 扁平化 JSON 树
function flattenJson(
  json: any,
  expandedPaths: Set<string>,
  path = '',
  depth = 0,
  parentLines: boolean[] = []
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
    
    // 只有展开时才递归添加子节点
    if (isExpandable && isExpanded) {
      const childParentLines = [...parentLines, !isLast]
      result.push(...flattenJson(value, expandedPaths, nodePath, depth + 1, childParentLines))
    }
  })
  
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
    background: '#0a0a0c',
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
    flexShrink: 0,
  } as CSSProperties,

  indexKey: {
    color: '#6b7280',  // 统一灰色
    fontWeight: 400,
    fontSize: 12,
    flexShrink: 0,
  } as CSSProperties,

  separator: {
    flex: 1,
    height: 1,
    background: 'linear-gradient(to right, #2d3139 0%, transparent 100%)',
    margin: '0 10px',
    minWidth: 20,
    maxWidth: 120,
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
// 连接线组件 - 优化版：减少不必要的计算
const LevelConnector = React.memo(function LevelConnector({ 
  depth, 
  isLast, 
  parentLines 
}: { 
  depth: number
  isLast: boolean 
  parentLines: boolean[]
}) {
  const hh = ROW_HEIGHT / 2
  const branchX = 8 + depth * LEVEL_WIDTH

  return (
    <svg 
      style={{ 
        position: 'absolute',
        left: 0,
        top: 0,
        width: branchX + BRANCH_WIDTH,
        height: ROW_HEIGHT,
        pointerEvents: 'none',
      }}
    >
      {/* 父级竖线：parentLines[i]=true → depth=i 的祖先不是最后一个，画竖线延伸 */}
      {parentLines.map((showLine, i) => {
        if (!showLine) return null
        // 竖线位置 = depth=i 祖先的分支线位置
        const x = 8 + i * LEVEL_WIDTH
        return (
          <line 
            key={i}
            x1={x} y1={0} 
            x2={x} y2={ROW_HEIGHT} 
            stroke={LINE_COLOR} 
            strokeWidth={1} 
          />
        )
      })}
      
      {/* 当前节点的 ├─ 或 └─ */}
      <line 
        x1={branchX} y1={0} 
        x2={branchX} y2={isLast ? hh : ROW_HEIGHT} 
        stroke={LINE_COLOR} 
        strokeWidth={1} 
      />
      <line 
        x1={branchX} y1={hh} 
        x2={branchX + BRANCH_WIDTH - 2} y2={hh} 
        stroke={LINE_COLOR} 
        strokeWidth={1} 
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
}: VirtualRowProps) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  
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
            contentEditable
            suppressContentEditableWarning
            onBlur={handleContentEditableBlur}
            onKeyDown={handleContentEditableKeyDown}
            onClick={(e) => handleEditClick(e, () => onSelect(node.path))}
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
              cursor: 'text',
              transition: 'background 0.15s',
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
          {isLong && !expanded && (
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
          {isLong && expanded && (
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
        contentEditable
        suppressContentEditableWarning
        onBlur={handleContentEditableBlur}
        onKeyDown={handleContentEditableKeyDown}
        onClick={(e) => handleEditClick(e, () => onSelect(node.path))}
        style={{
          color: typeInfo.color,
          padding: '2px 4px',
          margin: '-2px -4px',
          borderRadius: 3,
          outline: 'none',
          cursor: 'text',
          transition: 'background 0.15s',
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
        onClick={(e) => { e.stopPropagation(); onToggle(node.path) }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          fontSize: 13,
          fontFamily: 'inherit',
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

  // 计算当前节点的内容起始位置
  const contentLeft = 8 + node.depth * LEVEL_WIDTH + BRANCH_WIDTH

  // 点击菜单按钮 - 直接调用父组件的 onContextMenu
  const handleMenuClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // 菜单弹出在按钮左侧，菜单右边缘对齐按钮左边缘
    // 菜单 minWidth=160，所以 x = rect.left - 160 - 4
    onContextMenu(
      { clientX: rect.left - 164, clientY: rect.top } as React.MouseEvent,
      node.path,
      node.value
    )
  }, [node.path, node.value, onContextMenu])

  return (
    <div
      style={{
        ...styles.row(isSelected, hovered),
        position: 'relative',
      }}
      onClick={() => onSelect(node.path)}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 连接线 (绝对定位) */}
      <LevelConnector 
        depth={node.depth} 
        isLast={node.isLast} 
        parentLines={node.parentLines} 
      />
      
      {/* Notion 风格菜单按钮 - absolute, hover 时显示 */}
      <button
        style={styles.menuHandle(hovered, contentLeft + KEY_WIDTH + SEP_WIDTH)}
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
      
      {/* 内容区域: [key ────] [value] */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'flex-start',  // 顶部对齐
        marginLeft: contentLeft,
        paddingTop: 4,  // 与行高对齐
      }}>
        {/* Key + 分隔线容器 */}
        <div style={{
          width: KEY_WIDTH + SEP_WIDTH,  // 64px
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          height: 20,
        }}>
          {/* Key */}
          <span style={{
            flexShrink: 0,
            whiteSpace: 'nowrap',
            ...(typeof node.key === 'number' ? styles.indexKey : styles.keyName),
          }}>
            {node.key}
          </span>
          
          {/* 分隔线 ── 填充剩余空间 */}
          <span style={{
            flex: 1,
            height: 1,
            background: LINE_COLOR,
            marginLeft: 6,
            minWidth: 12,
          }} />
        </div>
        
      {/* Value */}
        {node.isExpandable ? renderExpandableValue() : renderPrimitiveValue()}
      </div>
    </div>
  )
})

// ============================================
// Main Component
// ============================================
export function TreeLineVirtualEditor({ json, onChange, onPathChange }: TreeLineVirtualEditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    path: '',
    value: null,
  })
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    // 默认展开前两层
    const paths = new Set<string>()
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

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.rootLabel}>{isArray ? 'Array' : 'Object'}</span>
          <span style={{ fontSize: 11, color: '#555' }}>
            ({flatNodes.length} visible)
          </span>
        </div>
        <span style={styles.stats}>
          ⚡ Virtual · {totalNodes.toLocaleString()} total nodes
        </span>
      </div>

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
                key={node.path}
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

