'use client';

import { useState, useRef, useEffect } from 'react';

// === Types ===

export interface ColumnViewItem {
  id: string;
  name: string;
  type: 'folder' | 'file';
  description?: string;
  children?: ColumnViewItem[];
}

export interface ColumnViewProps {
  /** 树形数据 */
  items: ColumnViewItem[];
  /** 当前选中的 item */
  selectedId?: string;
  /** 选中回调 */
  onSelect?: (item: ColumnViewItem) => void;
  /** 双击/进入回调 */
  onEnter?: (item: ColumnViewItem) => void;
  /** 创建回调 */
  onCreateClick?: (e: React.MouseEvent) => void;
  /** 渲染预览内容 */
  renderPreview?: (item: ColumnViewItem | null) => React.ReactNode;
  loading?: boolean;
}

// === Icons ===

const FolderIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    <path
      d='M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z'
      fill='currentColor'
      fillOpacity='0.15'
      stroke='currentColor'
      strokeWidth='1.5'
    />
  </svg>
);

const FileIcon = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    <rect
      x='3'
      y='3'
      width='18'
      height='18'
      rx='2'
      stroke='currentColor'
      strokeWidth='1.5'
      fill='currentColor'
      fillOpacity='0.08'
    />
    <path d='M3 9H21' stroke='currentColor' strokeWidth='1.5' />
    <path d='M9 3V21' stroke='currentColor' strokeWidth='1.5' />
  </svg>
);

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <svg
    width='12'
    height='12'
    viewBox='0 0 24 24'
    fill='none'
    style={{
      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.15s',
    }}
  >
    <path
      d='M9 6L15 12L9 18'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);

// === Sub Components ===

interface SidebarItemProps {
  item: ColumnViewItem;
  depth: number;
  selectedId?: string;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (item: ColumnViewItem) => void;
  onEnter?: (item: ColumnViewItem) => void;
}

function SidebarItem({
  item,
  depth,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
  onEnter,
}: SidebarItemProps) {
  const isExpanded = expandedIds.has(item.id);
  const isSelected = selectedId === item.id;
  const hasChildren = item.children && item.children.length > 0;

  return (
    <>
      <div
        onClick={() => onSelect(item)}
        onDoubleClick={() => onEnter?.(item)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          paddingLeft: 12 + depth * 16,
          cursor: 'pointer',
          background: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
          borderLeft: isSelected ? '2px solid #3b82f6' : '2px solid transparent',
          transition: 'all 0.1s',
        }}
        onMouseEnter={e =>
          !isSelected &&
          (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')
        }
        onMouseLeave={e =>
          !isSelected && (e.currentTarget.style.background = 'transparent')
        }
      >
        {/* Expand/Collapse Toggle */}
        {hasChildren ? (
          <div
            onClick={e => {
              e.stopPropagation();
              onToggle(item.id);
            }}
            style={{
              width: 16,
              height: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#71717a',
            }}
          >
            <ChevronIcon expanded={isExpanded} />
          </div>
        ) : (
          <div style={{ width: 16 }} />
        )}

        {/* Icon */}
        <div
          style={{
            color: item.type === 'folder' ? '#a1a1aa' : '#34d399',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {item.type === 'folder' ? <FolderIcon /> : <FileIcon />}
        </div>

        {/* Name */}
        <div
          style={{
            flex: 1,
            fontSize: 13,
            color: isSelected ? '#fff' : '#d4d4d8',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {item.name}
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {item.children!.map(child => (
            <SidebarItem
              key={child.id}
              item={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              onEnter={onEnter}
            />
          ))}
        </div>
      )}
    </>
  );
}

// === Default Preview ===

function DefaultPreview({ item }: { item: ColumnViewItem | null }) {
  if (!item) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#52525b',
          fontSize: 14,
        }}
      >
        Select an item to preview
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            color: item.type === 'folder' ? '#a1a1aa' : '#34d399',
            fontSize: 32,
          }}
        >
          {item.type === 'folder' ? <FolderIcon size={32} /> : <FileIcon size={32} />}
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>
            {item.name}
          </div>
          <div style={{ fontSize: 13, color: '#71717a', marginTop: 2 }}>
            {item.type === 'folder' ? 'Folder' : 'Context'}
          </div>
        </div>
      </div>

      {item.description && (
        <div style={{ fontSize: 14, color: '#a1a1aa', lineHeight: 1.6 }}>
          {item.description}
        </div>
      )}
    </div>
  );
}

// === Main Component ===

export function ColumnView({
  items,
  selectedId: controlledSelectedId,
  onSelect,
  onEnter,
  onCreateClick,
  renderPreview,
  loading,
}: ColumnViewProps) {
  // Internal state for selection if not controlled
  const [internalSelectedId, setInternalSelectedId] = useState<string>();
  const selectedId = controlledSelectedId ?? internalSelectedId;

  // Expanded folders state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Sidebar resize
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const isResizing = useRef(false);

  // Find selected item
  const findItem = (
    items: ColumnViewItem[],
    id: string
  ): ColumnViewItem | null => {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.children) {
        const found = findItem(item.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const selectedItem = selectedId ? findItem(items, selectedId) : null;

  // Handlers
  const handleToggle = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelect = (item: ColumnViewItem) => {
    setInternalSelectedId(item.id);
    onSelect?.(item);
  };

  // Resize handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.max(200, Math.min(500, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  if (loading) {
    return <div style={{ color: '#666', padding: 16 }}>Loading...</div>;
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 400 }}>
      {/* Sidebar */}
      <div
        style={{
          width: sidebarWidth,
          minWidth: sidebarWidth,
          borderRight: '1px solid rgba(255,255,255,0.06)',
          overflow: 'auto',
        }}
      >
        <div style={{ padding: '8px 0' }}>
          {items.map(item => (
            <SidebarItem
              key={item.id}
              item={item}
              depth={0}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggle={handleToggle}
              onSelect={handleSelect}
              onEnter={onEnter}
            />
          ))}

          {/* Create button */}
          {onCreateClick && (
            <div
              onClick={onCreateClick}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                paddingLeft: 28,
                cursor: 'pointer',
                color: '#52525b',
                fontSize: 13,
                marginTop: 8,
                borderTop: '1px solid rgba(255,255,255,0.04)',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#a1a1aa')}
              onMouseLeave={e => (e.currentTarget.style.color = '#52525b')}
            >
              <svg width='14' height='14' viewBox='0 0 24 24' fill='none'>
                <path
                  d='M12 6V18M6 12H18'
                  stroke='currentColor'
                  strokeWidth='1.5'
                  strokeLinecap='round'
                />
              </svg>
              New...
            </div>
          )}
        </div>
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={() => {
          isResizing.current = true;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        style={{
          width: 4,
          cursor: 'col-resize',
          background: 'transparent',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e =>
          (e.currentTarget.style.background = 'rgba(59, 130, 246, 0.3)')
        }
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      />

      {/* Preview Panel */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {renderPreview ? (
          renderPreview(selectedItem)
        ) : (
          <DefaultPreview item={selectedItem} />
        )}
      </div>
    </div>
  );
}


