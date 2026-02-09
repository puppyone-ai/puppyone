'use client';

import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from 'react';
import { ContextMenuState } from './components/ContextMenu';
import { NodeContextMenu } from './components/NodeContextMenu';
import { TableResizeHeader } from './components/TableResizeHeader';
import { VirtualRow } from './components/VirtualRow';
import { McpToolPermissions } from '../../../lib/mcpApi';
import { FlatNode, JsonValue, ConfiguredAccessPoint } from './types';
import { ROW_HEIGHT, DEFAULT_KEY_WIDTH, MAX_DEPTH_LEVELS } from './constants';
import { useJsonTreeActions } from './hooks/useJsonTreeActions';

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
  onCreateTool?: (jsonPath: string, value: any) => void;
}

// ============================================
// Utils
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
  onCreateTool,
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

  const maxScrollIndex = useMemo(() => {
    if (containerHeight === 0) return 0;
    const fullyVisibleCount = Math.floor(containerHeight / ROW_HEIGHT);
    // Allow scrolling until the last item is fully visible at the bottom
    // +1 for a bit of bottom breathing room
    return Math.max(0, flatNodes.length - fullyVisibleCount + 1);
  }, [containerHeight, flatNodes.length]);

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
  }, [
    selectedPath,
    flatNodes,
    handleSelect,
    handleToggle,
    scrollIndex,
    visibleCount,
  ]);

  const handleContextMenu = useCallback(
    (
      e: React.MouseEvent,
      path: string,
      value: JsonValue,
      anchorElement?: HTMLElement
    ) => {
      if (!anchorElement) return;
      const rect = anchorElement.getBoundingClientRect();
      setContextMenu(prev => {
        if (prev.visible && prev.path === path) {
          return { ...prev, visible: false };
        }
        return {
          visible: true,
          x: rect.right,
          y: rect.bottom + 4,
          path,
          value,
          anchorElement,
          offsetX: rect.width,
          offsetY: rect.height + 4,
          align: 'right',
        };
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
        fontSize: 14,
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
                configuredAccessMap={configuredAccessMap}
                isContextMenuOpen={
                  contextMenu.visible && contextMenu.path === node.path
                }
                onOpenDocument={onOpenDocument}
              />
            </div>
          ))}
        </div>

        {/* Custom Discrete Scrollbar */}
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
        onCreateTool={onCreateTool}
      />
    </div>
  );
}
