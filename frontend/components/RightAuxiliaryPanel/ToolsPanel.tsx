'use client';

import React, { useState } from 'react';
import {
  type McpToolPermissions,
  type McpToolType,
  type McpToolDefinition,
  type Tool,
} from '../../lib/mcpApi';
import { FONT, TOOL_TYPE_CONFIG } from '../../lib/toolConfig';
import { TOOL_ICONS } from '../../lib/toolIcons';

// Access Point 类型定义
export interface AccessPoint {
  id: string;
  path: string;
  permissions: McpToolPermissions;
}

// 保存结果类型
export interface SaveToolsResult {
  tools: Tool[];
  count: number;
}

interface ToolsPanelProps {
  accessPoints: AccessPoint[];
  setAccessPoints: React.Dispatch<React.SetStateAction<AccessPoint[]>>;
  activeBaseName?: string;
  activeTableName?: string; // 新增：用于显示来源信息
  onClose: () => void;
  onSaveTools: (toolsDefinition: Record<string, McpToolDefinition>) => void; // 保存 Tools
  isSaving: boolean;
  saveError: string | null;
  savedResult: SaveToolsResult | null;
  setSavedResult: React.Dispatch<React.SetStateAction<SaveToolsResult | null>>;
  onViewAllMcp?: () => void; // 跳转到 MCP 管理界面
}

// Tool Definition configuration
const TOOL_DEFS = [
  { backendId: 'get_data_schema' as McpToolType, label: 'Get Schema' },
  { backendId: 'query_data' as McpToolType, label: 'Query' },
  { backendId: 'get_all_data' as McpToolType, label: 'Get All' },
  // { backendId: 'preview' as McpToolType, label: 'Preview' },
  // { backendId: 'select' as McpToolType, label: 'Select' },
  { backendId: 'create' as McpToolType, label: 'Create' },
  { backendId: 'update' as McpToolType, label: 'Update' },
  { backendId: 'delete' as McpToolType, label: 'Delete' },
];

export function ToolsPanel({
  accessPoints,
  setAccessPoints,
  activeBaseName,
  activeTableName,
  onClose,
  onSaveTools,
  isSaving,
  saveError,
  savedResult,
  setSavedResult,
  onViewAllMcp,
}: ToolsPanelProps) {
  // 收起的 path 列表 (默认全部展开)
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());

  // Tool 定义编辑状态
  const [toolsDefinitionEdits, setToolsDefinitionEdits] = useState<
    Record<string, { name: string; description: string }>
  >({});
  const [editingToolField, setEditingToolField] = useState<{
    toolId: string;
    field: 'name' | 'description';
  } | null>(null);

  // Track hovered row for styling
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // 删除确认状态
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // 全局序号 (用于列表显示)
  let globalIndex = 0;

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 46,
          padding: '0 16px',
          borderBottom: '1px solid #1a1a1c',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
          background: '#0f0f11',
        }}
      >
        {/* 收起按钮 */}
        <button
          onClick={onClose}
          style={{
            width: 28,
            height: 28,
            background: 'transparent',
            border: 'none',
            color: '#6b7280',
            cursor: 'pointer',
            padding: 0,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#e2e8f0')}
          onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
          title='Collapse sidebar'
        >
          <svg
            width='16'
            height='16'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
          >
            <path d='M13 17l5-5-5-5M6 17l5-5-5-5' />
          </svg>
        </button>

        <div
          style={{ fontSize: FONT.primary, fontWeight: 600, color: '#e2e8f0' }}
        >
          Tools
        </div>
      </div>

      {/* Content List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {accessPoints.length === 0 ? (
          <div
            style={{
              padding: '40px 20px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                margin: '0 auto 10px',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                width='18'
                height='18'
                viewBox='0 0 24 24'
                fill='none'
                stroke='#525252'
                strokeWidth='1.5'
              >
                <path d='M12 5v14M5 12h14' strokeLinecap='round' />
              </svg>
            </div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 4 }}>
              No tools configured
            </div>
            <div style={{ fontSize: 11, color: '#525252' }}>
              Click the 🐾 icon on JSON nodes to expose capabilities
            </div>
          </div>
        ) : (
          <div style={{ paddingBottom: 16 }}>
            {accessPoints.map(ap => {
              const enabledTools = TOOL_DEFS.filter(
                tool => ap.permissions[tool.backendId]
              );
              if (enabledTools.length === 0) return null;

              const pathSegments = ap.path
                ? ap.path.split('/').filter(Boolean)
                : [];
              const displayPath = ap.path || '/';
              const lastSegment =
                pathSegments.length > 0
                  ? pathSegments[pathSegments.length - 1]
                  : 'root';
              const safeName = lastSegment.replace(/[^a-zA-Z0-9_]/g, '');

              const isCollapsed = collapsedPaths.has(ap.path);
              const toggleCollapse = () => {
                setCollapsedPaths(prev => {
                  const next = new Set(prev);
                  if (next.has(ap.path)) {
                    next.delete(ap.path);
                  } else {
                    next.add(ap.path);
                  }
                  return next;
                });
              };

              return (
                <div key={ap.id}>
                  {/* Path Group Header - No Interaction */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 16px', // Reduced padding height
                      background: '#0f0f11',
                      borderBottom: '1px solid #141416',
                      position: 'sticky',
                      top: 0,
                      zIndex: 10,
                    }}
                  >
                    {/* Spacer to align with Type column (20px Index + 12px Gap) */}
                    <div style={{ width: 32, flexShrink: 0 }} />

                    <span
                      style={{
                        fontSize: FONT.tertiary, // Use FONT.tertiary (11px)
                        color: '#3f3f46', // Match darker color from LibraryView
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                      title={displayPath}
                    >
                      {displayPath}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: '#525252',
                        background: 'rgba(255,255,255,0.05)',
                        padding: '1px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {enabledTools.length}
                    </span>
                  </div>

                  {/* Tools List - 卡片式 */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '8px 12px',
                    }}
                  >
                    {enabledTools.map(tool => {
                      globalIndex++; // Increment global index for each tool
                      const typeConfig = TOOL_TYPE_CONFIG[tool.backendId] || {
                        label: tool.label,
                        color: '#9ca3af',
                        bg: 'rgba(255,255,255,0.05)',
                      };

                      const editKey = `${ap.path}::${tool.backendId}`;
                      const defaultToolName = `${tool.backendId}_${safeName}`;
                      const defaultDescription = `${tool.label} - ${activeBaseName || 'Project'}`;

                      const currentDef = toolsDefinitionEdits[editKey] || {
                        name: defaultToolName,
                        description: defaultDescription,
                      };

                      const toolFieldId = `${ap.path}::${tool.backendId}`;
                      const isEditingName =
                        editingToolField?.toolId === toolFieldId &&
                        editingToolField?.field === 'name';
                      const isEditingDesc =
                        editingToolField?.toolId === toolFieldId &&
                        editingToolField?.field === 'description';
                      const isHovered = hoveredRowId === toolFieldId;

                      return (
                        <div
                          key={tool.backendId}
                          onMouseEnter={() => setHoveredRowId(toolFieldId)}
                          onMouseLeave={() => setHoveredRowId(null)}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                            padding: '10px 16px',
                            marginBottom: 8,
                            borderRadius: 8,
                            border: '1px solid #1f1f22',
                            background: isHovered ? '#18181b' : '#131315',
                            transition: 'all 0.1s',
                          }}
                        >
                          {/* 左侧固定列：# Index */}
                          <div
                            style={{
                              width: 20,
                              textAlign: 'center',
                              color: '#3f3f46',
                              fontSize: FONT.secondary, // 12px
                              marginTop: 3, // Align with icon center
                              flexShrink: 0,
                            }}
                          >
                            {globalIndex}
                          </div>

                          {/* 右侧主内容区域 */}
                          <div
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            }}
                          >
                            {/* 第一行：图标+类型 (Badge) + 名字 + 删除按钮 */}
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                              }}
                            >
                              {/* Unified Badge: Icon + Type */}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  padding: '3px 8px 3px 6px',
                                  borderRadius: 4,
                                  fontSize: FONT.tertiary, // 11px
                                  fontWeight: 600,
                                  // 单色化逻辑：如果是 delete 则保留红色警示，否则统一使用橙色图标+灰色背景
                                  color:
                                    tool.backendId === 'delete'
                                      ? '#f87171'
                                      : '#a1a1aa', // 文字保持灰色，避免太刺眼
                                  background:
                                    tool.backendId === 'delete'
                                      ? 'rgba(127, 29, 29, 0.2)'
                                      : 'rgba(255, 255, 255, 0.06)',
                                  border:
                                    tool.backendId === 'delete'
                                      ? '1px solid rgba(248, 113, 113, 0.2)'
                                      : '1px solid rgba(255, 255, 255, 0.08)',
                                  whiteSpace: 'nowrap',
                                  flexShrink: 0,
                                }}
                              >
                                <div
                                  style={{
                                    width: 14,
                                    height: 14,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: 0.9,
                                    // 核心修改：图标颜色设为橙色（除非是 delete）
                                    color:
                                      tool.backendId === 'delete'
                                        ? 'inherit'
                                        : '#fb923c',
                                  }}
                                >
                                  {TOOL_ICONS[tool.backendId]}
                                </div>
                                <div>{typeConfig.label}</div>
                              </div>

                              {/* Name (Editable) - 占据剩余空间 */}
                              <div
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  display: 'flex',
                                  alignItems: 'center',
                                }}
                              >
                                {isEditingName ? (
                                  <input
                                    type='text'
                                    value={currentDef.name}
                                    onChange={e =>
                                      setToolsDefinitionEdits(prev => ({
                                        ...prev,
                                        [editKey]: {
                                          ...currentDef,
                                          name: e.target.value,
                                        },
                                      }))
                                    }
                                    onBlur={() => setEditingToolField(null)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter')
                                        setEditingToolField(null);
                                      if (e.key === 'Escape')
                                        setEditingToolField(null);
                                    }}
                                    autoFocus
                                    style={{
                                      width: '100%',
                                      fontSize: FONT.primary, // 13px
                                      fontWeight: 500,
                                      color: '#e2e8f0',
                                      background: '#0a0a0c',
                                      border: '1px solid #1a1a1c',
                                      borderRadius: 4,
                                      padding: '0 6px',
                                      height: 22,
                                      outline: 'none',
                                    }}
                                  />
                                ) : (
                                  <div
                                    onClick={() =>
                                      setEditingToolField({
                                        toolId: toolFieldId,
                                        field: 'name',
                                      })
                                    }
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      cursor: 'pointer',
                                      minWidth: 0,
                                      width: '100%',
                                    }}
                                    title='Click to edit name'
                                  >
                                    <span
                                      style={{
                                        fontSize: FONT.primary,
                                        fontWeight: 500,
                                        color: isHovered ? '#fff' : '#e2e8f0',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                      }}
                                    >
                                      {currentDef.name}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Delete Action - 放在第一行最右侧 */}
                              {confirmDeleteId === toolFieldId ? (
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    flexShrink: 0,
                                  }}
                                >
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      setAccessPoints(prev => {
                                        return prev
                                          .map(existingAp => {
                                            if (existingAp.path === ap.path) {
                                              const newPermissions = {
                                                ...existingAp.permissions,
                                                [tool.backendId]: false,
                                              };
                                              const hasAny =
                                                Object.values(
                                                  newPermissions
                                                ).some(Boolean);
                                              if (!hasAny) return null as any;
                                              return {
                                                ...existingAp,
                                                permissions: newPermissions,
                                              };
                                            }
                                            return existingAp;
                                          })
                                          .filter(Boolean);
                                      });
                                      setToolsDefinitionEdits(prev => {
                                        const newEdits = { ...prev };
                                        delete newEdits[editKey];
                                        return newEdits;
                                      });
                                      setConfirmDeleteId(null);
                                    }}
                                    style={{
                                      height: 20,
                                      padding: '0 6px',
                                      background: 'rgba(239, 68, 68, 0.15)',
                                      border:
                                        '1px solid rgba(239, 68, 68, 0.3)',
                                      borderRadius: 4,
                                      color: '#ef4444',
                                      fontSize: 10,
                                      fontWeight: 500,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    Del
                                  </button>
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      setConfirmDeleteId(null);
                                    }}
                                    style={{
                                      height: 20,
                                      padding: '0 4px',
                                      background: 'transparent',
                                      border: '1px solid #3f3f46',
                                      borderRadius: 4,
                                      color: '#71717a',
                                      fontSize: 10,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    setConfirmDeleteId(toolFieldId);
                                  }}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    padding: 4,
                                    cursor: 'pointer',
                                    color: '#525252',
                                    borderRadius: 4,
                                    opacity: isHovered ? 1 : 0,
                                    transition: 'all 0.15s',
                                    flexShrink: 0,
                                  }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.background =
                                      'rgba(239, 68, 68, 0.15)';
                                    e.currentTarget.style.color = '#ef4444';
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.background =
                                      'transparent';
                                    e.currentTarget.style.color = '#525252';
                                  }}
                                  title='Remove tool'
                                >
                                  <svg
                                    width='14'
                                    height='14'
                                    viewBox='0 0 24 24'
                                    fill='none'
                                    stroke='currentColor'
                                    strokeWidth='2'
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                  >
                                    <path d='M18 6L6 18M6 6l12 12' />
                                  </svg>
                                </button>
                              )}
                            </div>

                            {/* 第二行：Description */}
                            <div style={{ minWidth: 0 }}>
                              {isEditingDesc ? (
                                <input
                                  type='text'
                                  value={currentDef.description}
                                  onChange={e =>
                                    setToolsDefinitionEdits(prev => ({
                                      ...prev,
                                      [editKey]: {
                                        ...currentDef,
                                        description: e.target.value,
                                      },
                                    }))
                                  }
                                  onBlur={() => setEditingToolField(null)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter')
                                      setEditingToolField(null);
                                    if (e.key === 'Escape')
                                      setEditingToolField(null);
                                  }}
                                  autoFocus
                                  style={{
                                    width: '100%',
                                    fontSize: FONT.secondary, // 12px
                                    color: '#9ca3af',
                                    background: '#0a0a0c',
                                    border: '1px solid #1a1a1c',
                                    borderRadius: 4,
                                    padding: '0 6px',
                                    height: 22,
                                    outline: 'none',
                                  }}
                                />
                              ) : (
                                <div
                                  onClick={() =>
                                    setEditingToolField({
                                      toolId: toolFieldId,
                                      field: 'description',
                                    })
                                  }
                                  style={{ cursor: 'pointer', width: '100%' }}
                                  title='Click to edit description'
                                >
                                  <div
                                    style={{
                                      fontSize: FONT.secondary,
                                      color: currentDef.description
                                        ? '#71717a'
                                        : '#3f3f46', // Darker text for description
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      fontStyle: currentDef.description
                                        ? 'normal'
                                        : 'italic',
                                      lineHeight: '1.4',
                                    }}
                                  >
                                    {currentDef.description ||
                                      'Add description...'}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Footer - Create & Test */}
      {accessPoints.length > 0 && (
        <div
          style={{
            padding: '16px 20px', // 增加一点 padding
            borderTop: '1px solid #1a1a1c',
            background: '#0f0f11',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => {
              console.log('Create & Test clicked');
              // TODO: Implement create server and open chat logic
            }}
            style={{
              width: '100%',
              height: 36,
              background: '#10b981', // Green for Action/Run
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontSize: FONT.primary,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'background 0.15s',
              boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#059669')} // Darker green on hover
            onMouseLeave={e => (e.currentTarget.style.background = '#10b981')}
          >
            <span>Create & Test</span>
            <span
              style={{
                fontSize: FONT.secondary,
                fontWeight: 400,
                opacity: 0.8,
                background: 'rgba(255,255,255,0.15)',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              {accessPoints.reduce(
                (sum, ap) =>
                  sum +
                  TOOL_DEFS.filter(tool => ap.permissions[tool.backendId])
                    .length,
                0
              )}{' '}
              tools
            </span>
          </button>
        </div>
      )}

      {/* 嵌入 CSS */}
      <style>{`
        @keyframes spin { 
          to { transform: rotate(360deg); } 
        }
        /* 自定义滚动条 */
        ::-webkit-scrollbar {
          width: 8px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: #2a2a2a;
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
      `}</style>
    </div>
  );
}
