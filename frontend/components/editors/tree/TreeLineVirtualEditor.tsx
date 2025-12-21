'use client'

import React, { useState, useCallback, useMemo, useRef, useEffect, CSSProperties } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ContextMenu, type ContextMenuState } from './components/ContextMenu'
import { NodeContextMenu } from './components/NodeContextMenu'
import { RightAccessControl } from './components/RightAccessControl'
import { ValueRenderer } from './components/ValueRenderer'

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
// Layout Constants (详见 LAYOUT.md)
// ============================================

// 元素尺寸
const ROW_HEIGHT = 28           // 每行最小高度
const ROOT_ICON_WIDTH = 18      // 根节点展开图标宽度
const BRANCH_WIDTH = 16         // ├─ 分支线水平宽度
const KEY_WIDTH = 64            // Key 名称固定宽度
const SEP_WIDTH = 8             // Key 后的 ── 分隔线宽度
const VALUE_GAP = 12            // Value 区域到下一层的视觉间距
const MENU_WIDTH = 22           // 悬浮菜单按钮宽度
const MENU_GAP = 4              // 菜单按钮与 Value 的间距
const LINE_END_GAP = 2          // 水平分支线末端与 Key 的间距
const LINE_COLOR = '#3a3f47'    // 连接线颜色

// 布局基准（所有位置都基于此计算，无负偏移）
const BASE_INDENT = ROOT_ICON_WIDTH / 2  // = 9px，根节点图标中心位置 = 子节点竖线位置

// 计算常量
const LEVEL_WIDTH = BRANCH_WIDTH + KEY_WIDTH + SEP_WIDTH + VALUE_GAP  // 每层缩进 = 100px

// ============================================
// Layout Helper Functions
// ============================================

/** 给定深度的竖线 X 坐标 */
const getVerticalLineX = (depth: number) => BASE_INDENT + depth * LEVEL_WIDTH

/** 根节点的内容起始位置（图标左边缘 = 0，中心 = BASE_INDENT） */
const getRootContentLeft = () => 0

/** 非根节点的内容区起始位置 */
const getContentLeft = (depth: number) => getVerticalLineX(depth) + BRANCH_WIDTH

/** 给定深度的 Value 起始位置 */
const getValueStart = (depth: number) => getContentLeft(depth) + KEY_WIDTH + SEP_WIDTH


// ============================================
// Utils
// ============================================

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
    left: left - MENU_WIDTH - MENU_GAP,  // 在 value 左侧
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
  const halfHeight = ROW_HEIGHT / 2  // 水平线的垂直位置
  const branchX = getVerticalLineX(depth)

  return (
    <svg 
      style={{ 
        position: 'absolute',
        left: 0,
        top: 0,
        width: branchX + BRANCH_WIDTH,
        height: '100%',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      preserveAspectRatio="none"
    >
      {/* 祖先竖线：parentLines[i]=true 表示 depth=i 的祖先还有后续兄弟 */}
      {parentLines.map((showLine, i) => {
        if (!showLine) return null
        const x = getVerticalLineX(i)
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
      
      {/* 当前节点的分支线 ├─ 或 └─ */}
      <line 
        x1={branchX} y1={0} 
        x2={branchX} y2={isLast ? halfHeight : '100%'} 
        stroke={LINE_COLOR} 
        strokeWidth={1} 
        vectorEffect="non-scaling-stroke"
      />
      <line 
        x1={branchX} y1={halfHeight} 
        x2={branchX + BRANCH_WIDTH - LINE_END_GAP} y2={halfHeight} 
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
  isSelectingAccessPoint?: boolean
  onAddAccessPoint?: (path: string, permissions: McpToolPermissions) => void
  configuredAccess?: McpToolPermissions | null
  onGutterClick?: (path: string, permissions: McpToolPermissions) => void
  onRemoveAccessPoint?: (path: string) => void
  lockedPopoverPath?: string | null
  onPopoverOpenChange?: (path: string | null) => void
  isContextMenuOpen?: boolean
}

const VirtualRow = React.memo(function VirtualRow({
  node,
  isSelected,
  onToggle,
  onSelect,
  onValueChange,
  onContextMenu,
  isSelectingAccessPoint,
  onAddAccessPoint,
  configuredAccess,
  onGutterClick,
  onRemoveAccessPoint,
  lockedPopoverPath,
  onPopoverOpenChange,
  isContextMenuOpen,
}: VirtualRowProps) {
  // 当前行是否是打开 popover 的行
  const isPopoverOwner = lockedPopoverPath === node.path
  const [hovered, setHovered] = useState(false)
  
  // Check if this node is already configured (for View Mode highlighting)
  const isConfigured = !!configuredAccess && Object.values(configuredAccess).some(Boolean)

  // 是否是根节点
  const isRootNode = node.key === '$root'
  
  // 内容区起始位置（详见 LAYOUT.md）
  const contentLeft = isRootNode ? getRootContentLeft() : getContentLeft(node.depth)

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
      style={{
        ...styles.row(isSelected, (hovered || isPopoverOwner) && !isSelectingAccessPoint),
        position: 'relative',
        display: 'flex',
        cursor: isSelectingAccessPoint ? 'pointer' : 'pointer',
      }}
      onClick={handleRowClick}
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
                // popover 打开时，背景更深
                ...(isPopoverOwner ? {
                  background: 'rgba(255, 167, 61, 0.18)',
                } : {}),
              } : {}),
            }}
          >
            <ValueRenderer
              value={node.value}
              isExpanded={node.isExpanded}
              isExpandable={node.isExpandable}
              isSelectingAccessPoint={isSelectingAccessPoint}
              onChange={(v) => onValueChange(node.path, v)}
              onToggle={() => onToggle(node.path)}
              onSelect={() => onSelect(node.path)}
            />
          </div>
        </div>
      
        {/* MCP 按钮容器 - position: relative 用于 popover 定位 */}
        <div style={{ position: 'relative' }}>
          <RightAccessControl
            path={node.path}
            configuredAccess={configuredAccess ?? null}
            isActive={(hovered || isPopoverOwner) && !isSelectingAccessPoint}
            onAccessChange={onGutterClick}
            onRemove={onRemoveAccessPoint}
            onPopoverOpenChange={(open) => {
              onPopoverOpenChange?.(open ? node.path : null)
            }}
          />
        </div>
      
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
    if (!anchorElement) return
    // 从按钮触发：使用 anchor element 以便滚动时更新位置
    const rect = anchorElement.getBoundingClientRect()
    setContextMenu({
      visible: true,
      x: rect.right,
      y: rect.bottom + 4,
      path,
      value,
      anchorElement,
      offsetX: rect.width,
      offsetY: rect.height + 4, 
      align: 'right',
    })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }, [])

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
                  isSelectingAccessPoint={isSelectingAccessPoint}
                  onAddAccessPoint={onAddAccessPoint}
                  configuredAccess={configuredAccessMap.get(node.path) || null}
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

      <NodeContextMenu
        state={contextMenu}
        json={json}
        projectId={projectId}
        tableId={tableId}
        onClose={closeContextMenu}
        onChange={onChange}
        onImportSuccess={onImportSuccess}
      />

    </div>
  )
}

export default TreeLineVirtualEditor

