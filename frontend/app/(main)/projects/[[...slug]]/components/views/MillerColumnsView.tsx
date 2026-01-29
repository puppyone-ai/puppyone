'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ContentType } from '../finder/items';
import type { AgentResource } from './GridView';
import { ItemActionMenu } from './ItemActionMenu';
import { getNodeTypeConfig, isSyncedType, LockIcon } from '@/lib/nodeTypeConfig';

// === Types ===

export interface MillerColumnItem {
  id: string;
  name: string;
  type: ContentType;
  // 同步相关字段
  is_synced?: boolean;
  sync_source?: string | null;
  sync_url?: string | null;
  last_synced_at?: string | null;
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
  /** Rename item */
  onRename?: (id: string, currentName: string) => void;
  /** Delete item */
  onDelete?: (id: string, name: string) => void;
  /** Duplicate item */
  onDuplicate?: (id: string) => void;
  /** Refresh synced item */
  onRefresh?: (id: string) => void;
  /** Loading state */
  loading?: boolean;
  /** Agent resources for highlighting */
  agentResources?: AgentResource[];
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

function getIcon(type: string) {
  const config = getNodeTypeConfig(type);
  switch (config.renderAs) {
    case 'folder':
      return <FolderIcon />;
    case 'markdown':
      return <MarkdownIcon />;
    default:
      return <JsonIcon />;
  }
}

function getIconColor(type: string) {
  const config = getNodeTypeConfig(type);
  return config.color;
}

// === Column Component ===

interface ColumnProps {
  items: MillerColumnItem[];
  selectedId?: string;
  onItemClick: (item: MillerColumnItem) => void;
  onCreateClick?: (e: React.MouseEvent) => void;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  onRefresh?: (id: string) => void;
  loading?: boolean;
  resourceMap: Map<string, AgentResource>;
}

function Column({ items, selectedId, onItemClick, onCreateClick, onRename, onDelete, onDuplicate, onRefresh, loading, resourceMap }: ColumnProps) {
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
            fontSize: 14,
          }}>
            Loading...
          </div>
        ) : (
          <>
            {items.map(item => {
              const isSelected = selectedId === item.id;
              const isHovered = hoveredId === item.id;
              const typeConfig = getNodeTypeConfig(item.type);
              const isFolder = typeConfig.renderAs === 'folder';
              const agentResource = resourceMap.get(item.id);
              const hasAgentAccess = !!agentResource;
              const isSynced = item.is_synced || isSyncedType(item.type);
              const BadgeIcon = typeConfig.badgeIcon;

              return (
                <div
                  key={item.id}
                  onClick={() => onItemClick(item)}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  draggable={!typeConfig.isReadOnly}
                  onDragStart={(e) => {
                    if (typeConfig.isReadOnly) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData('application/x-puppyone-node', JSON.stringify({
                      id: item.id,
                      name: item.name,
                      type: item.type
                    }));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    height: 32,
                    padding: '0 8px',
                    margin: '0 4px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    // 橙色系
                    background: hasAgentAccess
                      ? isSelected 
                        ? 'rgba(249, 115, 22, 0.15)' 
                        : isHovered 
                          ? 'rgba(249, 115, 22, 0.1)' 
                          : 'rgba(249, 115, 22, 0.05)'
                      : isSelected 
                        ? 'rgba(255,255,255,0.08)' 
                        : isHovered 
                          ? 'rgba(255,255,255,0.04)' 
                          : 'transparent',
                    // 左边橙色边条
                    borderLeft: hasAgentAccess 
                      ? '2px solid rgba(249, 115, 22, 0.6)' 
                      : '2px solid transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  {/* Icon with Sync Badge */}
                  <div style={{ 
                    color: getIconColor(item.type), 
                    flexShrink: 0, 
                    display: 'flex', 
                    alignItems: 'center',
                    position: 'relative',
                  }}>
                    {getIcon(item.type)}
                    {/* Sync Badge (SaaS Logo) */}
                    {BadgeIcon && (
                      <div style={{
                        position: 'absolute',
                        bottom: -3,
                        right: -5,
                        background: '#18181b',
                        borderRadius: 4,
                        padding: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <BadgeIcon size={12} />
                      </div>
                    )}
                  </div>

                  {/* Name */}
                  <div style={{
                    flex: 1,
                    fontSize: 14,
                    color: isSelected ? '#fff' : '#a1a1aa',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {item.name}
                  </div>

                  {/* Action Menu */}
                  {(onRename || onDelete || onDuplicate || (isSyncedType(item.type) && onRefresh)) && (
                    <ItemActionMenu
                      itemId={item.id}
                      itemName={item.name}
                      itemType={item.type}
                      onRename={onRename}
                      onDelete={onDelete}
                      onDuplicate={onDuplicate}
                      onRefresh={isSyncedType(item.type) ? onRefresh : undefined}
                      syncUrl={item.sync_url}
                      visible={isHovered}
                      compact
                      position="bottom-left"
                    />
                  )}

                  {/* Read-only Lock Icon for synced items */}
                  {typeConfig.isReadOnly && (
                    <div style={{ 
                      flexShrink: 0,
                      color: '#525252',
                      display: 'flex',
                      alignItems: 'center',
                    }}>
                      <LockIcon size={10} />
                    </div>
                  )}

                  {/* Agent Access Tag */}
                  {hasAgentAccess && (
                    <div style={{ 
                      flexShrink: 0,
                      padding: '1px 5px',
                      borderRadius: 3,
                      background: agentResource?.terminalReadonly ? 'rgba(100, 100, 100, 0.25)' : 'rgba(249, 115, 22, 0.2)',
                      fontSize: 10,
                      fontWeight: 500,
                      color: agentResource?.terminalReadonly ? '#a1a1aa' : '#fb923c',
                    }}>
                      {agentResource?.terminalReadonly ? 'View' : 'Edit'}
                    </div>
                  )}

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
                  height: 32,
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
                  fontSize: 14,
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
                fontSize: 14,
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

interface ColumnCache {
  [parentId: string]: MillerColumnItem[];
}

export function MillerColumnsView({
  currentPath,
  currentItems,
  onLoadChildren,
  onNavigate,
  onCreateClick,
  onRename,
  onDelete,
  onDuplicate,
  onRefresh,
  loading: externalLoading,
  agentResources,
}: MillerColumnsViewProps) {
  // 缓存中间列数据（key: parentId, value: items）
  const [columnCache, setColumnCache] = useState<ColumnCache>({});
  const [loadingColumns, setLoadingColumns] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const pathKey = currentPath.map(p => p.id).join('/');

  // Create a map for quick lookup
  const resourceMap = new Map(agentResources?.map(r => [r.nodeId, r]) ?? []);

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
        fontSize: 14,
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
          onRename={onRename}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onRefresh={onRefresh}
          loading={loadingColumns.has(col.parentId ?? '__root__')}
          resourceMap={resourceMap}
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
