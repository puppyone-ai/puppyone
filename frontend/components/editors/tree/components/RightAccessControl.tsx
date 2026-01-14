'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { type McpToolPermissions } from '../../../../lib/mcpApi';
import { TOOL_ICONS, DEFAULT_TOOL_ICON } from '../../../../lib/toolIcons';
import { TOOL_TYPE_CONFIG } from '../../../../lib/toolConfig';

export type { McpToolPermissions };

const MCP_TOOLS = [
  { id: 'query_data', label: 'Query' },
  { id: 'get_all_data', label: 'Get All' },
  { id: 'create', label: 'Create' },
  { id: 'update', label: 'Update' },
  { id: 'delete', label: 'Delete' },
];

interface RightAccessControlProps {
  path: string;
  configuredAccess: McpToolPermissions | null;
  isActive: boolean;
  onAccessChange?: (path: string, permissions: McpToolPermissions) => void;
  onRemove?: (path: string) => void;
  // 受控模式：由父组件统一管理展开状态
  isExpanded: boolean;
  isAnyExpanded: boolean; // 是否有任意节点展开（用于联动左移）
  onExpandChange: (expanded: boolean) => void;
}

export function RightAccessControl({
  path,
  configuredAccess,
  isActive,
  onAccessChange,
  onRemove,
  isExpanded,
  isAnyExpanded,
  onExpandChange,
}: RightAccessControlProps) {
  const [hovered, setHovered] = useState(false);
  const [showNlsMenu, setShowNlsMenu] = useState(false);
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 工具配置状态
  const [toolConfigs, setToolConfigs] = useState<
    Record<string, { name: string; desc: string }>
  >({});

  const getToolConfig = (toolId: string) => {
    const safeName = path
      ? path
          .split('/')
          .filter(Boolean)
          .pop()
          ?.replace(/[^a-zA-Z0-9_]/g, '') || 'root'
      : 'root';
    return (
      toolConfigs[toolId] || {
        name: `${toolId}_${safeName}`,
        desc: `${toolId === 'shell_access' ? 'Bash / Shell Access' : MCP_TOOLS.find(t => t.id === toolId)?.label || toolId} for ${safeName}`,
      }
    );
  };

  const updateToolConfig = (
    toolId: string,
    field: 'name' | 'desc',
    value: string
  ) => {
    setToolConfigs(prev => ({
      ...prev,
      [toolId]: { ...getToolConfig(toolId), [field]: value },
    }));
  };

  const [nlsState, setNlsState] = useState({
    view: true,
    edit: false,
    extend: false,
    destruct: false,
  });

  const isConfigured =
    !!configuredAccess && Object.values(configuredAccess).some(Boolean);
  const enabledCount = Object.values(configuredAccess || {}).filter(
    Boolean
  ).length;

  // 点击外部关闭
  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        onExpandChange(false);
        setShowNlsMenu(false);
        setExpandedToolId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExpanded, onExpandChange]);

  const handleToggle = useCallback(
    (toolId: string, enabled: boolean) => {
      const currentTools = configuredAccess || {};
      onAccessChange?.(path, {
        ...currentTools,
        [toolId]: enabled,
      } as McpToolPermissions);
    },
    [configuredAccess, onAccessChange, path]
  );

  const getDisplayName = () => {
    const segments = path ? path.split('/').filter(Boolean) : [];
    const last = segments.length > 0 ? segments[segments.length - 1] : 'root';
    const isNum = !isNaN(Number(last));
    if (isNum && segments.length > 1)
      return `${segments[segments.length - 2]}[${last}]`;
    return isNum ? `#${last}` : last;
  };

  // Menu 宽度常量
  const MENU_WIDTH = 300;

  return (
    <div
      ref={containerRef}
      style={{
        marginLeft: 8,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        flexShrink: 0,
        // 关键：整体宽度根据状态变化
        width: isExpanded
          ? 26 + 8 + MENU_WIDTH
          : isAnyExpanded
            ? 26 + 8 + MENU_WIDTH
            : 'auto',
        transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* === Button（始终显示） === */}
      <div
        style={{
          width: isConfigured && enabledCount > 1 ? 'auto' : 26,
          minWidth: 26,
          height: 26,
          padding: isConfigured && enabledCount > 1 ? '0 6px' : 0,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
          cursor: 'pointer',
          transition: 'all 0.15s',
          opacity:
            isConfigured || isActive || isExpanded || hovered || isAnyExpanded
              ? 1
              : 0,
          background: isExpanded
            ? 'rgba(249, 115, 22, 0.2)'
            : hovered
              ? 'rgba(255,255,255,0.2)'
              : 'rgba(255,255,255,0.1)',
          border: isExpanded
            ? '1px solid rgba(249, 115, 22, 0.3)'
            : '1px solid transparent',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={e => {
          e.stopPropagation();
          onExpandChange(!isExpanded);
        }}
        title='Configure MCP Tool Permissions'
      >
        {isConfigured ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              justifyContent: 'center',
              width: '100%',
            }}
          >
            {(configuredAccess as any)?.['shell_access'] && (
              <div
                style={{
                  color: '#fb923c',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 14,
                  height: 14,
                }}
              >
                <svg
                  width='14'
                  height='14'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                >
                  <polyline points='4 17 10 11 4 5' />
                  <line x1='12' y1='19' x2='20' y2='19' />
                </svg>
              </div>
            )}
            {MCP_TOOLS.filter(t => (configuredAccess as any)?.[t.id]).map(
              tool => (
                <div
                  key={tool.id}
                  style={{
                    color: '#fb923c',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 14,
                    height: 14,
                  }}
                  title={tool.label}
                >
                  {TOOL_ICONS[tool.id]}
                </div>
              )
            )}
          </div>
        ) : (
          <div
            style={{
              color: isExpanded ? '#f97316' : hovered ? '#e2e8f0' : '#6b7280',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {DEFAULT_TOOL_ICON}
          </div>
        )}
      </div>

      {/* === Menu（只在当前节点展开时显示内容，但占位符始终存在） === */}
      <div
        style={{
          width: MENU_WIDTH,
          flexShrink: 0,
          opacity: isExpanded ? 1 : 0,
          pointerEvents: isExpanded ? 'auto' : 'none',
          transform: isExpanded ? 'translateX(0)' : 'translateX(-10px)',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          // 只有当前展开时显示，否则隐藏但保持空间（如果 isAnyExpanded）
          visibility: isAnyExpanded ? 'visible' : 'hidden',
        }}
      >
        {isExpanded && (
          <div
            style={{
              background: '#141416',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              padding: '8px 4px',
              fontFamily:
                "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                height: 28,
                padding: '0 4px 0 6px',
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#e2e8f0',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {getDisplayName()}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: '#71717a',
                    fontFamily: 'monospace',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    opacity: 0.5,
                  }}
                >
                  {path || '/'}
                </span>
              </div>
              {isConfigured && (
                <div
                  style={{
                    fontSize: 11,
                    color: '#71717a',
                    marginLeft: 8,
                    fontWeight: 500,
                  }}
                >
                  {enabledCount}
                </div>
              )}
              <div
                onClick={e => {
                  e.stopPropagation();
                  onExpandChange(false);
                  setShowNlsMenu(false);
                  setExpandedToolId(null);
                }}
                style={{
                  cursor: 'pointer',
                  padding: 4,
                  borderRadius: 4,
                  marginLeft: 4,
                  color: '#6b7280',
                  display: 'flex',
                  alignItems: 'center',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#e2e8f0')}
                onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
              >
                <svg
                  width='12'
                  height='12'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                >
                  <path
                    d='M18 6L6 18M6 6l12 12'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                </svg>
              </div>
            </div>

            {/* Tools List */}
            <div
              style={{
                paddingLeft: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              {[{ id: 'shell_access', label: 'Bash' }, ...MCP_TOOLS].map(
                tool => {
                  const isEnabled =
                    (configuredAccess as any)?.[tool.id] || false;
                  const isToolExpanded = expandedToolId === tool.id;
                  const config = getToolConfig(tool.id);
                  const isBash = tool.id === 'shell_access';

                  return (
                    <div key={tool.id}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          height: 28,
                          padding: '0 4px 0 6px',
                          gap: 8,
                          borderRadius: 6,
                          background: isToolExpanded
                            ? '#2C2C2C'
                            : 'transparent',
                          opacity: isEnabled ? 1 : 0.6,
                          cursor: 'default',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => {
                          if (!isToolExpanded)
                            e.currentTarget.style.background = '#2C2C2C';
                        }}
                        onMouseLeave={e => {
                          if (!isToolExpanded)
                            e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <div
                          onClick={e => {
                            e.stopPropagation();
                            handleToggle(tool.id, !isEnabled);
                          }}
                          style={{
                            width: 20,
                            height: 12,
                            borderRadius: 6,
                            background: isEnabled ? '#f97316' : '#3f3f46',
                            position: 'relative',
                            flexShrink: 0,
                            cursor: 'pointer',
                            transition: 'background 0.15s',
                          }}
                        >
                          <div
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: '#1a1a1c',
                              position: 'absolute',
                              top: 2,
                              left: isEnabled ? 10 : 2,
                              transition: 'left 0.15s',
                            }}
                          />
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            width: 52,
                            flexShrink: 0,
                            color: '#e2e8f0',
                          }}
                        >
                          <div
                            style={{
                              width: 14,
                              height: 14,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: isBash
                                ? 'inherit'
                                : TOOL_TYPE_CONFIG[tool.id]?.color || 'inherit',
                            }}
                          >
                            {isBash ? (
                              <svg
                                width='14'
                                height='14'
                                viewBox='0 0 24 24'
                                fill='none'
                                stroke='currentColor'
                                strokeWidth='2'
                              >
                                <polyline points='4 17 10 11 4 5' />
                                <line x1='12' y1='19' x2='20' y2='19' />
                              </svg>
                            ) : (
                              TOOL_ICONS[tool.id]
                            )}
                          </div>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 500,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {tool.label}
                          </span>
                        </div>
                        <div
                          style={{
                            flex: 1,
                            fontSize: 12,
                            color: '#9ca3af',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {config.name}
                        </div>
                        <div
                          onClick={e => {
                            e.stopPropagation();
                            setExpandedToolId(isToolExpanded ? null : tool.id);
                          }}
                          style={{
                            cursor: 'pointer',
                            padding: 4,
                            borderRadius: 4,
                            color: '#6b7280',
                            transform: isToolExpanded
                              ? 'rotate(90deg)'
                              : 'rotate(0deg)',
                            transition: 'all 0.2s',
                            display: 'flex',
                          }}
                        >
                          <svg
                            width='10'
                            height='10'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='3'
                          >
                            <path d='M9 18l6-6-6-6' />
                          </svg>
                        </div>
                      </div>
                      {isToolExpanded && (
                        <div
                          style={{
                            padding: '8px 8px 8px 36px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 10,
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                color: '#525252',
                                marginBottom: 4,
                                letterSpacing: '0.5px',
                              }}
                            >
                              FUNCTION NAME
                            </div>
                            <input
                              type='text'
                              value={config.name}
                              onChange={e =>
                                updateToolConfig(
                                  tool.id,
                                  'name',
                                  e.target.value
                                )
                              }
                              style={{
                                width: '100%',
                                background: 'transparent',
                                border: 'none',
                                borderBottom: '1px solid #27272a',
                                padding: '4px 0',
                                color: '#e2e8f0',
                                fontSize: 12,
                                outline: 'none',
                                fontFamily: 'inherit',
                              }}
                              onFocus={e =>
                                (e.currentTarget.style.borderBottomColor =
                                  '#f97316')
                              }
                              onBlur={e =>
                                (e.currentTarget.style.borderBottomColor =
                                  '#27272a')
                              }
                            />
                          </div>
                          <div>
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                color: '#525252',
                                marginBottom: 4,
                                letterSpacing: '0.5px',
                              }}
                            >
                              DESCRIPTION
                            </div>
                            <textarea
                              value={config.desc}
                              onChange={e =>
                                updateToolConfig(
                                  tool.id,
                                  'desc',
                                  e.target.value
                                )
                              }
                              rows={2}
                              placeholder='Description...'
                              style={{
                                width: '100%',
                                background: 'transparent',
                                border: 'none',
                                borderBottom: '1px solid #27272a',
                                padding: '4px 0',
                                color: '#a1a1aa',
                                fontSize: 12,
                                lineHeight: '1.4',
                                outline: 'none',
                                resize: 'none',
                                fontFamily: 'inherit',
                              }}
                              onFocus={e =>
                                (e.currentTarget.style.borderBottomColor =
                                  '#f97316')
                              }
                              onBlur={e =>
                                (e.currentTarget.style.borderBottomColor =
                                  '#27272a')
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
              )}
            </div>

            <div
              style={{
                height: 1,
                background: 'rgba(255,255,255,0.06)',
                margin: '8px 8px',
              }}
            />

            {/* NLS Security */}
            <div style={{ paddingLeft: 8 }}>
              <div
                onClick={() => setShowNlsMenu(!showNlsMenu)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 28,
                  padding: '0 4px 0 6px',
                  gap: 8,
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e =>
                  (e.currentTarget.style.background = '#2C2C2C')
                }
                onMouseLeave={e =>
                  (e.currentTarget.style.background = 'transparent')
                }
              >
                <div
                  style={{
                    width: 20,
                    display: 'flex',
                    justifyContent: 'center',
                    color: '#8b5cf6',
                  }}
                >
                  <svg
                    width='14'
                    height='14'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                  >
                    <path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' />
                  </svg>
                </div>
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#e2e8f0',
                  }}
                >
                  Security (NLS)
                </span>
                <span
                  style={{
                    color: '#6b7280',
                    transform: showNlsMenu ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s',
                    display: 'flex',
                  }}
                >
                  <svg
                    width='10'
                    height='10'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='3'
                  >
                    <path d='M9 18l6-6-6-6' />
                  </svg>
                </span>
              </div>
              {showNlsMenu && (
                <div
                  style={{
                    paddingTop: 4,
                    paddingLeft: 28,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  {[
                    { key: 'view', label: 'View' },
                    { key: 'edit', label: 'Edit' },
                    { key: 'extend', label: 'Extend' },
                    { key: 'destruct', label: 'Destruct' },
                  ].map(opt => (
                    <div
                      key={opt.key}
                      onClick={() =>
                        setNlsState(prev => ({
                          ...prev,
                          [opt.key]: !prev[opt.key as keyof typeof prev],
                        }))
                      }
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 24,
                        padding: '0 8px',
                        gap: 8,
                        borderRadius: 4,
                        cursor: 'pointer',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e =>
                        (e.currentTarget.style.background =
                          'rgba(255,255,255,0.03)')
                      }
                      onMouseLeave={e =>
                        (e.currentTarget.style.background = 'transparent')
                      }
                    >
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 3,
                          border: `1px solid ${nlsState[opt.key as keyof typeof nlsState] ? '#8b5cf6' : '#3f3f46'}`,
                          background: nlsState[opt.key as keyof typeof nlsState]
                            ? '#8b5cf6'
                            : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s',
                        }}
                      >
                        {nlsState[opt.key as keyof typeof nlsState] && (
                          <svg
                            width='10'
                            height='10'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='#fff'
                            strokeWidth='3'
                          >
                            <polyline points='20 6 9 17 4 12' />
                          </svg>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>
                        {opt.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add Capability */}
            <div style={{ padding: '8px 8px 4px' }}>
              <button
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px dashed rgba(255,255,255,0.1)',
                  borderRadius: 6,
                  color: '#71717a',
                  fontSize: 11,
                  cursor: 'pointer',
                  width: '100%',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.color = '#a1a1aa';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  e.currentTarget.style.color = '#71717a';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                }}
              >
                <svg
                  width='10'
                  height='10'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2'
                >
                  <path
                    d='M12 5v14M5 12h14'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  />
                </svg>
                Add Capability
              </button>
            </div>

            {/* Delete */}
            {isConfigured && (
              <div style={{ padding: '4px 8px 4px' }}>
                <button
                  onClick={() => {
                    onRemove?.(path);
                    onExpandChange(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    background: 'rgba(248,113,113,0.05)',
                    border: '1px solid rgba(248,113,113,0.15)',
                    borderRadius: 6,
                    color: '#f87171',
                    fontSize: 11,
                    cursor: 'pointer',
                    width: '100%',
                    justifyContent: 'center',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(248,113,113,0.1)';
                    e.currentTarget.style.borderColor =
                      'rgba(248,113,113,0.25)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(248,113,113,0.05)';
                    e.currentTarget.style.borderColor =
                      'rgba(248,113,113,0.15)';
                  }}
                >
                  <svg width='10' height='10' viewBox='0 0 14 14' fill='none'>
                    <path
                      d='M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 013 11.5V4'
                      stroke='currentColor'
                      strokeWidth='1.2'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                    />
                    <path
                      d='M5.5 7v4M8.5 7v4'
                      stroke='currentColor'
                      strokeWidth='1.2'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                    />
                  </svg>
                  Remove Access Point
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
