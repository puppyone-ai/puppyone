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
import { DepthResizeBar } from './components/DepthResizeBar';
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
const BRANCH_WIDTH = 16;
const KEY_WIDTH = 64;
const SEP_WIDTH = 8;
const VALUE_GAP = 12;
const MENU_WIDTH = 26;
const MENU_GAP = 4;
const LINE_END_GAP = 2;
const LINE_COLOR = '#3a3f47';
const CORNER_RADIUS = 6;
const CONTAINER_GAP = 4;
const BASE_INDENT = 9;

// Dynamic Key Widths
const DEFAULT_KEY_WIDTH = KEY_WIDTH;
const MAX_DEPTH_LEVELS = 20;

const getLevelIndent = (keyWidth: number) =>
  BRANCH_WIDTH + keyWidth + SEP_WIDTH + VALUE_GAP;

const getVerticalLineXDynamic = (depth: number, keyWidths: number[]) => {
  let x = BASE_INDENT;
  for (let i = 0; i < depth; i++) {
    const kw = keyWidths[i] ?? DEFAULT_KEY_WIDTH;
    x += getLevelIndent(kw);
  }
  return x;
};

const getRootContentLeft = () => 0;

const getContentLeftDynamic = (depth: number, keyWidths: number[]) =>
  getVerticalLineXDynamic(depth, keyWidths) + BRANCH_WIDTH;

const getKeyWidthDynamic = (depth: number, keyWidths: number[]) =>
  keyWidths[depth] ?? DEFAULT_KEY_WIDTH;

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

const LevelConnector = React.memo(function LevelConnector({
  depth,
  isLast,
  parentLines,
  topOffset = 0,
  keyWidths,
}: {
  depth: number;
  isLast: boolean;
  parentLines: boolean[];
  topOffset?: number;
  keyWidths: number[];
}) {
  const branchY = topOffset + ROW_HEIGHT / 2;
  const branchX = getVerticalLineXDynamic(depth, keyWidths);
  const r = CORNER_RADIUS;
  const startY = 0;

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
        transition: 'width 0.1s cubic-bezier(0.2, 0, 0, 1)',
      }}
      preserveAspectRatio='none'
    >
      {parentLines.map((showLine, i) => {
        if (!showLine) return null;
        const x = getVerticalLineXDynamic(i, keyWidths);
        return (
          <line
            key={i}
            x1={0}
            y1={startY}
            x2={0}
            y2='100%'
            stroke={LINE_COLOR}
            strokeWidth={1}
            vectorEffect='non-scaling-stroke'
            style={{
              transform: `translateX(${x}px)`,
              transition: 'transform 0.1s cubic-bezier(0.2, 0, 0, 1)',
            }}
          />
        );
      })}
      <line
        x1={0}
        y1={startY}
        x2={0}
        y2={isLast ? branchY - r : '100%'}
        stroke={LINE_COLOR}
        strokeWidth={1}
        vectorEffect='non-scaling-stroke'
        style={{
          transform: `translateX(${branchX}px)`,
          transition: 'transform 0.1s cubic-bezier(0.2, 0, 0, 1)',
        }}
      />
      <path
        d={`M 0 ${branchY - r} Q 0 ${branchY} ${r} ${branchY} L ${
          BRANCH_WIDTH - LINE_END_GAP
        } ${branchY}`}
        stroke={LINE_COLOR}
        strokeWidth={1}
        fill='none'
        vectorEffect='non-scaling-stroke'
        style={{
          transform: `translateX(${branchX}px)`,
          transition: 'transform 0.1s cubic-bezier(0.2, 0, 0, 1)',
        }}
      />
    </svg>
  );
});

// VirtualRow Component (reused mostly as is, simplified styles)
interface VirtualRowProps {
  node: FlatNode;
  isSelected: boolean;
  keyWidths: number[];
  tableId?: number;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onValueChange: (path: string, value: JsonValue) => void;
  onKeyRename: (path: string, newKey: string) => void;
  // 新增：快速添加回调
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
  isContextMenuOpen?: boolean;
  onOpenDocument?: (path: string, value: string) => void;
  // 新增：hover 状态通知
  onHoverChange?: (path: string | null) => void;
  isPopoverOpen?: boolean;
  // 新增：外部 hover 状态（来自 sidebar menu 区域）
  isHoveredExternal?: boolean;
}

const VirtualRow = React.memo(function VirtualRow({
  node,
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
  isContextMenuOpen,
  onOpenDocument,
  onHoverChange,
  isPopoverOpen,
  isHoveredExternal,
}: VirtualRowProps) {
  const isPopoverOwner = isPopoverOpen || false;
  const [hovered, setHovered] = useState(false);
  // 合并本地 hover 和外部 hover
  const isHovered = hovered || isHoveredExternal;
  const keyRef = useRef<HTMLSpanElement>(null);
  const [isEditingKey, setIsEditingKey] = useState(false);
  const isConfigured =
    !!configuredAccess && Object.values(configuredAccess).some(Boolean);
  const isRootNode = node.key === '$root';
  // 统一行高，不再根据类型添加额外 padding
  const extraTopPadding = 0;
  const extraBottomPadding = 0;
  const contentLeft = isRootNode
    ? getRootContentLeft()
    : getContentLeftDynamic(node.depth, keyWidths);
  const keyWidth = isRootNode
    ? KEY_WIDTH
    : getKeyWidthDynamic(node.depth, keyWidths);

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

  // Quick add: delegate to parent's onAddChild (which uses the hook)
  const handleQuickAdd = useCallback(() => {
    if (node.path === undefined) return;
    // Pass the path to the parent handler
    onAddChild?.(node.path);
  }, [node.path, onAddChild]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center', // 改为垂直居中
        height: ROW_HEIGHT, // 固定高度 28px
        overflow: 'hidden',
        background:
          isHovered || isPopoverOwner
            ? 'rgba(255, 255, 255, 0.08)'
            : 'transparent',
        cursor: 'pointer',
        userSelect: 'none',
        position: 'relative',
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
      {!isRootNode && (
        <LevelConnector
          depth={node.depth}
          isLast={node.isLast}
          parentLines={node.parentLines}
          topOffset={extraTopPadding}
          keyWidths={keyWidths}
        />
      )}

      <button
        style={{
          position: 'absolute',
          left:
            (isRootNode ? contentLeft : contentLeft + keyWidth + SEP_WIDTH) -
            MENU_WIDTH -
            MENU_GAP,
          top: extraTopPadding + (ROW_HEIGHT - MENU_WIDTH) / 2,
          width: MENU_WIDTH,
          height: MENU_WIDTH,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            hovered || !!isContextMenuOpen
              ? hovered
                ? 'rgba(255,255,255,0.2)'
                : 'rgba(255,255,255,0.1)'
              : 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          opacity: hovered || !!isContextMenuOpen ? 1 : 0,
          transition:
            'opacity 0.12s, background 0.1s, left 0.1s cubic-bezier(0.2, 0, 0, 1)',
          color: '#9ca3af',
          zIndex: 1,
        }}
        onClick={handleMenuClick}
      >
        <svg width='8' height='12' viewBox='0 0 8 12' fill='none'>
          <circle cx='2' cy='2' r='1.2' fill='currentColor' />
          <circle cx='2' cy='6' r='1.2' fill='currentColor' />
          <circle cx='2' cy='10' r='1.2' fill='currentColor' />
          <circle cx='6' cy='2' r='1.2' fill='currentColor' />
          <circle cx='6' cy='6' r='1.2' fill='currentColor' />
          <circle cx='6' cy='10' r='1.2' fill='currentColor' />
        </svg>
      </button>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          marginLeft: contentLeft,
          paddingTop: 0,
          paddingRight: 0,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          transition: 'margin-left 0.1s cubic-bezier(0.2, 0, 0, 1)',
        }}
      >
        {!isRootNode && (
          <div
            style={{
              width: keyWidth + SEP_WIDTH,
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
              height: ROW_HEIGHT,
              transition: 'width 0.1s cubic-bezier(0.2, 0, 0, 1)',
            }}
          >
            {typeof node.key === 'number' ? (
              <span
                style={{
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: keyWidth,
                  color: '#6b7280',
                  fontSize: 16,
                  transition: 'max-width 0.1s cubic-bezier(0.2, 0, 0, 1)',
                }}
              >
                {node.key}
              </span>
            ) : (
              <span
                ref={keyRef}
                contentEditable={isEditingKey}
                suppressContentEditableWarning
                style={{
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: keyWidth,
                  outline: 'none',
                  borderRadius: 2,
                  padding: '0 2px',
                  margin: '0 -2px',
                  cursor: isSelectingAccessPoint
                    ? 'pointer'
                    : isEditingKey
                      ? 'text'
                      : 'default',
                  background: isEditingKey
                    ? 'rgba(255, 255, 255, 0.1)'
                    : 'transparent',
                  boxShadow: isEditingKey
                    ? '0 0 0 1px rgba(255, 255, 255, 0.2)'
                    : 'none',
                  color: '#6b7280',
                  fontSize: 16,
                  transition: 'max-width 0.1s cubic-bezier(0.2, 0, 0, 1)',
                }}
                onDoubleClick={e => {
                  if (!isSelectingAccessPoint) {
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
                {node.key}
              </span>
            )}
            <span
              style={{
                flex: 1,
                height: 1,
                background: LINE_COLOR,
                marginLeft: 6,
                minWidth: 12,
              }}
            />
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            borderRadius: 4,
            padding: '0 8px',
            minHeight: 28,
            transition: 'all 0.12s',
            background:
              isPopoverOwner && !isConfigured
                ? 'rgba(255, 167, 61, 0.12)'
                : isConfigured
                  ? isPopoverOwner
                    ? 'rgba(255, 167, 61, 0.18)' // 激活态
                    : 'rgba(255, 167, 61, 0.12)' // 默认已配置 - 更明显
                  : 'transparent',
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
  );
});

import {
  useJsonTreeActions,
  updateJsonAtPath,
} from './hooks/useJsonTreeActions';

// ============================================
// Main Component: TreeLineDiscreteEditor
// ============================================
export default function TreeLineDiscreteEditor({
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
        fontSize: 16,
      }}
    >
      <DepthResizeBar
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
            paddingLeft: 24,
            paddingRight: 8,
          }}
          onWheel={handleWheel}
        >
          {/* Render visible rows at fixed positions */}
          {visibleRows.map(({ node, offsetY }) => (
            <div
              key={node.path || '$root'}
              style={{
                position: 'absolute',
                top: offsetY,
                left: 24, // Matches paddingLeft of container
                right: 8,
                height: ROW_HEIGHT,
              }}
            >
              <VirtualRow
                node={node}
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
            className='custom-scrollbar-track'
            style={{
              position: 'absolute',
              right: 4, // 稍微离右边远一点点
              top: 4, // 上下留白
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
