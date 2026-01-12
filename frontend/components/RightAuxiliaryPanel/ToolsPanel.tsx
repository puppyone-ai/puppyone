'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  activeTableName?: string;
  onClose: () => void;
  onSaveTools: (toolsDefinition: Record<string, McpToolDefinition>) => void;
  isSaving: boolean;
  saveError: string | null;
  savedResult: SaveToolsResult | null;
  setSavedResult: React.Dispatch<React.SetStateAction<SaveToolsResult | null>>;
  onViewAllMcp?: () => void;
}

// Define Tool Groups
const READ_TOOLS = ['query_data', 'get_all_data'] as McpToolType[];

const WRITE_TOOLS = ['create', 'update', 'delete'] as McpToolType[];

const ALL_TOOLS = [
  'shell_access',
  ...READ_TOOLS,
  ...WRITE_TOOLS,
] as McpToolType[];

// Tool Config Map for display
const TOOL_CONFIG: Record<string, { label: string; short: string }> = {
  shell_access: { label: 'Bash / Shell Access', short: 'Bash' },
  get_data_schema: { label: 'Get Schema', short: 'Schema' },
  query_data: { label: 'Query Data', short: 'Query' },
  get_all_data: { label: 'Get All Data', short: 'Get All' },
  create: { label: 'Create Row', short: 'Create' },
  update: { label: 'Update Row', short: 'Update' },
  delete: { label: 'Delete Row', short: 'Delete' },
};

// Theme Color - Consistent Orange
const ACCENT_COLOR = '#f97316'; // Orange-500

// --- Sub Component: Add Capability Button ---
const AddCapabilityButton = ({
  ap,
  usedTools,
  onAdd,
}: {
  ap: AccessPoint;
  usedTools: Set<McpToolType>;
  onAdd: (toolId: McpToolType) => void;
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const availableTools = ALL_TOOLS.filter(t => !usedTools.has(t));

  if (availableTools.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={e => {
          e.stopPropagation();
          if (btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setMenuPos({ top: rect.bottom + 4, left: rect.left });
          }
          setShowMenu(!showMenu);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px dashed rgba(255, 255, 255, 0.1)',
          borderRadius: 6,
          color: '#71717a',
          fontSize: 12,
          cursor: 'pointer',
          width: '100%',
          justifyContent: 'center',
          marginTop: 8,
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
          e.currentTarget.style.color = '#a1a1aa';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
          e.currentTarget.style.color = '#71717a';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        }}
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
            d='M12 5v14M5 12h14'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
        Add Capability
      </button>

      {showMenu &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
              onClick={() => setShowMenu(false)}
            />
            <div
              style={{
                position: 'fixed',
                top: menuPos.top,
                left: menuPos.left,
                width: 200,
                background: '#18181b',
                border: '1px solid #27272a',
                borderRadius: 8,
                padding: 4,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                zIndex: 9999,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <div
                style={{
                  padding: '4px 8px',
                  fontSize: 10,
                  color: '#525252',
                  fontWeight: 600,
                }}
              >
                AVAILABLE TOOLS
              </div>
              {availableTools.map(toolId => (
                <div
                  key={toolId}
                  onClick={() => {
                    onAdd(toolId);
                    setShowMenu(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#e2e8f0',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e =>
                    (e.currentTarget.style.background = '#27272a')
                  }
                  onMouseLeave={e =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  <div
                    style={{
                      color: '#71717a',
                      width: 14,
                      height: 14,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {toolId === 'shell_access' ? (
                      <svg
                        width='12'
                        height='12'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='2'
                      >
                        <polyline points='4 17 10 11 4 5'></polyline>
                        <line x='12' y1='19' x2='20' y2='19'></line>
                      </svg>
                    ) : (
                      TOOL_ICONS[toolId]
                    )}
                  </div>
                  {TOOL_CONFIG[toolId]?.short || toolId}
                </div>
              ))}
            </div>
          </>,
          document.body
        )}
    </>
  );
};

// --- Sub Component: Tool Item ---
const ToolItem = ({
  ap,
  toolId,
  safeName,
  activeBaseName,
  onToggle,
  expandedToolId,
  setExpandedToolId,
}: {
  ap: AccessPoint;
  toolId: McpToolType;
  safeName: string;
  activeBaseName?: string;
  onToggle: (apId: string, toolId: McpToolType, current: boolean) => void;
  expandedToolId: string | null;
  setExpandedToolId: (id: string | null) => void;
}) => {
  const isEnabled = ap.permissions[toolId];
  const uniqueToolId = `${ap.id}-${toolId}`;
  const isExpanded = expandedToolId === uniqueToolId;
  const [isHovered, setIsHovered] = useState(false);

  // Edit States
  const [isEditingName, setIsEditingName] = useState(false);
  const [name, setName] = useState(`${toolId}_${safeName}`);
  const [desc, setDesc] = useState(
    `${TOOL_CONFIG[toolId]?.label || toolId} - ${activeBaseName || 'Project'}`
  );

  // Bash Access Level State (Separated into Read/Write)
  const [allowRead, setAllowRead] = useState(true);
  const [allowWrite, setAllowWrite] = useState(false);

  // Special Icon for Bash
  const renderIcon = () => {
    if (toolId === 'shell_access') {
      return (
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
          <polyline points='4 17 10 11 4 5'></polyline>
          <line x1='12' y1='19' x2='20' y2='19'></line>
        </svg>
      );
    }
    if (TOOL_ICONS[toolId]) return TOOL_ICONS[toolId];
    return (
      <svg
        width='12'
        height='12'
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='2'
      >
        <rect x='3' y='3' width='18' height='18' rx='2' />
      </svg>
    );
  };

  return (
    <div>
      {/* Main Row */}
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 28,
          padding: '0 4px 0 6px',
          gap: 8,
          borderRadius: 6,
          background: isHovered ? '#2C2C2C' : 'transparent',
          opacity: isEnabled ? 1 : 0.6,
          transition: 'background 0.1s, opacity 0.15s',
          cursor: 'default',
        }}
      >
        {/* Toggle Switch */}
        <div
          onClick={() => onToggle(ap.id, toolId, true)} // Disable
          style={{
            width: 20,
            height: 12,
            borderRadius: 6,
            background: ACCENT_COLOR, // Always active here
            position: 'relative',
            cursor: 'pointer',
            transition: 'background 0.15s',
            flexShrink: 0,
          }}
          title='Disable Capability'
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#1a1a1c',
              position: 'absolute',
              top: 2,
              left: 10, // Always right
              transition: 'left 0.15s',
            }}
          />
        </div>

        {/* Icon + Label */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: 80,
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
              color: 'currentColor',
            }}
          >
            {renderIcon()}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {TOOL_CONFIG[toolId]?.short || toolId}
          </div>
        </div>

        {/* Name Preview / Editor */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {isEditingName ? (
            <input
              type='text'
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => setIsEditingName(false)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === 'Escape')
                  setIsEditingName(false);
              }}
              autoFocus
              style={{
                width: '100%',
                background: '#1a1a1c',
                border: `1px solid ${ACCENT_COLOR}`,
                borderRadius: 4,
                padding: '0 4px',
                color: '#e2e8f0',
                fontSize: 13,
                fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif",
                outline: 'none',
                height: 22,
              }}
            />
          ) : (
            <div
              style={{
                fontSize: 13,
                color: '#e2e8f0',
                cursor: 'text', // Hint editable
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif",
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 24,
              }}
              onClick={() => setIsEditingName(true)} // Click to Edit
              title='Click to rename'
            >
              {name}
            </div>
          )}
        </div>

        {/* Expand/Config Button (Chevron) */}
        <div
          onClick={() => setExpandedToolId(isExpanded ? null : uniqueToolId)}
          style={{
            cursor: 'pointer',
            padding: 4,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#71717a',
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'all 0.2s',
          }}
          className='expand-btn'
        >
          <svg
            width='12'
            height='12'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='3'
            strokeLinecap='round'
            strokeLinejoin='round'
          >
            <path d='M9 18l6-6-6-6' />
          </svg>
        </div>
      </div>

      {/* Detail Panel */}
      {isExpanded && (
        <div
          style={{
            // REDUCED PADDING: Align with Icon/Text start (44px)
            padding: '4px 16px 4px 44px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* REMOVED: Duplicate Function Name Input */}

          {/* Access Permissions (Bash Only) - Removed as requested */}
          {/* toolId === 'shell_access' logic removed */}

          {/* Description */}
          <div className='input-group'>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#525252',
                marginBottom: 2,
                letterSpacing: '0.5px',
              }}
            >
              DESCRIPTION
            </div>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              placeholder='Description...'
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid #27272a',
                borderRadius: 0,
                padding: '2px 0',
                color: '#a1a1aa',
                fontSize: 13,
                lineHeight: '1.4',
                outline: 'none',
                resize: 'none',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
              className='detail-input'
            />
          </div>
        </div>
      )}
    </div>
  );
};

export function ToolsPanel({
  accessPoints,
  setAccessPoints,
  activeBaseName,
  onClose,
}: ToolsPanelProps) {
  // 改为存储"收起"的 ID，这样默认就是全部展开
  const [collapsedApIds, setCollapsedApIds] = useState<Set<string>>(new Set());
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);

  const handleTogglePermission = (
    apId: string,
    toolId: McpToolType,
    currentValue: boolean
  ) => {
    setAccessPoints(prev =>
      prev.map(ap => {
        if (ap.id === apId) {
          return {
            ...ap,
            permissions: {
              ...ap.permissions,
              [toolId]: !currentValue,
            },
          };
        }
        return ap;
      })
    );
  };

  const toggleApExpansion = (apId: string) => {
    setCollapsedApIds(prev => {
      const next = new Set(prev);
      if (next.has(apId))
        next.delete(apId); // 如果已收起，则展开
      else next.add(apId); // 如果展开，则收起
      return next;
    });
  };

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
          gap: 8,
          flexShrink: 0,
          background: '#0f0f11',
        }}
      >
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: '#52525b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#71717a')}
          onMouseLeave={e => (e.currentTarget.style.color = '#52525b')}
          title='Collapse panel'
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
            <polyline points='13 17 18 12 13 7' />
            <polyline points='6 17 11 12 6 7' />
          </svg>
        </button>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#71717a' }}>
          Access Configuration
        </span>
      </div>

      {/* Content List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {accessPoints.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 4 }}>
              No access points
            </div>
            <div style={{ fontSize: 13, color: '#525252' }}>
              Select nodes to configure access
            </div>
          </div>
        ) : (
          <div style={{ padding: '8px' }}>
            {accessPoints.map(ap => {
              const displayPath = ap.path || '/';
              const pathSegments = ap.path
                ? ap.path.split('/').filter(Boolean)
                : [];
              const lastSegment =
                pathSegments.length > 0
                  ? pathSegments[pathSegments.length - 1]
                  : 'root';

              let displayName = lastSegment;
              const isNumeric = !isNaN(Number(lastSegment));
              if (isNumeric && pathSegments.length > 1) {
                const parent = pathSegments[pathSegments.length - 2];
                displayName = `${parent}[${lastSegment}]`;
              } else if (isNumeric) {
                displayName = `#${lastSegment}`;
              }
              const safeName = displayName.replace(/[^a-zA-Z0-9_]/g, '');

              const isExpanded = !collapsedApIds.has(ap.id); // 默认展开，除非在 collapsedApIds 中
              const enabledCount = ALL_TOOLS.filter(
                t => ap.permissions[t]
              ).length;

              // Calculate used tools for this AP
              const usedTools = new Set(
                ALL_TOOLS.filter(t => ap.permissions[t])
              );

              return (
                // Block Container with DARKER Background
                <div
                  key={ap.id}
                  style={{
                    marginBottom: 12,
                    padding: '8px 4px 8px 4px',
                    borderRadius: 8,
                    // Darker background for hierarchy (vs Editor)
                    background: '#141416',
                    border: '1px solid rgba(255, 255, 255, 0.02)',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                  className='access-point-block'
                >
                  {/* Access Point Header */}
                  <div
                    onClick={() => toggleApExpansion(ap.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      height: 28,
                      padding: '0 4px 0 6px',
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                    className='sidebar-item-hover'
                  >
                    {/* Chevron */}
                    <div
                      style={{
                        width: 20,
                        display: 'flex',
                        justifyContent: 'center',
                        color: '#6b7280',
                        transform: isExpanded
                          ? 'rotate(90deg)'
                          : 'rotate(0deg)',
                        transition: 'transform 0.15s',
                        marginRight: 8,
                      }}
                    >
                      <svg
                        width='10'
                        height='10'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='3'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                      >
                        <path d='M9 18l6-6-6-6' />
                      </svg>
                    </div>

                    {/* Node Info */}
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
                          color: '#e2e8f0', // Brighter text for card title
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {displayName}
                      </span>

                      <span
                        style={{
                          fontSize: 12,
                          color: '#71717a', // Slightly brighter gray
                          fontFamily: 'monospace',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          opacity: 0.5,
                        }}
                      >
                        {displayPath}
                      </span>
                    </div>

                    {/* Active Count */}
                    {enabledCount > 0 && (
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
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div
                      style={{
                        paddingTop: 4,
                        paddingLeft: 12, // Indent for children
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                      }}
                    >
                      {/* Render Enabled Tools Only */}
                      {ALL_TOOLS.filter(t => ap.permissions[t]).map(toolId => (
                        <ToolItem
                          key={toolId}
                          ap={ap}
                          toolId={toolId}
                          safeName={safeName}
                          activeBaseName={activeBaseName}
                          onToggle={(apId, tId) =>
                            handleTogglePermission(apId, tId, true)
                          } // Disable
                          expandedToolId={expandedToolId}
                          setExpandedToolId={setExpandedToolId}
                        />
                      ))}

                      {/* Add Capability Button */}
                      <AddCapabilityButton
                        ap={ap}
                        usedTools={usedTools}
                        onAdd={toolId =>
                          handleTogglePermission(ap.id, toolId, false)
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Styles */}
      <style jsx>{`
        .sidebar-item-hover:hover {
          background: #2c2c2c !important;
        }
        .access-point-block:hover {
          border-color: rgba(
            255,
            255,
            255,
            0.08
          ) !important; /* Slightly brighter border on hover */
        }

        .detail-input:focus {
          border-bottom-color: #f97316 !important;
        }
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
