'use client';

import { useState, useRef, useCallback } from 'react';

// 字号规范：13px / 12px / 11px 三种

export const FONT = {
  primary: 13,
  secondary: 12,
  tertiary: 11,
};

// Tool Type 配置 - Linear style: 首字母大写
export const TOOL_TYPE_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  get_data_schema: {
    label: 'Schema',
    color: '#67e8f9',
    bg: 'rgba(6, 182, 212, 0.15)',
  },
  query_data: {
    label: 'Query',
    color: '#60a5fa',
    bg: 'rgba(59, 130, 246, 0.15)',
  },
  get_all_data: {
    label: 'Get All',
    color: '#60a5fa',
    bg: 'rgba(59, 130, 246, 0.15)',
  },
  preview: {
    label: 'Preview',
    color: '#a78bfa',
    bg: 'rgba(139, 92, 246, 0.15)',
  },
  select: { label: 'Select', color: '#a78bfa', bg: 'rgba(139, 92, 246, 0.15)' },
  create: { label: 'Create', color: '#34d399', bg: 'rgba(16, 185, 129, 0.15)' },
  update: { label: 'Update', color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.15)' },
  delete: { label: 'Delete', color: '#f87171', bg: 'rgba(239, 68, 68, 0.15)' },
};

export type ToolItem = {
  id: number;
  tool_id?: number; // for bound tools
  name: string;
  type: string;
  description?: string;
  path?: string;
};

type ToolsTableProps = {
  tools: ToolItem[];
  // 是否显示 Path 列
  showPath?: boolean;
  // 是否支持多选
  selectable?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  // 删除/移除操作
  onRemove?: (id: number) => void;
  removeIcon?: 'delete' | 'remove';
  // hover 状态
  hoveredId?: number | null;
  onHover?: (id: number | null) => void;
};

export function ToolsTable({
  tools,
  showPath = false,
  selectable = false,
  selectedIds = new Set(),
  onToggleSelect,
  onRemove,
  removeIcon = 'delete',
  hoveredId: externalHoveredId,
  onHover: externalOnHover,
}: ToolsTableProps) {
  // 内部 hover 状态（如果外部没有传入）
  const [internalHoveredId, setInternalHoveredId] = useState<number | null>(
    null
  );
  const hoveredId =
    externalHoveredId !== undefined ? externalHoveredId : internalHoveredId;
  const setHoveredId = externalOnHover || setInternalHoveredId;

  // 列宽状态
  const [columnWidths, setColumnWidths] = useState(
    showPath
      ? { name: 35, description: 40, path: 25 }
      : { name: 45, description: 55 }
  );
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // 拖拽调整列宽
  const handleMouseDown = useCallback(
    (column: string, e: React.MouseEvent) => {
      e.preventDefault();
      setDraggingColumn(column);

      const startX = e.clientX;
      const startWidths = { ...columnWidths };

      const handleMouseMove = (e: MouseEvent) => {
        if (!headerRef.current) return;
        const headerRect = headerRef.current.getBoundingClientRect();
        const fixedWidth = 40 + 70 + 36; // index, type, actions
        const flexAreaWidth = headerRect.width - fixedWidth;
        const deltaX = e.clientX - startX;
        const deltaPercent = (deltaX / flexAreaWidth) * 100;

        if (showPath) {
          if (column === 'name') {
            const newName = Math.min(
              60,
              Math.max(15, (startWidths as any).name + deltaPercent)
            );
            const diff = newName - (startWidths as any).name;
            setColumnWidths({
              name: newName,
              description: Math.max(
                15,
                (startWidths as any).description - diff
              ),
              path: (startWidths as any).path,
            });
          } else if (column === 'description') {
            const newDesc = Math.min(
              60,
              Math.max(15, (startWidths as any).description + deltaPercent)
            );
            const diff = newDesc - (startWidths as any).description;
            setColumnWidths({
              name: (startWidths as any).name,
              description: newDesc,
              path: Math.max(15, (startWidths as any).path - diff),
            });
          }
        } else {
          const newName = Math.min(
            70,
            Math.max(25, (startWidths as any).name + deltaPercent)
          );
          setColumnWidths({ name: newName, description: 100 - newName });
        }
      };

      const handleMouseUp = () => {
        setDraggingColumn(null);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [columnWidths, showPath]
  );

  // Grid template
  const gridTemplate = showPath
    ? `40px 70px ${(columnWidths as any).name}fr ${(columnWidths as any).description}fr ${(columnWidths as any).path}fr 36px`
    : `40px 70px ${(columnWidths as any).name}fr ${(columnWidths as any).description}fr 36px`;

  if (tools.length === 0) {
    return null;
  }

  return (
    <div>
      {/* Table Header */}
      <div
        ref={headerRef}
        style={{
          display: 'grid',
          gridTemplateColumns: gridTemplate,
          padding: '8px 24px',
          borderBottom: '1px solid #141416',
          fontSize: FONT.tertiary,
          fontWeight: 500,
          color: '#3f3f46',
          letterSpacing: '0.3px',
          textTransform: 'uppercase',
          userSelect: draggingColumn ? 'none' : 'auto',
        }}
      >
        <div style={{ textAlign: 'center' }}>#</div>
        <div>Type</div>
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Name
          <ResizeHandle
            active={draggingColumn === 'name'}
            onMouseDown={e => handleMouseDown('name', e)}
          />
        </div>
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Description
          {showPath && (
            <ResizeHandle
              active={draggingColumn === 'description'}
              onMouseDown={e => handleMouseDown('description', e)}
            />
          )}
        </div>
        {showPath && <div>Path</div>}
        <div></div>
      </div>

      {/* Table Rows */}
      {tools.map((tool, index) => {
        const toolId = tool.tool_id || tool.id;
        const isHovered = hoveredId === toolId;
        const isSelected = selectedIds.has(tool.id);
        const typeConfig = TOOL_TYPE_CONFIG[tool.type] || {
          label: tool.type?.toUpperCase() || 'TOOL',
          color: '#71717a',
          bg: 'rgba(113,113,122,0.15)',
        };

        return (
          <div
            key={toolId}
            onMouseEnter={() => setHoveredId(toolId)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={() => selectable && onToggleSelect?.(tool.id)}
            style={{
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              padding: '10px 24px',
              alignItems: 'center',
              cursor: selectable ? 'pointer' : 'default',
              background: isSelected
                ? 'rgba(59, 130, 246, 0.08)'
                : isHovered
                  ? '#0f0f11'
                  : 'transparent',
              borderLeft: isSelected
                ? '2px solid #3b82f6'
                : '2px solid transparent',
              transition: 'background 0.1s',
            }}
          >
            {/* # / Checkbox */}
            <div
              style={{
                textAlign: 'center',
                color: '#3f3f46',
                fontSize: FONT.secondary,
              }}
            >
              {selectable && (isHovered || isSelected) ? (
                <div
                  style={{
                    width: 14,
                    height: 14,
                    margin: '0 auto',
                    border: isSelected ? 'none' : '1.5px solid #3f3f46',
                    borderRadius: 3,
                    background: isSelected ? '#3b82f6' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSelected && (
                    <svg width='8' height='8' viewBox='0 0 10 10' fill='none'>
                      <path
                        d='M2 5l2.5 2.5L8 3'
                        stroke='#fff'
                        strokeWidth='1.5'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                      />
                    </svg>
                  )}
                </div>
              ) : (
                index + 1
              )}
            </div>

            {/* Type Badge */}
            <div>
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: FONT.tertiary,
                  fontWeight: 600,
                  color: typeConfig.color,
                  background: typeConfig.bg,
                }}
              >
                {typeConfig.label}
              </span>
            </div>

            {/* Name */}
            <div
              style={{
                fontSize: FONT.primary,
                fontWeight: 500,
                color: isHovered ? '#fff' : '#e2e8f0',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                paddingRight: 12,
              }}
            >
              {tool.name}
            </div>

            {/* Description */}
            <div
              style={{
                fontSize: FONT.secondary,
                color: '#525252',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                paddingRight: 12,
              }}
            >
              {tool.description || '—'}
            </div>

            {/* Path */}
            {showPath && (
              <div
                style={{
                  fontSize: FONT.secondary,
                  color: '#3f3f46',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  paddingRight: 12,
                }}
                title={tool.path}
              >
                {tool.path || '—'}
              </div>
            )}

            {/* Actions */}
            <div
              style={{ opacity: isHovered ? 1 : 0, transition: 'opacity 0.1s' }}
            >
              {onRemove && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onRemove(toolId);
                  }}
                  style={{
                    width: 24,
                    height: 24,
                    background: 'none',
                    border: 'none',
                    color: '#3f3f46',
                    cursor: 'pointer',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#3f3f46')}
                >
                  {removeIcon === 'delete' ? (
                    <svg
                      width='14'
                      height='14'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                    >
                      <path d='M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' />
                    </svg>
                  ) : (
                    <svg
                      width='14'
                      height='14'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                    >
                      <path d='M18 6L6 18M6 6l12 12' />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Resize Handle 组件
function ResizeHandle({
  active,
  onMouseDown,
}: {
  active: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: 8,
        cursor: 'col-resize',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 1,
          height: 14,
          background: active ? '#3b82f6' : '#1f1f22',
          transition: 'background 0.15s',
        }}
      />
    </div>
  );
}

// 通用的空状态组件
export function ToolsEmptyState({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      style={{
        padding: '40px 20px',
        textAlign: 'center',
        color: '#3f3f46',
        fontSize: FONT.primary,
      }}
    >
      <svg
        width='40'
        height='40'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.5'
        style={{ opacity: 0.4, margin: '0 auto 12px' }}
      >
        <path d='M4 19.5A2.5 2.5 0 0 1 6.5 17H20' />
        <path d='M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' />
      </svg>
      <div style={{ marginBottom: actionLabel ? 8 : 0 }}>{message}</div>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          style={{
            fontSize: FONT.secondary,
            color: '#60a5fa',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          + {actionLabel}
        </button>
      )}
    </div>
  );
}
