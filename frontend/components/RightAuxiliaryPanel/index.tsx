'use client';

import React, { useState, useEffect } from 'react';
import { DocumentEditor } from './DocumentEditor';
import { type McpToolDefinition } from '../../lib/mcpApi';

// 面板类型
export type RightPanelContent = 'NONE' | 'EDITOR';

// 编辑器目标类型
export interface EditorTarget {
  path: string;
  value: string;
}

interface RightAuxiliaryPanelProps {
  content: RightPanelContent;
  onClose: () => void;

  // 文档编辑器相关
  editorTarget: EditorTarget | null;
  onEditorSave: (path: string, newValue: string) => void;

  // 全屏状态
  isEditorFullScreen?: boolean;
  onToggleEditorFullScreen?: () => void;
}

const MIN_WIDTH = 300;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 450;

export function RightAuxiliaryPanel({
  content,
  onClose,
  // Editor props
  editorTarget,
  onEditorSave,
  // Fullscreen props
  isEditorFullScreen = false,
  onToggleEditorFullScreen,
}: RightAuxiliaryPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [isResizeHovered, setIsResizeHovered] = useState(false);

  // 记录拖拽开始时的状态（用于相对拖拽计算）
  const [dragStart, setDragStart] = useState<{
    startX: number;
    startWidth: number;
  } | null>(null);

  // Handle Resize - 使用相对拖拽逻辑，不依赖面板在页面中的绝对位置
  useEffect(() => {
    if (!isResizing || !dragStart) return;

    const handleMouseMove = (e: MouseEvent) => {
      // 向左拖动（X减小）= 宽度增加，向右拖动（X增大）= 宽度减小
      const deltaX = dragStart.startX - e.clientX;
      const newWidth = dragStart.startWidth + deltaX;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setDragStart(null);
      setIsResizeHovered(false);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // 防止拖拽时选中文字
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };
  }, [isResizing, dragStart]);

  // 全屏模式：占据全部空间
  if (isEditorFullScreen && content === 'EDITOR') {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: '#161618',
          overflow: 'hidden',
          // 全屏时的淡入动画
          animation: 'fadeIn 0.2s ease',
        }}
      >
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>
        {editorTarget && (
          <DocumentEditor
            path={editorTarget.path}
            value={editorTarget.value}
            onSave={newValue => onEditorSave(editorTarget.path, newValue)}
            onClose={onClose}
            isFullScreen={isEditorFullScreen}
            onToggleFullScreen={onToggleEditorFullScreen}
          />
        )}
      </div>
    );
  }

  // 面板是否应该显示
  const isVisible = content !== 'NONE';

  return (
    <div
      style={{
        width: isVisible ? width : 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderLeft: isVisible ? '1px solid #2a2a2a' : 'none',
        background: '#111111',
        position: 'relative',
        flexShrink: 0,
        overflow: 'hidden',
        transition: isResizing ? 'none' : 'width 0.2s ease',
      }}
    >
      {/* 简化的 Resize Handle - 和左侧 Sidebar 风格一致 */}
      <div
        onMouseDown={e => {
          e.preventDefault();
          e.stopPropagation();
          setDragStart({ startX: e.clientX, startWidth: width });
          setIsResizing(true);
        }}
        onMouseEnter={() => setIsResizeHovered(true)}
        onMouseLeave={() => !isResizing && setIsResizeHovered(false)}
        style={{
          position: 'absolute',
          left: -2,
          top: 0,
          width: 4,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 10,
          background:
            isResizing || isResizeHovered
              ? 'rgba(255, 255, 255, 0.1)'
              : 'transparent',
          transition: 'background 0.15s',
        }}
      />

      {/* Content - 全宽无额外 padding */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          opacity: isVisible ? 1 : 0,
          transition: 'opacity 0.15s ease',
        }}
      >
        {content === 'EDITOR' && editorTarget && (
          <DocumentEditor
            path={editorTarget.path}
            value={editorTarget.value}
            onSave={newValue => onEditorSave(editorTarget.path, newValue)}
            onClose={onClose}
            isFullScreen={isEditorFullScreen}
            onToggleFullScreen={onToggleEditorFullScreen}
          />
        )}
      </div>
    </div>
  );
}

// 导出子组件以便独立使用
export { DocumentEditor } from './DocumentEditor';
