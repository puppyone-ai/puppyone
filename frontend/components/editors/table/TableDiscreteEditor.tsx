'use client';

import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from 'react';
import { ContextMenu, type ContextMenuState } from './components/ContextMenu';
import { NodeContextMenu } from './components/NodeContextMenu';
import { RightAccessSidebar } from './components/RightAccessSidebar';
import { ValueRenderer } from './components/ValueRenderer';
import { TableResizeHeader } from './components/TableResizeHeader';
import { McpToolPermissions } from '../../../lib/mcpApi';

// ============================================
// Types
// ============================================
type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
interface JsonObject {
  [key: string]: JsonValue;
}
type JsonArray = JsonValue[];

interface FlatNode {
  path: string;
  key: string | number;
  value: JsonValue;
  depth: number;
  isFirst: boolean;
  isLast: boolean;
  isExpanded: boolean;
  isExpandable: boolean;
  parentLines: boolean[];
}

interface ConfiguredAccessPoint {
  path: string;
  permissions: McpToolPermissions;
}

interface TreeLineVirtualEditorProps {
  json: object;
  onChange?: (json: object) => void;
  onPathChange?: (path: string | null) => void;
  onPublishPath?: (path: string) => void;
  isSelectingAccessPoint?: boolean;
  selectedAccessPath?: string | null;
  onAddAccessPoint?: (path: string, permissions: McpToolPermissions) => void;
  configuredAccessPoints?: ConfiguredAccessPoint[];
  onAccessPointChange?: (path: string, permissions: McpToolPermissions) => void;
  onAccessPointRemove?: (path: string) => void;
  projectId?: number;
  tableId?: number;
  onImportSuccess?: () => void;
  onOpenDocument?: (path: string, value: string) => void;
}

// ============================================
// Layout Constants
// ============================================
const ROW_HEIGHT = 28;
const KEY_COL_WIDTH = 120;
const CELL_PADDING_X = 12;
const EXPAND_ICON_SIZE = 16;
const EXPAND_ICON_GAP = 8;
const BORDER_COLOR = 'rgba(255, 255, 255, 0.15)'; // Increased visibility
const ROW_BG_ODD = 'rgba(255, 255, 255, 0.015)';
const ROW_BG_EVEN = 'transparent';

// Dynamic Key Widths
const DEFAULT_KEY_WIDTH = KEY_COL_WIDTH;
const MAX_DEPTH_LEVELS = 20;

// Helper to get total indentation (sum of previous key widths)
const getTableIndent = (depth: number, keyWidths: number[]) => {
  let x = 0;
  // In table mode, indentation is the sum of widths of all parent KEY columns
  // But wait, the child row starts inside the VALUE column of the parent.
  // The Parent's VALUE column starts after Parent's KEY column.
  // So Depth 0: Start at 0. Key Width = KW0. Value starts at KW0.
  // Depth 1 (child of Depth 0): Should visually appear inside Depth 0's Value.
  // So it starts at KW0.
  // Depth 2 (child of Depth 1): Starts at KW0 + KW1.
  for (let i = 0; i < depth; i++) {
    x += (keyWidths[i] ?? DEFAULT_KEY_WIDTH);
  }
  return x;
};

// ============================================
// Utils (Copied from TreeLineVirtualEditor)
// ============================================
function flattenJsonRecursive(
  json: any,
  expandedPaths: Set<string>,
  path: string,
  depth: number,
  parentLines: boolean[]
): FlatNode[] {
  if (json === null || typeof json !== 'object') return [];

  const result: FlatNode[] = [];
  const entries = Array.isArray(json)
    ? json.map((v, i) => [i, v] as [number, any])
    : Object.entries(json);

  entries.forEach(([key, value], index) => {
    const nodePath = `${path}/${key}`;
    const isExpandable = value !== null && typeof value === 'object';
    const isExpanded = expandedPaths.has(nodePath);
    const isFirst = index === 0;
    const isLast = index === entries.length - 1;

    result.push({
      path: nodePath,
      key,
      value,
      depth,
      isFirst,
      isLast,
      isExpanded,
      isExpandable,
      parentLines: [...parentLines],
    });

    if (isExpandable && isExpanded) {
      const childParentLines = [...parentLines, !isLast];
      result.push(
        ...flattenJsonRecursive(
          value,
          expandedPaths,
          nodePath,
          depth + 1,
          childParentLines
        )
      );
    }
  });

  return result;
}

function flattenJson(json: any, expandedPaths: Set<string>): FlatNode[] {
  const ROOT_PATH = '';
  const isRootExpanded = expandedPaths.has(ROOT_PATH);
  const isRootExpandable = json !== null && typeof json === 'object';

  const rootNode: FlatNode = {
    path: ROOT_PATH,
    key: '$root',
    value: json,
    depth: -1,
    isFirst: true,
    isLast: true,
    isExpanded: isRootExpanded,
    isExpandable: isRootExpandable,
    parentLines: [],
  };

  const result: FlatNode[] = [rootNode];

  if (isRootExpandable && isRootExpanded) {
    result.push(...flattenJsonRecursive(json, expandedPaths, ROOT_PATH, 0, []));
  }

  return result;
}

// updateJsonAtPath removed - logic moved to useJsonTreeActions

// ============================================
// Components (Copied from TreeLineVirtualEditor)
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

  // Draw vertical lines for all parent levels
  // Use depth - 1 to avoid drawing the line that overlaps with the current row's left border
  for (let i = 0; i < depth - 1; i++) {
    const width = keyWidths[i] ?? DEFAULT_KEY_WIDTH;
    currentX += width;
    
    // Line i is the left border of Depth i+1
    const isHighlighted = highlightedDepths.has(i); // Fix: Check depth i (parent), not i+1
    const lineColor = isHighlighted ? 'rgba(255, 167, 61, 0.4)' : BORDER_COLOR;
    const lineWidth = isHighlighted ? 1 : 1;

    lines.push(
      <div
        key={i}
        style={{
          position: 'absolute',
          left: currentX, // Right border of the column
          top: 0,
          bottom: 0,
          width: lineWidth,
          background: lineColor,
          zIndex: isHighlighted ? 2 : 0,
        }}
      />
    );
  }

  // Add the first left border (0px) - ONLY if depth > 0
  if (depth > 0) {
    // This is the left border of Depth 0. It belongs to Root's scope.
    const isHighlighted = highlightedDepths.has(-1);
    const lineColor = isHighlighted ? 'rgba(255, 167, 61, 0.4)' : BORDER_COLOR;
    
    lines.push(
      <div
          key="start"
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

// VirtualRow Component (Adapted for Table Layout)
interface VirtualRowProps {
  node: FlatNode;
  index: number; // Added index for striping
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
  configuredAccessMap: Map<string, McpToolPermissions>; // Added prop
  isContextMenuOpen?: boolean;
  onOpenDocument?: (path: string, value: string) => void;
  onHoverChange?: (path: string | null) => void;
  isPopoverOpen?: boolean;
  isHoveredExternal?: boolean;
}

const VirtualRow = React.memo(function VirtualRow({
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
  
  // Table Layout Calculations
  // depth -1 for root? flattenJson says depth -1.
  // If root, we treat it as depth 0 effectively for layout if we want to show it?
  // Or usually root is hidden/special.
  // Let's assume depth starts at 0 for visible top-level items in standard table,
  // but if we show root, it might be different. 
  // The provided flattenJson produces depth 0 for children of root.
  // The root itself is depth -1.
  
  const effectiveDepth = Math.max(0, node.depth);
  const indent = getTableIndent(effectiveDepth, keyWidths);
  const currentKeyWidth = keyWidths[effectiveDepth] ?? DEFAULT_KEY_WIDTH;

  // Calculate highlighted depths based on ancestor configuration
  const highlightedDepths = useMemo(() => {
    const depths = new Set<number>();
    
    // Check Root path ('')
    if (configuredAccessMap.has('')) {
      depths.add(-1);
    }

    if (!node.path) return depths;

    const segments = node.path.split('/').filter(Boolean);
    let currentPath = '';
    
    // Check each segment path
    for (let i = 0; i < segments.length; i++) {
        currentPath += '/' + segments[i];
        if (configuredAccessMap.has(currentPath)) {
            // Depth i corresponds to this path level
            // For path /a (Depth 0), we highlight Depth 0 border
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
      const rect = anchor.getBoundingClientRect();
      onContextMenu(
        { clientX: rect.left - 164, clientY: rect.top } as React.MouseEvent,
        node.path,
        node.value,
        anchor
      );
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

  // Quick add: delegate to parent's onAddChild
  const handleQuickAdd = useCallback(() => {
    if (node.path === undefined) return;
    onAddChild?.(node.path);
  }, [node.path, onAddChild]);

  // Background Color Logic
  // 1. Base Row Background (Stripe / Hover / Selected) - Applies to the whole row (Key + Value)
  let rowBaseBg = index % 2 === 0 ? ROW_BG_EVEN : ROW_BG_ODD;

  if (isHovered) {
    rowBaseBg = 'rgba(255, 255, 255, 0.04)';
  }

  if (isSelected) {
    rowBaseBg = 'rgba(82, 139, 255, 0.15)';
  }

  // 2. Configured Highlight (Value Cell Only) - Overlays on top of base background
  let valueOverlayBg = 'transparent';
  
  if (isPopoverOwner) {
    valueOverlayBg = 'rgba(255, 167, 61, 0.2)'; // Active sidebar highlight
  } else if (isConfigured) {
    // Configured state
    valueOverlayBg = isHovered 
      ? 'rgba(255, 167, 61, 0.15)' 
      : 'rgba(255, 167, 61, 0.08)';
  }

  // Toggle Icon
  // const ExpandIcon = node.isExpanded ? (
  //   <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: 'rotate(0deg)', transition: 'transform 0.1s' }}>
  //      <path d="M1 3L5 7L9 3" stroke="currentColor" strokeWidth="1.5" fill="none" />
  //   </svg>
  // ) : (
  //   <svg width="10" height="10" viewBox="0 0 10 10" style={{ transform: 'rotate(-90deg)', transition: 'transform 0.1s' }}>
  //      <path d="M1 3L5 7L9 3" stroke="currentColor" strokeWidth="1.5" fill="none" />
  //   </svg>
  // );

  // Border Logic
  const isKeyBorderHighlighted = highlightedDepths.has(effectiveDepth - 1);
  const keyBorderLeftColor = isKeyBorderHighlighted ? 'rgba(255, 167, 61, 0.4)' : BORDER_COLOR;
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
          background: rowBaseBg, // Use base background
          cursor: 'pointer',
          // Root row borders
          borderLeft: `1px solid ${BORDER_COLOR}`,
          borderTop: `1px solid ${BORDER_COLOR}`,
        }}
        onClick={handleRowClick}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: CELL_PADDING_X, // Same padding as Key cell
            paddingRight: 8,
            overflow: 'hidden',
            background: valueOverlayBg, // Apply configured highlight to Root value area
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
              showQuickAdd={isHovered && node.isExpandable}
              onQuickAdd={handleQuickAdd}
              onChange={v => onValueChange(node.path, v)}
              onToggle={() => onToggle(node.path)}
              onSelect={() => onSelect(node.path)}
              onOpenDocument={onOpenDocument}
            />
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
      {/* Grid Lines - Rendered behind content, visible in the indented area */}
      <TableGridLines 
        depth={effectiveDepth} 
        keyWidths={keyWidths} 
        highlightedDepths={highlightedDepths}
      />

      {/* Indented Content Wrapper */}
      <div
        style={{
          marginLeft: indent,
          height: '100%',
          display: 'flex',
          alignItems: 'stretch',
          background: rowBaseBg,
          // borderLeft: `1px solid ${BORDER_COLOR}`, // Handled by cells or grid lines
          cursor: 'pointer',
          position: 'relative',
          zIndex: 1, // Ensure content is above grid lines if they overlap
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
            paddingRight: 8, // Space for menu button
            borderLeft: `${keyBorderLeftWidth}px solid ${keyBorderLeftColor}`, // Dynamic Left border
            borderTop: `1px solid ${BORDER_COLOR}`,  // Top border for Key
            borderBottom: node.isExpanded ? 'none' : `1px solid ${BORDER_COLOR}`,
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          {/* Key Name */}
           {typeof node.key === 'number' ? (
              <span
                style={{
                  flex: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  color: '#8b949e', // More subtle gray
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
                  color: isRootNode ? '#e2e8f0' : '#8b949e', // Root key slightly brighter
                  fontWeight: isRootNode ? 500 : 400,
                  fontSize: 13,
                  cursor: isEditingKey && !isRootNode ? 'text' : 'pointer',
                  background: isEditingKey && !isRootNode ? 'rgba(255,255,255,0.1)' : 'transparent',
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
            
            {/* Context Menu Button (Only visible on hover) */}
            <button
              style={{
                position: 'absolute',
                right: 2,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 20,
                height: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                opacity: hovered || !!isContextMenuOpen ? 1 : 0,
                color: '#9ca3af',
                transition: 'opacity 0.1s',
              }}
              onClick={handleMenuClick}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
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
            borderLeft: `1px solid ${BORDER_COLOR}`, // Left border for Value (separates from Key)
            borderTop: `1px solid ${BORDER_COLOR}`,  // Top border for Value
            background: valueOverlayBg, // Apply configured highlight only to Value cell
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

import {
  useJsonTreeActions,
  updateJsonAtPath,
} from './hooks/useJsonTreeActions';

// ============================================
// Main Component: TableDiscreteEditor
// ============================================
export default function TableDiscreteEditor({
  json,
  onChange,
  onPathChange,
  isSelectingAccessPoint = false,
  onAddAccessPoint,
  configuredAccessPoints = [],
  onAccessPointChange,
  onAccessPointRemove,
  projectId,
  tableId,
  onImportSuccess,
  onOpenDocument,
}: TreeLineVirtualEditorProps) {
  // --- 1. State & Setup ---
  const [scrollIndex, setScrollIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const [mainContentWidth, setMainContentWidth] = useState(0);
  const accumulatedDelta = useRef(0);

  // Use the shared actions hook
  const { onValueChange, onKeyRename, onAddChild } = useJsonTreeActions({
    json,
    onChange,
  });

  const configuredAccessMap = useMemo(() => {
    const map = new Map<string, McpToolPermissions>();
    configuredAccessPoints.forEach(ap => map.set(ap.path, ap.permissions));
    return map;
  }, [configuredAccessPoints]);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    path: '',
    value: null,
  });

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const paths = new Set<string>(['']);
    const expand = (obj: any, path: string, depth: number) => {
      if (depth > 1 || obj === null || typeof obj !== 'object') return;
      paths.add(path);
      const entries = Array.isArray(obj)
        ? obj.map((v, i) => [i, v])
        : Object.entries(obj);
      entries.forEach(([k, v]) => expand(v, `${path}/${k}`, depth + 1));
    };
    const entries = Array.isArray(json)
      ? json.map((v, i) => [i, v])
      : Object.entries(json);
    entries.forEach(([k, v]) => {
      const p = `/${k}`;
      paths.add(p);
      expand(v, p, 1);
    });
    return paths;
  });

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [lockedPopoverPath, setLockedPopoverPath] = useState<string | null>(
    null
  );
  // 新增：追踪当前 hover 的行路径
  const [hoveredRowPath, setHoveredRowPath] = useState<string | null>(null);
  const [keyWidths, setKeyWidths] = useState<number[]>(() =>
    Array(MAX_DEPTH_LEVELS).fill(DEFAULT_KEY_WIDTH)
  );

  const flatNodes = useMemo(
    () => flattenJson(json, expandedPaths),
    [json, expandedPaths]
  );
  const maxDepth = useMemo(
    () => flatNodes.reduce((max, node) => Math.max(max, node.depth), -1),
    [flatNodes]
  );

  // --- 2. Discrete Scrolling Logic ---
  const visibleCount = useMemo(() => {
    if (containerHeight === 0) return 0;
    // Calculate how many rows fit in the container (rounding up to fill partial space)
    // +2 buffer to ensure bottom row is fully visible
    return Math.ceil(containerHeight / ROW_HEIGHT) + 2;
  }, [containerHeight]);

  const maxScrollIndex = Math.max(0, flatNodes.length - visibleCount + 1);

  // Resize Observer for Container Height
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Resize Observer for Main Content Width (稳定，不受 Menu 展开影响)
  useEffect(() => {
    if (!mainContentRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setMainContentWidth(entry.contentRect.width);
      }
    });
    observer.observe(mainContentRef.current);
    return () => observer.disconnect();
  }, []);

  // Wheel Handler - The Core of "Discrete" feel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Threshold for trackpad sensitivity
      const STEP_THRESHOLD = 40;
      let steps = 0;

      if (e.deltaMode === 1) {
        // Line scrolling (mouse wheel) - direct mapping
        steps = Math.sign(e.deltaY);
      } else {
        // Pixel scrolling (trackpad) - accumulate
        accumulatedDelta.current += e.deltaY;
        if (Math.abs(accumulatedDelta.current) >= STEP_THRESHOLD) {
          steps =
            Math.sign(accumulatedDelta.current) *
            Math.floor(Math.abs(accumulatedDelta.current) / STEP_THRESHOLD);
          accumulatedDelta.current %= STEP_THRESHOLD;
        }
      }

      if (steps !== 0) {
        setScrollIndex(prev => {
          const next = prev + steps;
          return Math.max(0, Math.min(next, maxScrollIndex));
        });
      }
    },
    [maxScrollIndex]
  );

  // --- 3. Data Handlers ---
  const handleKeyWidthChange = useCallback(
    (depth: number, newKeyWidth: number) => {
      setKeyWidths(prev => {
        const next = [...prev];
        next[depth] = newKeyWidth;
        return next;
      });
    },
    []
  );

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (path: string) => {
      setSelectedPath(path);
      onPathChange?.(path);
    },
    [onPathChange]
  );

  // --- Keyboard Navigation ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if editing text or no selection
      if (
        document.activeElement?.tagName === 'INPUT' ||
        (document.activeElement as HTMLElement)?.isContentEditable ||
        !selectedPath
      ) {
        return;
      }

      const currentIndex = flatNodes.findIndex(n => n.path === selectedPath);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (currentIndex < flatNodes.length - 1) {
            nextIndex = currentIndex + 1;
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (currentIndex > 0) {
            nextIndex = currentIndex - 1;
          }
          break;
        case 'ArrowRight': {
          e.preventDefault();
          const node = flatNodes[currentIndex];
          if (node.isExpandable && !node.isExpanded) {
            handleToggle(node.path);
            return; // Don't move selection yet
          } else if (currentIndex < flatNodes.length - 1) {
             // If already expanded or leaf, move down (standard tree nav behavior)
             // But usually Right on expanded node moves to first child.
             // Since flatNodes is flattened, next node IS first child if expanded.
             nextIndex = currentIndex + 1;
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const node = flatNodes[currentIndex];
          if (node.isExpandable && node.isExpanded) {
            handleToggle(node.path);
            return; // Stay on node, just collapse
          } else {
            // Move to parent
            // Find the closest node with depth < current depth, searching backwards
            for (let i = currentIndex - 1; i >= 0; i--) {
              if (flatNodes[i].depth < node.depth) {
                nextIndex = i;
                break;
              }
            }
          }
          break;
        }
        case 'Enter':
          e.preventDefault();
          // Maybe enter edit mode? For now just toggle if expandable
          const node = flatNodes[currentIndex];
          if (node.isExpandable) {
             handleToggle(node.path);
          }
          break;
      }

      if (nextIndex !== currentIndex) {
        const nextPath = flatNodes[nextIndex].path;
        handleSelect(nextPath);
        
        // Ensure visible
        // We know visible range is [scrollIndex, scrollIndex + visibleCount]
        // If nextIndex is outside, update scrollIndex
        if (nextIndex < scrollIndex) {
          setScrollIndex(nextIndex);
        } else if (nextIndex >= scrollIndex + visibleCount - 2) {
           // -2 buffer
           setScrollIndex(nextIndex - visibleCount + 3);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPath, flatNodes, handleSelect, handleToggle, scrollIndex, visibleCount]);

  // onValueChange, onKeyRename are now provided by useJsonTreeActions

  const handleContextMenu = useCallback(
    (
      e: React.MouseEvent,
      path: string,
      value: JsonValue,
      anchorElement?: HTMLElement
    ) => {
      if (!anchorElement) return;
      const rect = anchorElement.getBoundingClientRect();
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
      });
    },
    []
  );

  // --- 4. Render ---
  // Generate the fixed list of rows based on scrollIndex
  const visibleRows = [];
  for (let i = 0; i < visibleCount; i++) {
    const nodeIndex = scrollIndex + i;
    if (nodeIndex >= flatNodes.length) break;
    visibleRows.push({
      node: flatNodes[nodeIndex],
      offsetY: i * ROW_HEIGHT,
      index: nodeIndex,
    });
  }

  return (
    <div
      data-editor-container
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',
        color: '#d4d4d4',
        overflow: 'hidden',
        fontFamily:
          "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        fontSize: 13,
      }}
    >
      <TableResizeHeader
        keyWidths={keyWidths}
        maxDepth={maxDepth}
        onKeyWidthChange={handleKeyWidthChange}
      />

      {/* Main content area: Editor + Sidebar */}
      <div
        ref={mainContentRef}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Editor container */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden', // Disable native scroll
            paddingLeft: 32,
            paddingRight: 8,
          }}
          onWheel={handleWheel}
        >
          {/* Render visible rows at fixed positions */}
          {visibleRows.map(({ node, offsetY, index }) => (
            <div
              key={node.path || '$root'}
              style={{
                position: 'absolute',
                top: offsetY,
                left: 32, // Matches paddingLeft of container
                right: 8,
                height: ROW_HEIGHT,
              }}
            >
              <VirtualRow
                node={node}
                index={index}
                isSelected={selectedPath === node.path}
                keyWidths={keyWidths}
                tableId={tableId}
                onToggle={handleToggle}
                onSelect={handleSelect}
                onValueChange={onValueChange}
                onKeyRename={onKeyRename}
                onAddChild={onAddChild}
                onContextMenu={handleContextMenu}
                isSelectingAccessPoint={isSelectingAccessPoint}
                onAddAccessPoint={onAddAccessPoint}
                configuredAccess={configuredAccessMap.get(node.path) || null}
                configuredAccessMap={configuredAccessMap} // Pass map
                isContextMenuOpen={
                  contextMenu.visible && contextMenu.path === node.path
                }
                onOpenDocument={onOpenDocument}
                onHoverChange={setHoveredRowPath}
                isPopoverOpen={lockedPopoverPath === node.path}
                isHoveredExternal={hoveredRowPath === node.path}
              />
            </div>
          ))}
        </div>

        {/* Right Access Sidebar - 独立的右侧面板 */}
        <RightAccessSidebar
          visibleRows={visibleRows}
          rowHeight={ROW_HEIGHT}
          configuredAccessMap={configuredAccessMap}
          lockedPopoverPath={lockedPopoverPath}
          onPopoverOpenChange={setLockedPopoverPath}
          onAccessChange={onAccessPointChange}
          onRemove={onAccessPointRemove}
          isSelectingAccessPoint={isSelectingAccessPoint}
          hoveredRowPath={hoveredRowPath}
          onHoverRow={setHoveredRowPath}
          containerWidth={mainContentWidth} // 传递稳定的父容器宽度
        />

        {/* Custom Discrete Scrollbar (Moved to far right) */}
        {flatNodes.length > visibleCount && (
          <div
            className="custom-scrollbar-track"
            style={{
              position: 'absolute',
              right: 4, // 稍微离右边远一点点
              top: 4,   // 上下留白
              bottom: 4,
              width: 6, // 加宽到 6px
              background: 'rgba(255,255,255,0.03)', // 轨道颜色更淡
              borderRadius: 3,
              zIndex: 20,
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              const thumb = e.currentTarget.firstElementChild as HTMLElement;
              if (thumb) thumb.style.background = 'rgba(255,255,255,0.5)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
              const thumb = e.currentTarget.firstElementChild as HTMLElement;
              if (thumb) thumb.style.background = 'rgba(255,255,255,0.3)';
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: `${(scrollIndex / flatNodes.length) * 100}%`,
                height: `${Math.max((visibleCount / flatNodes.length) * 100, 5)}%`, // 确保最小高度，避免太小看不见
                width: '100%',
                background: 'rgba(255,255,255,0.3)',
                borderRadius: 3,
                transition: 'background 0.2s',
              }}
            />
          </div>
        )}
      </div>

      <NodeContextMenu
        state={contextMenu}
        json={json}
        projectId={projectId}
        tableId={tableId}
        onClose={() => setContextMenu(prev => ({ ...prev, visible: false }))}
        onChange={onChange}
        onImportSuccess={onImportSuccess}
      />
    </div>
  );
}
