import React, { useState, useRef, useEffect, useCallback } from 'react'

// ============================================
// 布局常量（与 TreeLineVirtualEditor 保持一致）
// ============================================
const ROOT_ICON_WIDTH = 18
const BRANCH_WIDTH = 16
const KEY_WIDTH = 64
const SEP_WIDTH = 8
const VALUE_GAP = 12

const BASE_INDENT = ROOT_ICON_WIDTH / 2
const DEFAULT_KEY_WIDTH = KEY_WIDTH
const MIN_KEY_WIDTH = KEY_WIDTH
const MAX_KEY_WIDTH = 200

/** 计算一层的总宽度 */
const getLevelIndent = (keyWidth: number) => BRANCH_WIDTH + keyWidth + SEP_WIDTH + VALUE_GAP

// ============================================
// Depth Resize Bar Component
// 顶部可拖拽调整层级 key 宽度
// 默认隐藏，hover 时显示
// ============================================
export interface DepthResizeBarProps {
  keyWidths: number[]
  maxDepth: number
  onKeyWidthChange: (depth: number, newKeyWidth: number) => void
}

export const DepthResizeBar = React.memo(function DepthResizeBar({
  keyWidths,
  maxDepth,
  onKeyWidthChange,
}: DepthResizeBarProps) {
  const [draggingDepth, setDraggingDepth] = useState<number | null>(null)
  const [hoveredDepth, setHoveredDepth] = useState<number | null>(null)
  const [isBarHovered, setIsBarHovered] = useState(false)
  const dragStartX = useRef(0)
  const dragStartKeyWidth = useRef(0)

  // 计算每个深度的 X 位置
  const getDepthX = useCallback((depth: number) => {
    let x = BASE_INDENT
    for (let i = 0; i < depth; i++) {
      const kw = keyWidths[i] ?? DEFAULT_KEY_WIDTH
      x += getLevelIndent(kw)
    }
    return x
  }, [keyWidths])

  // 处理拖拽
  useEffect(() => {
    if (draggingDepth === null || draggingDepth === 0) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX.current
      const newKeyWidth = Math.max(MIN_KEY_WIDTH, Math.min(MAX_KEY_WIDTH, dragStartKeyWidth.current + deltaX))
      onKeyWidthChange(draggingDepth - 1, newKeyWidth)
    }

    const handleMouseUp = () => {
      setDraggingDepth(null)
      setHoveredDepth(null)
      setIsBarHovered(false)  // 拖拽结束后重置 hover 状态
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [draggingDepth, onKeyWidthChange])

  // 拖拽 depth N 的线，实际改变的是 keyWidths[N-1]
  const handleMouseDown = useCallback((e: React.MouseEvent, depth: number) => {
    if (depth === 0) return
    e.preventDefault()
    e.stopPropagation()
    setDraggingDepth(depth)
    dragStartX.current = e.clientX
    dragStartKeyWidth.current = keyWidths[depth - 1] ?? DEFAULT_KEY_WIDTH
  }, [keyWidths])

  // 是否显示分隔线（hover 或正在拖拽时显示）
  const isVisible = isBarHovered || draggingDepth !== null
  
  // 计算实际要渲染的把手数量（确保至少为 0）
  const handleCount = Math.max(0, maxDepth + 2)

  return (
    <div
      style={{
        position: 'relative',
        height: 20,  // 增加触发区域高度
        marginLeft: 24,
        marginRight: 8,
        borderBottom: `1px solid ${isVisible ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.04)'}`,
        transition: 'border-color 0.15s ease',
      }}
      onMouseEnter={() => setIsBarHovered(true)}
      onMouseLeave={() => !draggingDepth && setIsBarHovered(false)}
    >
      {/* 渲染每个深度的小方块把手 */}
      {/* 需要渲染到 maxDepth + 2，因为 depth N 的把手控制 keyWidths[N-1] */}
      {/* 所以要调整 keyWidths[maxDepth]，需要 depth maxDepth + 1 的把手 */}
      {Array.from({ length: handleCount }, (_, depth) => {
        const x = getDepthX(depth)
        const isActive = draggingDepth === depth || hoveredDepth === depth
        const canDrag = depth > 0

        // 只显示可拖拽的把手（depth > 0）
        if (!canDrag) return null

        return (
          <div
            key={depth}
            style={{
              position: 'absolute',
              left: x - 6,
              bottom: -5,  // 放在横线上
              width: 12,
              height: 10,
              cursor: 'col-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: isActive ? 10 : 1,
              // 默认隐藏，hover 时显示
              opacity: isVisible ? 1 : 0,
              transition: 'opacity 0.15s ease',
            }}
            onMouseEnter={() => setHoveredDepth(depth)}
            onMouseLeave={() => setHoveredDepth(null)}
            onMouseDown={(e) => handleMouseDown(e, depth)}
          >
            {/* 小方块把手 */}
            <div
              style={{
                width: isActive ? 10 : 8,
                height: isActive ? 10 : 8,
                background: isActive ? '#60a5fa' : '#4b5563',
                borderRadius: 2,
                transition: 'all 0.1s',
                boxShadow: isActive ? '0 0 6px rgba(96, 165, 250, 0.5)' : 'none',
              }}
            />
          </div>
        )
      })}
    </div>
  )
})

