'use client';

import React, { useState, useEffect } from 'react';

interface ResizablePanelProps {
  children: React.ReactNode;
  isVisible: boolean;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

const DEFAULT_WIDTH = 450;
const MIN_WIDTH = 300;
const MAX_WIDTH = 800;

export function ResizablePanel({
  children,
  isVisible,
  defaultWidth = DEFAULT_WIDTH,
  minWidth = MIN_WIDTH,
  maxWidth = MAX_WIDTH,
}: ResizablePanelProps) {
  const [width, setWidth] = useState(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const [isResizeHovered, setIsResizeHovered] = useState(false);
  const [dragStart, setDragStart] = useState<{
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    if (!isResizing || !dragStart) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = dragStart.startX - e.clientX;
      const newWidth = dragStart.startWidth + deltaX;
      if (newWidth >= minWidth && newWidth <= maxWidth) {
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
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };
  }, [isResizing, dragStart, minWidth, maxWidth]);

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
      {/* Resize Handle */}
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

      {/* Content */}
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
        {children}
      </div>
    </div>
  );
}
