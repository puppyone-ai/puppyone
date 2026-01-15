import React, { useState, useRef, useEffect, useCallback } from 'react';

// ============================================
// Table Resize Header
// Displays column headers and allows resizing key columns
// ============================================

const DEFAULT_KEY_WIDTH = 120;
const MIN_KEY_WIDTH = 60;
const MAX_KEY_WIDTH = 400;

export interface TableResizeHeaderProps {
  keyWidths: number[];
  maxDepth: number;
  onKeyWidthChange: (depth: number, newKeyWidth: number) => void;
}

export const TableResizeHeader = React.memo(function TableResizeHeader({
  keyWidths,
  maxDepth,
  onKeyWidthChange,
}: TableResizeHeaderProps) {
  const [draggingDepth, setDraggingDepth] = useState<number | null>(null);
  const dragStartX = useRef(0);
  const dragStartKeyWidth = useRef(0);

  // Calculate X position for each depth's border
  // Depth 0 border is at keyWidths[0]
  // Depth 1 border is at keyWidths[0] + keyWidths[1]
  const getDepthX = useCallback(
    (depth: number) => {
      let x = 0;
      for (let i = 0; i <= depth; i++) {
        x += (keyWidths[i] ?? DEFAULT_KEY_WIDTH);
      }
      return x;
    },
    [keyWidths]
  );

  // Handle Dragging
  useEffect(() => {
    if (draggingDepth === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX.current;
      
      const newKeyWidth = Math.max(
        MIN_KEY_WIDTH,
        Math.min(MAX_KEY_WIDTH, dragStartKeyWidth.current + deltaX)
      );
      
      onKeyWidthChange(draggingDepth, newKeyWidth);
    };

    const handleMouseUp = () => {
      setDraggingDepth(null);
      document.body.style.cursor = 'default';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    };
  }, [draggingDepth, onKeyWidthChange]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, depth: number) => {
      e.preventDefault();
      e.stopPropagation();
      setDraggingDepth(depth);
      dragStartX.current = e.clientX;
      dragStartKeyWidth.current = keyWidths[depth] ?? DEFAULT_KEY_WIDTH;
    },
    [keyWidths]
  );

  // We show handles for visible depths
  // maxDepth is the deepest node index.
  // E.g. maxDepth = 2 means we have depth 0, 1, 2.
  // We need handles for 0, 1, 2.
  const handleCount = Math.max(0, maxDepth + 1);

  return (
    <>
      <style jsx>{`
        .table-header {
          position: relative;
          height: 32px;
          margin-left: 32px; /* Matches editor padding */
          margin-right: 8px;
          display: flex;
          align-items: center;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          background: transparent;
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 11px;
          font-weight: 500;
          color: #6b7280;
          user-select: none;
        }
        
        .header-cell {
            padding-left: 12px;
            display: flex;
            align-items: center;
            height: 100%;
            position: relative;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .resize-handle {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 8px; /* Hit area */
          cursor: col-resize;
          z-index: 10;
          /* Visual line */
          display: flex;
          justify-content: center;
        }
        
        .resize-handle::after {
            content: '';
            width: 2px;
            height: 12px; /* Shorten to look like a handle/tick mark */
            border-radius: 1px;
            background: rgba(255, 255, 255, 0.2);
            transition: all 0.15s;
        }

        /* Show handles more clearly when hovering the header area */
        .table-header:hover .resize-handle::after {
            background: rgba(255, 255, 255, 0.4);
            height: 16px; /* Grow slightly on hover hint */
        }

        .resize-handle:hover::after,
        .resize-handle.active::after {
            background: #528bff !important;
            width: 3px; /* Thicker on interaction */
            height: 100%; /* Full height when dragging for precision visual */
            border-radius: 0;
            box-shadow: 0 0 4px rgba(82, 139, 255, 0.5);
        }
      `}</style>
      
      <div className="table-header">
        {/* Render "KEY" labels for each depth level if enough space? 
            Actually, just showing "KEY" at the first column is cleaner, 
            or maybe "KEY (L0)", "KEY (L1)"... 
            Let's simply render the resizing handles and maybe column labels.
        */}
        
        {/* We need to render actual divs for the headers so they fill the space visually? */}
        {Array.from({ length: handleCount }, (_, depth) => {
             const width = keyWidths[depth] ?? DEFAULT_KEY_WIDTH;
             return (
                 <div key={depth} style={{ width, flexShrink: 0 }} className="header-cell">
                     {/* KEY label removed */}
                     <div 
                        className={`resize-handle ${draggingDepth === depth ? 'active' : ''}`}
                        style={{ right: -4 }} /* Center on border */
                        onMouseDown={(e) => handleMouseDown(e, depth)}
                     />
                 </div>
             );
        })}
        
        {/* The VALUE column takes the rest */}
        <div className="header-cell" style={{ flex: 1 }}>
            {/* VALUE label removed */}
        </div>
      </div>
    </>
  );
});

