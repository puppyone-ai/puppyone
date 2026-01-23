import React, { useState, useCallback, useRef, useMemo } from 'react';
import { McpToolPermissions } from '../../../../lib/mcpApi';
import { ValueRenderer } from './ValueRenderer';
import { FlatNode, JsonValue } from '../types';
import {
  ROW_HEIGHT,
  DEFAULT_KEY_WIDTH,
  BORDER_COLOR,
  CELL_PADDING_X,
  ROW_BG_EVEN,
  ROW_BG_ODD,
} from '../constants';

// Helper to get total indentation
const getTableIndent = (depth: number, keyWidths: number[]) => {
  let x = 0;
  for (let i = 0; i < depth; i++) {
    x += keyWidths[i] ?? DEFAULT_KEY_WIDTH;
  }
  return x;
};

// ============================================
// TableGridLines Component
// ============================================
const TableGridLines = React.memo(function TableGridLines({
  depth,
  keyWidths,
  highlightedDepths,
}: {
  depth: number;
  keyWidths: number[];
  highlightedDepths: Set<number>;
}) {
  const lines = [];
  let currentX = 0;

  for (let i = 0; i < depth - 1; i++) {
    const width = keyWidths[i] ?? DEFAULT_KEY_WIDTH;
    currentX += width;

    const isHighlighted = highlightedDepths.has(i);
    const lineColor = isHighlighted ? 'rgba(255, 167, 61, 0.4)' : BORDER_COLOR;
    const lineWidth = isHighlighted ? 1 : 1;

    lines.push(
      <div
        key={i}
        style={{
          position: 'absolute',
          left: currentX,
          top: 0,
          bottom: 0,
          width: lineWidth,
          background: lineColor,
          zIndex: isHighlighted ? 2 : 0,
        }}
      />
    );
  }

  if (depth > 0) {
    const isHighlighted = highlightedDepths.has(-1);
    const lineColor = isHighlighted ? 'rgba(255, 167, 61, 0.4)' : BORDER_COLOR;

    lines.push(
      <div
        key='start'
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 1,
          background: lineColor,
          zIndex: isHighlighted ? 2 : 0,
        }}
      />
    );
  }

  return <>{lines}</>;
});

// ============================================
// VirtualRow Component
// ============================================
interface VirtualRowProps {
  node: FlatNode;
  index: number;
  isSelected: boolean;
  keyWidths: number[];
  tableId?: number;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onValueChange: (path: string, value: JsonValue) => void;
  onKeyRename: (path: string, newKey: string) => void;
  onAddChild?: (path: string) => void;
  onContextMenu: (
    e: React.MouseEvent,
    path: string,
    value: JsonValue,
    anchorElement?: HTMLElement
  ) => void;
  isSelectingAccessPoint?: boolean;
  onAddAccessPoint?: (path: string, permissions: McpToolPermissions) => void;
  configuredAccess?: McpToolPermissions | null;
  configuredAccessMap: Map<string, McpToolPermissions>;
  isContextMenuOpen?: boolean;
  onOpenDocument?: (path: string, value: string) => void;
  onHoverChange?: (path: string | null) => void;
  isPopoverOpen?: boolean;
  isHoveredExternal?: boolean;
}

export const VirtualRow = React.memo(function VirtualRow({
  node,
  index,
  isSelected,
  keyWidths,
  tableId,
  onToggle,
  onSelect,
  onValueChange,
  onKeyRename,
  onAddChild,
  onContextMenu,
  isSelectingAccessPoint,
  onAddAccessPoint,
  configuredAccess,
  configuredAccessMap,
  isContextMenuOpen,
  onOpenDocument,
  onHoverChange,
  isPopoverOpen,
  isHoveredExternal,
}: VirtualRowProps) {
  const isPopoverOwner = isPopoverOpen || false;
  const [hovered, setHovered] = useState(false);
  const isHovered = hovered || isHoveredExternal;
  const keyRef = useRef<HTMLSpanElement>(null);
  const [isEditingKey, setIsEditingKey] = useState(false);
  const isConfigured =
    !!configuredAccess && Object.values(configuredAccess).some(Boolean);
  const isRootNode = node.key === '$root';

  const effectiveDepth = Math.max(0, node.depth);
  const indent = getTableIndent(effectiveDepth, keyWidths);
  const currentKeyWidth = keyWidths[effectiveDepth] ?? DEFAULT_KEY_WIDTH;

  const highlightedDepths = useMemo(() => {
    const depths = new Set<number>();

    if (configuredAccessMap.has('')) {
      depths.add(-1);
    }

    if (!node.path) return depths;

    const segments = node.path.split('/').filter(Boolean);
    let currentPath = '';

    for (let i = 0; i < segments.length; i++) {
      currentPath += '/' + segments[i];
      if (configuredAccessMap.has(currentPath)) {
        depths.add(i);
      }
    }
    return depths;
  }, [node.path, configuredAccessMap]);

  const handleMenuClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const anchor = e.currentTarget as HTMLElement;
      // Pass the anchor element directly; positioning is handled by the context menu
      onContextMenu(e, node.path, node.value, anchor);
    },
    [node.path, node.value, onContextMenu]
  );

  const handleRowClick = useCallback(() => {
    if (isSelectingAccessPoint) {
      onAddAccessPoint?.(node.path, { query_data: true });
    } else {
      onSelect(node.path);
    }
  }, [isSelectingAccessPoint, node.path, onSelect, onAddAccessPoint]);

  const handleQuickAdd = useCallback(() => {
    if (node.path === undefined) return;
    onAddChild?.(node.path);
  }, [node.path, onAddChild]);

  let rowBaseBg = index % 2 === 0 ? ROW_BG_EVEN : ROW_BG_ODD;

  if (isHovered) {
    rowBaseBg = 'rgba(255, 255, 255, 0.04)';
  }

  if (isSelected) {
    rowBaseBg = 'rgba(82, 139, 255, 0.15)';
  }

  let valueOverlayBg = 'transparent';

  if (isPopoverOwner) {
    valueOverlayBg = 'rgba(255, 167, 61, 0.2)';
  } else if (isConfigured) {
    valueOverlayBg = isHovered
      ? 'rgba(255, 167, 61, 0.15)'
      : 'rgba(255, 167, 61, 0.08)';
  }

  const isKeyBorderHighlighted = highlightedDepths.has(effectiveDepth - 1);
  const keyBorderLeftColor = isKeyBorderHighlighted
    ? 'rgba(255, 167, 61, 0.4)'
    : BORDER_COLOR;
  const keyBorderLeftWidth = isKeyBorderHighlighted ? 1 : 1;

  if (isRootNode) {
    return (
      <div
        style={{
          position: 'relative',
          height: ROW_HEIGHT,
          width: '100%',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'stretch',
          background: rowBaseBg,
          cursor: 'pointer',
          borderLeft: `1px solid ${BORDER_COLOR}`,
          borderTop: `1px solid ${BORDER_COLOR}`,
        }}
        onClick={handleRowClick}
        onMouseEnter={() => {
          setHovered(true);
          onHoverChange?.(node.path);
        }}
        onMouseLeave={() => {
          setHovered(false);
          onHoverChange?.(null);
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: CELL_PADDING_X, // Restore standard padding
            paddingRight: 8,
            overflow: 'hidden',
            background: valueOverlayBg,
            position: 'relative',
          }}
        >
          <ValueRenderer
            value={node.value}
            path={node.path}
            nodeKey={String(node.key)}
            tableId={tableId !== undefined ? String(tableId) : undefined}
            isExpanded={node.isExpanded}
            isExpandable={node.isExpandable}
            isSelectingAccessPoint={isSelectingAccessPoint}
            showQuickAdd={false} // We manually render quick add button
            onQuickAdd={handleQuickAdd}
            onChange={v => onValueChange(node.path, v)}
            onToggle={() => onToggle(node.path)}
            onSelect={() => onSelect(node.path)}
            onOpenDocument={onOpenDocument}
          />

          {/* Context Menu Button - Left of Add Button */}
          <button
            style={{
              position: 'absolute',
              left: 28,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 26,
              height: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              opacity: isHovered || !!isContextMenuOpen ? 1 : 0,
              color: '#e5e5e5',
              transition: 'all 0.1s',
              zIndex: 10,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            }}
            onMouseDown={handleMenuClick}
          >
            <svg width='14' height='14' viewBox='0 0 24 24' fill='currentColor'>
              <path d='M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z' />
            </svg>
          </button>

          {/* Quick Add Button - Right of Menu Button */}
          {node.isExpandable && (
            <button
              style={{
                position: 'absolute',
                left: 58,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 26,
                height: 26,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                opacity: isHovered ? 1 : 0,
                color: '#e5e5e5',
                transition: 'all 0.1s',
                zIndex: 10,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
              }}
              onClick={e => {
                e.stopPropagation();
                handleQuickAdd();
              }}
            >
              <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                <path
                  d='M7 3v8M3 7h8'
                  stroke='currentColor'
                  strokeWidth='1.3'
                  strokeLinecap='round'
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        height: ROW_HEIGHT,
        width: '100%',
        userSelect: 'none',
      }}
      onClick={handleRowClick}
      onMouseEnter={() => {
        setHovered(true);
        onHoverChange?.(node.path);
      }}
      onMouseLeave={() => {
        setHovered(false);
        onHoverChange?.(null);
      }}
    >
      <TableGridLines
        depth={effectiveDepth}
        keyWidths={keyWidths}
        highlightedDepths={highlightedDepths}
      />

      <div
        style={{
          marginLeft: indent,
          height: '100%',
          display: 'flex',
          alignItems: 'stretch',
          background: rowBaseBg,
          cursor: 'pointer',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* KEY CELL */}
        <div
          style={{
            width: currentKeyWidth,
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            paddingLeft: CELL_PADDING_X,
            paddingRight: 8,
            borderLeft: `${keyBorderLeftWidth}px solid ${keyBorderLeftColor}`,
            borderTop: `1px solid ${BORDER_COLOR}`,
            borderBottom: node.isExpanded ? 'none' : `1px solid ${BORDER_COLOR}`,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {typeof node.key === 'number' ? (
            <span
              style={{
                flex: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                color: '#8b949e',
                fontSize: 13,
              }}
            >
              {node.key}
            </span>
          ) : (
            <span
              ref={keyRef}
              contentEditable={isEditingKey && !isRootNode}
              suppressContentEditableWarning
              style={{
                flex: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                outline: 'none',
                color: isRootNode ? '#e2e8f0' : '#8b949e',
                fontWeight: isRootNode ? 500 : 400,
                fontSize: 13,
                cursor: isEditingKey && !isRootNode ? 'text' : 'pointer',
                background:
                  isEditingKey && !isRootNode
                    ? 'rgba(255,255,255,0.1)'
                    : 'transparent',
              }}
              onDoubleClick={e => {
                if (!isSelectingAccessPoint && !isRootNode) {
                  e.stopPropagation();
                  setIsEditingKey(true);
                  setTimeout(() => keyRef.current?.focus(), 0);
                }
              }}
              onBlur={e => {
                if (!isEditingKey) return;
                const newKey = e.currentTarget.innerText.trim();
                if (newKey && newKey !== node.key)
                  onKeyRename(node.path, newKey);
                else e.currentTarget.innerText = String(node.key);
                setIsEditingKey(false);
              }}
              onKeyDown={e => {
                if (!isEditingKey) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  e.currentTarget.innerText = String(node.key);
                  e.currentTarget.blur();
                }
              }}
            >
              {isRootNode ? '/' : node.key}
            </span>
          )}

          {/* Context Menu Button */}
          <button
            style={{
              position: 'absolute',
              right: 1,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 26,
              height: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              opacity: hovered || !!isContextMenuOpen ? 1 : 0,
              color: '#e5e5e5',
              transition: 'all 0.1s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            }}
            onMouseDown={handleMenuClick}
          >
            <svg width='14' height='14' viewBox='0 0 24 24' fill='currentColor'>
              <path d='M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z' />
            </svg>
          </button>
        </div>

        {/* VALUE CELL */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: CELL_PADDING_X,
            minWidth: 0,
            position: 'relative',
            borderLeft: `1px solid ${BORDER_COLOR}`,
            borderTop: `1px solid ${BORDER_COLOR}`,
            background: valueOverlayBg,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <ValueRenderer
              value={node.value}
              path={node.path}
              nodeKey={String(node.key)}
              tableId={tableId !== undefined ? String(tableId) : undefined}
              isExpanded={node.isExpanded}
              isExpandable={node.isExpandable}
              isSelectingAccessPoint={isSelectingAccessPoint}
              showQuickAdd={isHovered && node.isExpandable && !isRootNode}
              onQuickAdd={handleQuickAdd}
              onChange={v => onValueChange(node.path, v)}
              onToggle={() => onToggle(node.path)}
              onSelect={() => onSelect(node.path)}
              onOpenDocument={onOpenDocument}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

