import React, { useState, useRef, useEffect, useCallback } from 'react';

// ============================================
// 布局常量（与 TreeLineVirtualEditor 保持一致）
// ============================================
const ROOT_ICON_WIDTH = 18;
const BRANCH_WIDTH = 16;
const KEY_WIDTH = 64;
const SEP_WIDTH = 8;
const VALUE_GAP = 12;

const BASE_INDENT = ROOT_ICON_WIDTH / 2;
const DEFAULT_KEY_WIDTH = KEY_WIDTH;
const MIN_KEY_WIDTH = KEY_WIDTH;
const MAX_KEY_WIDTH = 200;

/** 计算一层的总宽度 */
const getLevelIndent = (keyWidth: number) =>
  BRANCH_WIDTH + keyWidth + SEP_WIDTH + VALUE_GAP;

// ============================================
// Depth Resize Bar Component
// 顶部可拖拽调整层级 key 宽度
// 默认隐藏，hover 时显示
// ============================================
export interface DepthResizeBarProps {
  keyWidths: number[];
  maxDepth: number;
  onKeyWidthChange: (depth: number, newKeyWidth: number) => void;
}

export const DepthResizeBar = React.memo(function DepthResizeBar({
  keyWidths,
  maxDepth,
  onKeyWidthChange,
}: DepthResizeBarProps) {
  const [draggingDepth, setDraggingDepth] = useState<number | null>(null);
  const dragStartX = useRef(0);
  const dragStartKeyWidth = useRef(0);

  // 计算每个深度的 X 位置
  const getDepthX = useCallback(
    (depth: number) => {
      let x = BASE_INDENT;
      for (let i = 0; i < depth; i++) {
        const kw = keyWidths[i] ?? DEFAULT_KEY_WIDTH;
        x += getLevelIndent(kw);
      }
      return x;
    },
    [keyWidths]
  );

  // 处理拖拽
  useEffect(() => {
    if (draggingDepth === null || draggingDepth === 0) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX.current;
      const newKeyWidth = Math.max(
        MIN_KEY_WIDTH,
        Math.min(MAX_KEY_WIDTH, dragStartKeyWidth.current + deltaX)
      );
      onKeyWidthChange(draggingDepth - 1, newKeyWidth);
    };

    const handleMouseUp = () => {
      setDraggingDepth(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingDepth, onKeyWidthChange]);

  // 拖拽 depth N 的线，实际改变的是 keyWidths[N-1]
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, depth: number) => {
      if (depth === 0) return;
      e.preventDefault();
      e.stopPropagation();
      setDraggingDepth(depth);
      dragStartX.current = e.clientX;
      dragStartKeyWidth.current = keyWidths[depth - 1] ?? DEFAULT_KEY_WIDTH;
    },
    [keyWidths]
  );

  // 计算实际要渲染的把手数量（确保至少为 0）
  const handleCount = Math.max(0, maxDepth + 2);

  // 拖拽时强制显示
  const isDragging = draggingDepth !== null;

  return (
    <>
      <style jsx>{`
        .resize-bar {
          position: relative;
          height: 45px;
          margin-left: 24px;
          margin-right: 8px;
          display: flex;
          align-items: center;
        }
        .resize-bar .center-line {
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          height: 1px;
          background: rgba(255, 255, 255, 0.08);
          transition: background 0.15s ease;
        }
        .resize-bar:hover .center-line,
        .resize-bar.dragging .center-line {
          background: rgba(255, 255, 255, 0.2);
        }
        .resize-bar .handle {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 20px;
          height: 40px;
          cursor: col-resize;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1;
          opacity: 0;
          transition: opacity 0.15s ease;
        }
        .resize-bar:hover .handle,
        .resize-bar.dragging .handle {
          opacity: 1;
        }
        .resize-bar .handle.active {
          z-index: 10;
        }
        .resize-bar .handle .line {
          width: 2px;
          height: 12px;
          background: #6b7280;
          border-radius: 1px;
        }
        .resize-bar .handle:hover .line,
        .resize-bar .handle.active .line {
          background: #60a5fa;
        }
      `}</style>
      <div className={`resize-bar ${isDragging ? 'dragging' : ''}`}>
        {/* 中心横线 */}
        <div className='center-line' />

        {/* 渲染每个深度的竖线把手 */}
        {Array.from({ length: handleCount }, (_, depth) => {
          const x = getDepthX(depth);
          const isActive = draggingDepth === depth;
          const canDrag = depth > 0;

          // 只显示可拖拽的把手（depth > 0）
          if (!canDrag) return null;

          return (
            <div
              key={depth}
              className={`handle ${isActive ? 'active' : ''}`}
              style={{ left: x - 10 }}
              onMouseDown={e => handleMouseDown(e, depth)}
            >
              <div className='line' />
            </div>
          );
        })}
      </div>
    </>
  );
});
