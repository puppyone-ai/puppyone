'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ContentType } from '../finder/items';

// === Types ===

export interface MillerColumnItem {
  id: string;
  name: string;
  type: ContentType;
}

export interface MillerColumnsViewProps {
  /** Current path from URL (folder chain) */
  currentPath: { id: string; name: string }[];
  /** Items at the current (last) folder */
  currentItems: MillerColumnItem[];
  /** Load children for a folder (null = root) */
  onLoadChildren: (folderId: string | null) => Promise<MillerColumnItem[]>;
  /** Navigate to item - updates URL */
  onNavigate?: (item: MillerColumnItem, pathToItem: string[]) => void;
  /** Create new item in folder */
  onCreateClick?: (e: React.MouseEvent, parentId: string | null) => void;
  /** Loading state */
  loading?: boolean;
}

// === Icons ===

const FolderIcon = () => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
    <path
      d='M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z'
      fill='currentColor'
      fillOpacity='0.15'
      stroke='currentColor'
      strokeWidth='1.5'
    />
  </svg>
);

const JsonIcon = () => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
    <rect x='3' y='3' width='18' height='18' rx='2' stroke='currentColor' strokeWidth='1.5' fill='currentColor' fillOpacity='0.08' />
    <path d='M3 9H21' stroke='currentColor' strokeWidth='1.5' />
    <path d='M9 3V21' stroke='currentColor' strokeWidth='1.5' />
  </svg>
);

const MarkdownIcon = () => (
  <svg width='16' height='16' viewBox='0 0 24 24' fill='none'>
    <path
      d='M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z'
      stroke='currentColor'
      strokeWidth='1.5'
      fill='currentColor'
      fillOpacity='0.08'
    />
    <path d='M14 2V8H20' stroke='currentColor' strokeWidth='1.5' />
    <path d='M8 13H16' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
    <path d='M8 17H12' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
  </svg>
);

const ChevronRightIcon = () => (
  <svg width='12' height='12' viewBox='0 0 24 24' fill='none'>
    <path d='M9 6L15 12L9 18' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
  </svg>
);

const PlusIcon = () => (
  <svg width='14' height='14' viewBox='0 0 24 24' fill='none'>
    <path d='M12 5V19M5 12H19' stroke='currentColor' strokeWidth='2' strokeLinecap='round' />
  </svg>
);

// === Helper ===

function getIcon(type: ContentType) {
  switch (type) {
    case 'folder':
      return <FolderIcon />;
    case 'markdown':
      return <MarkdownIcon />;
    default:
      return <JsonIcon />;
  }
}

function getIconColor(type: ContentType) {
  switch (type) {
    case 'folder':
      return '#a1a1aa';
    case 'markdown':
      return '#60a5fa';
    default:
      return '#34d399';
  }
}

// === Column Component ===

interface ColumnProps {
  items: MillerColumnItem[];
  selectedId?: string;
  onItemClick: (item: MillerColumnItem) => void;
  onCreateClick?: (e: React.MouseEvent) => void;
  loading?: boolean;
}

function Column({ items, selectedId, onItemClick, onCreateClick, loading }: ColumnProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [createHovered, setCreateHovered] = useState(false);

  return (
    <div style={{
      width: 220,
      minWidth: 220,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      borderRight: '1px solid rgba(255,255,255,0.08)',
    }}>
      {/* Items */}
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 0' }}>
        {loading ? (
          <div style={{
            padding: '6px 12px',
            color: '#666',
            fontSize: 13,
          }}>
            Loading...
          </div>
        ) : (
          <>
            {items.map(item => {
              const isSelected = selectedId === item.id;
              const isHovered = hoveredId === item.id;
              const isFolder = item.type === 'folder';

              return (
                <div
                  key={item.id}
                  onClick={() => onItemClick(item)}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 28,
                    padding: '0 8px',
                    margin: '0 4px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(255,255,255,0.08)' : isHovered ? 'rgba(255,255,255,0.04)' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  {/* Icon */}
                  <div style={{ color: getIconColor(item.type), flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    {getIcon(item.type)}
                  </div>

                  {/* Name */}
                  <div style={{
                    flex: 1,
                    fontSize: 13,
                    color: isSelected ? '#fff' : '#a1a1aa',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {item.name}
                  </div>

                  {/* Chevron for folders */}
                  {isFolder && (
                    <div style={{ color: '#525252', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                      <ChevronRightIcon />
                    </div>
                  )}
                </div>
              );
            })}

            {/* Create button */}
            {onCreateClick && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateClick(e);
                }}
                onMouseEnter={() => setCreateHovered(true)}
                onMouseLeave={() => setCreateHovered(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 28,
                  padding: '0 8px',
                  margin: '4px 4px 0 4px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: createHovered ? 'rgba(255,255,255,0.04)' : 'transparent',
                  borderTop: items.length > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  paddingTop: items.length > 0 ? 4 : 0,
                  marginTop: items.length > 0 ? 4 : 0,
                  transition: 'background 0.1s',
                }}
              >
                <div style={{ color: '#525252', display: 'flex', alignItems: 'center' }}>
                  <PlusIcon />
                </div>
                <div style={{
                  fontSize: 13,
                  color: createHovered ? '#a1a1aa' : '#525252',
                  transition: 'color 0.1s',
                }}>
                  New...
                </div>
              </div>
            )}

            {/* Empty state */}
            {items.length === 0 && !onCreateClick && (
              <div style={{
                padding: '6px 12px',
                color: '#666',
                fontSize: 13,
              }}>
                Empty
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// === Main Component ===

/**
 * MillerColumnsView - 简化版受控组件
 * 
 * 架构原则：
 * 1. URL 是唯一的 source of truth
 * 2. currentPath 和 currentItems 由父组件从 URL 解析并传入
 * 3. 组件内部只缓存中间列的数据，避免重复加载
 * 4. 点击任何项目都通过 onNavigate 更新 URL
 */

interface ColumnCache {
  [parentId: string]: MillerColumnItem[];
}

export function MillerColumnsView({
  currentPath,
  currentItems,
  onLoadChildren,
  onNavigate,
  onCreateClick,
  loading: externalLoading,
}: MillerColumnsViewProps) {
  // 缓存中间列数据（key: parentId, value: items）
  const [columnCache, setColumnCache] = useState<ColumnCache>({});
  const [loadingColumns, setLoadingColumns] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const pathKey = currentPath.map(p => p.id).join('/');

  // 加载并缓存列数据
  const loadColumn = useCallback(async (parentId: string | null) => {
    const cacheKey = parentId ?? '__root__';
    if (columnCache[cacheKey] || loadingColumns.has(cacheKey)) return;
    
    setLoadingColumns(prev => new Set(prev).add(cacheKey));
    try {
      const items = await onLoadChildren(parentId);
      setColumnCache(prev => ({ ...prev, [cacheKey]: items }));
    } catch (err) {
      console.error('Failed to load column:', parentId, err);
      setColumnCache(prev => ({ ...prev, [cacheKey]: [] }));
    } finally {
      setLoadingColumns(prev => {
        const next = new Set(prev);
        next.delete(cacheKey);
        return next;
      });
    }
  }, [onLoadChildren, columnCache, loadingColumns]);

  // 初始化：加载 root 和路径上的所有列
  useEffect(() => {
    loadColumn(null); // root
    currentPath.forEach((_, i) => {
      if (i < currentPath.length - 1) { // 不加载最后一个，因为 currentItems 已提供
        loadColumn(currentPath[i].id);
      }
    });
  }, [pathKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 路径变化时滚动到右侧
  useEffect(() => {
    if (containerRef.current) {
      requestAnimationFrame(() => {
        containerRef.current?.scrollTo({ left: containerRef.current.scrollWidth, behavior: 'smooth' });
      });
    }
  }, [pathKey]);

  // 构建列数据（从缓存 + currentItems）
  const columns = (() => {
    const result: { parentId: string | null; items: MillerColumnItem[]; selectedId?: string }[] = [];
    
    // Root column
    result.push({
      parentId: null,
      items: columnCache['__root__'] || [],
      selectedId: currentPath[0]?.id,
    });
    
    // 路径上的每个文件夹都产生一个子列
    for (let i = 0; i < currentPath.length; i++) {
      const folder = currentPath[i];
      const isLast = i === currentPath.length - 1;
      const nextFolder = currentPath[i + 1];
      
      result.push({
        parentId: folder.id,
        items: isLast ? currentItems : (columnCache[folder.id] || []),
        selectedId: nextFolder?.id,
      });
    }
    
    return result;
  })();

  // 点击处理：计算新路径并通知父组件
  const handleItemClick = useCallback((columnIndex: number, item: MillerColumnItem) => {
    // columnIndex 0 = root, 1 = first path folder's children, etc.
    const pathToItem = currentPath.slice(0, columnIndex).map(p => p.id);
    pathToItem.push(item.id);
    onNavigate?.(item, pathToItem);
  }, [currentPath, onNavigate]);

  const isLoading = externalLoading || loadingColumns.has('__root__');

  if (isLoading && columns[0].items.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#525252',
        fontSize: 13,
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        margin: 8,
        marginTop: 0,
      }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'spin 1s linear infinite', marginRight: 8 }}>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="28" strokeDashoffset="8" />
        </svg>
        Loading...
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        height: '100%',
        overflow: 'auto',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        margin: 8,
        marginTop: 0,
      }}
    >
      {columns.map((col, index) => (
        <Column
          key={col.parentId ?? 'root'}
          items={col.items}
          selectedId={col.selectedId}
          onItemClick={(item) => handleItemClick(index, item)}
          onCreateClick={onCreateClick ? (e) => {
            e.stopPropagation();
            e.preventDefault();
            onCreateClick(e, col.parentId);
          } : undefined}
          loading={loadingColumns.has(col.parentId ?? '__root__')}
        />
      ))}

      {columns.length === 1 && columns[0].items.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 13 }}>
          No items yet
        </div>
      )}
    </div>
  );
}
