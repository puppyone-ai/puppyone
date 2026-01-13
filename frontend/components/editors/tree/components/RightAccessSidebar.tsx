'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { type McpToolPermissions } from '../../../../lib/mcpApi';
import { TOOL_ICONS, DEFAULT_TOOL_ICON } from '../../../../lib/toolIcons';

export type { McpToolPermissions };

const MCP_TOOLS = [
  { id: 'query_data', label: 'Query' },
  { id: 'get_all_data', label: 'Get All' },
  { id: 'create', label: 'Create' },
  { id: 'update', label: 'Update' },
  { id: 'delete', label: 'Delete' },
];

interface FlatNode {
  path: string;
  key: string | number;
  value: any;
  depth: number;
  isFirst: boolean;
  isLast: boolean;
  isExpanded: boolean;
  isExpandable: boolean;
  parentLines: boolean[];
}

interface VisibleRow {
  node: FlatNode;
  offsetY: number;
  index: number;
}

interface RightAccessSidebarProps {
  visibleRows: VisibleRow[];
  rowHeight: number;
  configuredAccessMap: Map<string, McpToolPermissions>;
  lockedPopoverPath: string | null;
  onPopoverOpenChange: (path: string | null) => void;
  onAccessChange?: (path: string, permissions: McpToolPermissions) => void;
  onRemove?: (path: string) => void;
  isSelectingAccessPoint?: boolean;
  hoveredRowPath: string | null;
  onHoverRow?: (path: string | null) => void; // 通知父组件 hover 状态
  containerWidth?: number; // 容器宽度，用于响应式布局
}

// Menu Panel Component - 只渲染一个，在展开时显示
const MenuPanel = React.memo(function MenuPanel({
  path,
  configuredAccess,
  onAccessChange,
  onRemove,
  onClose,
}: {
  path: string;
  configuredAccess: McpToolPermissions | null;
  onAccessChange?: (path: string, permissions: McpToolPermissions) => void;
  onRemove?: (path: string) => void;
  onClose: () => void;
}) {
  const [showNlsMenu, setShowNlsMenu] = useState(false);
  const [expandedToolId, setExpandedToolId] = useState<string | null>(null);
  const [toolConfigs, setToolConfigs] = useState<Record<string, { name: string; desc: string }>>({});
  const [nlsState, setNlsState] = useState({ view: true, edit: false, extend: false, destruct: false });

  const isConfigured = !!configuredAccess && Object.values(configuredAccess).some(Boolean);
  const enabledCount = Object.values(configuredAccess || {}).filter(Boolean).length;

  const getToolConfig = (toolId: string) => {
    const safeName = path ? path.split('/').filter(Boolean).pop()?.replace(/[^a-zA-Z0-9_]/g, '') || 'root' : 'root';
    return toolConfigs[toolId] || {
      name: `${toolId}_${safeName}`,
      desc: `${toolId === 'shell_access' ? 'Bash / Shell Access' : MCP_TOOLS.find(t => t.id === toolId)?.label || toolId} for ${safeName}`,
    };
  };

  const updateToolConfig = (toolId: string, field: 'name' | 'desc', value: string) => {
    setToolConfigs(prev => ({
      ...prev,
      [toolId]: { ...getToolConfig(toolId), [field]: value },
    }));
  };

  const handleToggle = useCallback(
    (toolId: string, enabled: boolean) => {
      const currentTools = configuredAccess || {};
      let newTools = { ...currentTools };

      // Bash 互斥逻辑 (三选一: None, Read-only, Modifiable)
      if (toolId === 'shell_access_readonly') {
        if (enabled) {
          // 选中 Read-only: 开启 Read-only, 关闭 Modifiable
          newTools['shell_access_readonly'] = true;
          newTools['shell_access'] = false;
        } else {
          // 取消 Read-only: 回到 None
          newTools['shell_access_readonly'] = false;
        }
      } else if (toolId === 'shell_access') {
        if (enabled) {
          // 选中 Modifiable: 开启 Modifiable, 关闭 Read-only
          newTools['shell_access'] = true;
          newTools['shell_access_readonly'] = false;
        } else {
          // 取消 Modifiable: 回到 None
          newTools['shell_access'] = false;
        }
      } else {
        // 其他 MCP Tools: 正常切换
        newTools[toolId] = enabled;
      }

      onAccessChange?.(path, newTools as McpToolPermissions);
    },
    [configuredAccess, onAccessChange, path]
  );

  const getDisplayName = () => {
    const segments = path ? path.split('/').filter(Boolean) : [];
    const last = segments.length > 0 ? segments[segments.length - 1] : 'root';
    const isNum = !isNaN(Number(last));
    if (isNum && segments.length > 1) return `${segments[segments.length - 2]}[${last}]`;
    return isNum ? `#${last}` : last;
  };

  // Bash 模式状态
  const isBashReadOnly = (configuredAccess as any)?.['shell_access_readonly'] || false;
  const isBashModifiable = (configuredAccess as any)?.['shell_access'] || false;

  // 渲染单个工具行
  const renderToolRow = (tool: { id: string; label: React.ReactNode }, icon: React.ReactNode, showExpand = true) => {
    const isEnabled = (configuredAccess as any)?.[tool.id] || false;
    const isToolExpanded = expandedToolId === tool.id;
    const config = getToolConfig(tool.id);

    return (
      <div key={tool.id}>
        <div
          style={{
            display: 'flex', alignItems: 'center', height: 28, padding: '0 4px 0 6px', gap: 8,
            borderRadius: 6, background: isToolExpanded ? '#2C2C2C' : 'transparent',
            opacity: isEnabled ? 1 : 0.6, cursor: 'default', transition: 'background 0.1s',
          }}
          onMouseEnter={e => { if (!isToolExpanded) e.currentTarget.style.background = '#2C2C2C'; }}
          onMouseLeave={e => { if (!isToolExpanded) e.currentTarget.style.background = 'transparent'; }}
        >
          <div
            onClick={(e) => { e.stopPropagation(); handleToggle(tool.id, !isEnabled); }}
            style={{ width: 20, height: 12, borderRadius: 6, background: isEnabled ? '#f97316' : '#3f3f46', position: 'relative', flexShrink: 0, cursor: 'pointer', transition: 'background 0.15s' }}
          >
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#1a1a1c', position: 'absolute', top: 2, left: isEnabled ? 10 : 2, transition: 'left 0.15s' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', minWidth: 0, color: '#e2e8f0' }}>
            <div style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'currentColor', flexShrink: 0 }}>
              {icon}
            </div>
            <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>{tool.label}</span>
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '40%', textAlign: 'right', marginLeft: 8 }}>{config.name}</div>
          {showExpand && (
            <div
              onClick={(e) => { e.stopPropagation(); setExpandedToolId(isToolExpanded ? null : tool.id); }}
              style={{ cursor: 'pointer', padding: 4, borderRadius: 4, color: '#6b7280', transform: isToolExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'all 0.2s', display: 'flex' }}
            >
              <svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='3'><path d='M9 18l6-6-6-6' /></svg>
            </div>
          )}
        </div>
        {isToolExpanded && (
          <div style={{ padding: '8px 8px 8px 36px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#525252', marginBottom: 4, letterSpacing: '0.5px' }}>FUNCTION NAME</div>
              <input
                type="text" value={config.name} onChange={(e) => updateToolConfig(tool.id, 'name', e.target.value)}
                style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid #27272a', padding: '4px 0', color: '#e2e8f0', fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
                onFocus={(e) => e.currentTarget.style.borderBottomColor = '#f97316'}
                onBlur={(e) => e.currentTarget.style.borderBottomColor = '#27272a'}
              />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#525252', marginBottom: 4, letterSpacing: '0.5px' }}>DESCRIPTION</div>
              <textarea
                value={config.desc} onChange={(e) => updateToolConfig(tool.id, 'desc', e.target.value)} rows={2} placeholder="Description..."
                style={{ width: '100%', background: 'transparent', border: 'none', borderBottom: '1px solid #27272a', padding: '4px 0', color: '#a1a1aa', fontSize: 12, lineHeight: '1.4', outline: 'none', resize: 'none', fontFamily: 'inherit' }}
                onFocus={(e) => e.currentTarget.style.borderBottomColor = '#f97316'}
                onBlur={(e) => e.currentTarget.style.borderBottomColor = '#27272a'}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  // Bash 终端图标
  const bashIcon = (
    <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
      <polyline points='4 17 10 11 4 5' />
      <line x1='12' y1='19' x2='20' y2='19' />
    </svg>
  );

  return (
    <div
      style={{
        background: '#141416',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: '8px 4px',
        fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        width: 300,
        boxSizing: 'border-box', // 确保 padding 和 border 包含在宽度内
      }}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ padding: '8px 12px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#737373' }}>Agent Access</div>
      </div>

      {/* BASH Section */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ padding: '4px 12px', fontSize: 10, fontWeight: 600, color: '#737373', letterSpacing: '0.5px' }}>
          BASH
        </div>
        <div style={{ paddingLeft: 8, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {/* Read-only Bash */}
          {renderToolRow(
            { 
              id: 'shell_access_readonly', 
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>Bash</span>
                  <div style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, border: '1px solid #525252', color: '#737373', lineHeight: '1' }}>Read-only</div>
                </div>
              ) 
            },
            bashIcon
          )}
          {/* Modifiable Bash */}
          {renderToolRow(
            { 
              id: 'shell_access', 
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>Bash</span>
                  <div style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(249, 115, 22, 0.15)', color: '#fb923c', lineHeight: '1' }}>Full Access</div>
                </div>
              ) 
            },
            bashIcon
          )}
        </div>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 8px 8px' }} />

      {/* MCP TOOLS Section */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ padding: '4px 12px', fontSize: 10, fontWeight: 600, color: '#737373', letterSpacing: '0.5px' }}>
          MCP TOOLS
        </div>
        <div style={{ paddingLeft: 8, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {MCP_TOOLS.map(tool => renderToolRow(tool, TOOL_ICONS[tool.id]))}
        </div>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 8px' }} />

      {/* NLS Security */}
      <div style={{ paddingLeft: 8 }}>
        <div
          onClick={() => setShowNlsMenu(!showNlsMenu)}
          style={{ display: 'flex', alignItems: 'center', height: 28, padding: '0 4px 0 6px', gap: 8, borderRadius: 6, cursor: 'pointer', transition: 'background 0.1s' }}
          onMouseEnter={e => e.currentTarget.style.background = '#2C2C2C'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <div style={{ width: 20, display: 'flex', justifyContent: 'center', color: '#8b5cf6' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: '#e2e8f0' }}>Security (NLS)</span>
          <span style={{ color: '#6b7280', transform: showNlsMenu ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'flex' }}>
            <svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='3'><path d='M9 18l6-6-6-6' /></svg>
          </span>
        </div>
        {showNlsMenu && (
          <div style={{ paddingTop: 4, paddingLeft: 28, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {[{ key: 'view', label: 'View' }, { key: 'edit', label: 'Edit' }, { key: 'extend', label: 'Extend' }, { key: 'destruct', label: 'Destruct' }].map((opt) => (
              <div
                key={opt.key}
                onClick={() => setNlsState(prev => ({ ...prev, [opt.key]: !prev[opt.key as keyof typeof prev] }))}
                style={{ display: 'flex', alignItems: 'center', height: 24, padding: '0 8px', gap: 8, borderRadius: 4, cursor: 'pointer', transition: 'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ width: 14, height: 14, borderRadius: 3, border: `1px solid ${nlsState[opt.key as keyof typeof nlsState] ? '#8b5cf6' : '#3f3f46'}`, background: nlsState[opt.key as keyof typeof nlsState] ? '#8b5cf6' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
                  {nlsState[opt.key as keyof typeof nlsState] && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                </div>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>{opt.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete */}
      {isConfigured && (
        <div style={{ padding: '4px 8px 4px' }}>
          <button
            onClick={() => { onRemove?.(path); onClose(); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.15)', borderRadius: 6, color: '#f87171', fontSize: 11, cursor: 'pointer', width: '100%', justifyContent: 'center', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.1)'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.25)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.05)'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.15)'; }}
          >
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 013 11.5V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 7v4M8.5 7v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Remove Access Point
          </button>
        </div>
      )}
    </div>
  );
});

// 单个方块/胶囊按钮样式
const BUTTON_HEIGHT = 26;
const GAP = 4;

// Bash 按钮 (圆角矩形 - 和 ChatSidebar 统一)
const BashButton = React.memo(function BashButton({
  isExpanded,
  localHovered,
  children,
  title,
  showBackground,
}: {
  isExpanded: boolean;
  localHovered: boolean;
  children: React.ReactNode;
  title: string;
  showBackground?: boolean;
}) {
  return (
    <div
      style={{
        width: BUTTON_HEIGHT,
        height: BUTTON_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6, // 圆角矩形
        background: isExpanded
          ? '#f97316' // 激活：实心橙
          : localHovered
            ? 'rgba(255, 167, 61, 0.25)' // Hover：更深
            : 'rgba(255, 167, 61, 0.15)', // 默认：更明显
        transition: 'background 0.15s',
      }}
      title={title}
    >
      {children}
    </div>
  );
});

// Tools 按钮 (圆角矩形 - 和 ChatSidebar 统一)
const ToolsButton = React.memo(function ToolsButton({
  isExpanded,
  localHovered,
  children,
  title,
  showBackground,
}: {
  isExpanded: boolean;
  localHovered: boolean;
  children: React.ReactNode;
  title: string;
  showBackground?: boolean;
}) {
  return (
    <div
      style={{
        width: BUTTON_HEIGHT,
        height: BUTTON_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6, // 圆角矩形
        background: isExpanded
          ? '#f97316' // 激活：实心橙
          : localHovered
            ? 'rgba(255, 167, 61, 0.25)' // Hover：更深
            : 'rgba(255, 167, 61, 0.15)', // 默认：更明显
        transition: 'background 0.15s',
      }}
      title={title}
    >
      {children}
    </div>
  );
});

// Single Row Button Component
const RowButton = React.memo(function RowButton({
  path,
  configuredAccess,
  isExpanded,
  isHovered,
  onExpandChange,
  isSelectingAccessPoint,
}: {
  path: string;
  configuredAccess: McpToolPermissions | null;
  isExpanded: boolean;
  isHovered: boolean;
  onExpandChange: (expanded: boolean) => void;
  isSelectingAccessPoint?: boolean;
}) {
  const [localHovered, setLocalHovered] = useState(false);
  const isConfigured = !!configuredAccess && Object.values(configuredAccess).some(Boolean);
  const enabledCount = Object.values(configuredAccess || {}).filter(Boolean).length;
  // 修复：Read-only 也算作 Bash
  const hasBash = !!(configuredAccess as any)?.['shell_access'] || !!(configuredAccess as any)?.['shell_access_readonly'];
  // 计算 Tools 数量时排除 Bash
  const otherToolsCount = enabledCount - (hasBash ? 1 : 0);

  // 只有在 hover 或 expanded 或 configured 时显示
  const shouldShow = isConfigured || isHovered || isExpanded || localHovered;

  const showBash = hasBash;
  const showTools = otherToolsCount > 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: GAP,
        cursor: isSelectingAccessPoint ? 'default' : 'pointer',
        transition: 'opacity 0.15s',
        opacity: shouldShow ? 1 : 0,
        pointerEvents: isSelectingAccessPoint ? 'none' : 'auto',
        // 确保整体高度一致
        height: 26,
      }}
      onMouseEnter={() => setLocalHovered(true)}
      onMouseLeave={() => setLocalHovered(false)}
      onClick={e => {
        e.stopPropagation();
        if (!isSelectingAccessPoint) {
          onExpandChange(!isExpanded);
        }
      }}
      title='Configure MCP Tool Permissions'
    >
      {isConfigured ? (
        <>
          {/* Bash 列：如果有 Bash 显示图标，否则显示占位符 */}
          {showBash ? (
            <BashButton isExpanded={isExpanded} localHovered={localHovered} title="Shell Access Enabled" showBackground={localHovered}>
              <svg 
                width='12' height='12' viewBox='0 0 24 24' fill='none' 
                stroke={isExpanded ? '#fff' : (localHovered ? '#f97316' : '#ffa73d')}
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                {/* 和 ChatSidebar 一致的终端符号 */}
                <polyline points='4 17 10 11 4 5' />
                <line x1='12' y1='19' x2='20' y2='19' />
              </svg>
            </BashButton>
          ) : (
            // 占位符：保持对齐
            <div style={{ width: BUTTON_HEIGHT, height: BUTTON_HEIGHT }} />
          )}

          {/* Tools 列：如果有 Tools 显示图标 */}
          {showTools && (
            <ToolsButton isExpanded={isExpanded} localHovered={localHovered} title={`${otherToolsCount} Tools Enabled`} showBackground={localHovered}>
              <svg 
                width='12' height='12' viewBox='0 0 24 24' fill='none' 
                stroke={isExpanded ? '#fff' : (localHovered ? '#f97316' : '#ffa73d')}
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                {/* 扳手图标 (Wrench) */}
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
            </ToolsButton>
          )}
        </>
      ) : (
        // 未配置状态：默认显示一个"调节器/配置"图标，放在左侧（Bash列位置）
        // 隐喻：这是控制台，你来配置权限
        <div
          style={{
            width: BUTTON_HEIGHT,
            height: BUTTON_HEIGHT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6, // 圆角矩形，和 Bash 统一
            // 未配置状态保持低调，不要用实心橙色
            background: isExpanded
              ? 'rgba(255, 255, 255, 0.12)' // 展开：明显的灰色背景
              : localHovered
                ? 'rgba(255, 255, 255, 0.08)' // Hover：淡灰色背景
                : 'transparent',
            transition: 'background 0.15s',
            // 确保显示在左侧
            marginLeft: 0,
          }}
        >
          <div style={{ 
            // 图标颜色也保持低调
            color: isExpanded ? '#e5e5e5' : (localHovered ? '#d4d4d8' : '#6b7280'), 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            transition: 'color 0.15s'
          }}>
            {/* 新版小狗爪子图标 (Custom Puppy Paw) - 统一 16px 宽度 */}
            <svg width='16' height='13' viewBox='0 0 33 26' fill='none' xmlns='http://www.w3.org/2000/svg'>
              <ellipse cx='27.9463' cy='11.0849' rx='3.45608' ry='4.0321' transform='rotate(14 27.9463 11.0849)' fill='currentColor' />
              <ellipse cx='11.5129' cy='4.75922' rx='3.45608' ry='4.3201' transform='rotate(-8 11.5129 4.75922)' fill='currentColor' />
              <ellipse cx='20.7294' cy='4.7593' rx='3.45608' ry='4.3201' transform='rotate(8 20.7294 4.7593)' fill='currentColor' />
              <ellipse cx='4.32887' cy='11.0848' rx='3.45608' ry='4.0321' transform='rotate(-14 4.32887 11.0848)' fill='currentColor' />
              <path d='M15.4431 11.5849C15.9709 11.499 16.0109 11.4991 16.5387 11.585C17.4828 11.7388 17.9619 12.099 18.7308 12.656C20.3528 13.8309 20.0223 15.0304 21.4709 16.4048C22.2387 17.1332 23.2473 17.7479 23.9376 18.547C24.7716 19.5125 25.1949 20.2337 25.3076 21.4924C25.4028 22.5548 25.3449 23.2701 24.7596 24.1701C24.1857 25.0527 23.5885 25.4635 22.5675 25.7768C21.6486 26.0587 21.0619 25.8454 20.1014 25.7768C18.4688 25.66 17.6279 24.9515 15.9912 24.9734C14.4592 24.994 13.682 25.655 12.155 25.7768C11.1951 25.8533 10.6077 26.0587 9.68884 25.7768C8.66788 25.4635 8.07066 25.0527 7.49673 24.1701C6.91143 23.2701 6.85388 22.5546 6.94907 21.4922C7.06185 20.2335 7.57596 19.5812 8.31877 18.547C9.01428 17.5786 9.71266 17.2943 10.5109 16.4048C11.7247 15.0521 11.7621 13.7142 13.251 12.656C14.0251 12.1059 14.499 11.7387 15.4431 11.5849Z' fill='currentColor' />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
});

// Main Sidebar Component
export function RightAccessSidebar({
  visibleRows,
  rowHeight,
  configuredAccessMap,
  lockedPopoverPath,
  onPopoverOpenChange,
  onAccessChange,
  onRemove,
  isSelectingAccessPoint,
  hoveredRowPath,
  onHoverRow,
  containerWidth,
}: RightAccessSidebarProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const menuColumnRef = useRef<HTMLDivElement>(null);
  const buttonColumnRef = useRef<HTMLDivElement>(null);
  
  // 响应式布局：窄屏时使用 overlay 模式
  const OVERLAY_THRESHOLD = 900;
  const isOverlayMode = (containerWidth || 0) < OVERLAY_THRESHOLD && (containerWidth || 0) > 0;

  // Menu 区域的虚拟 hover 路径（当鼠标在 menu 区域移动时计算）
  const [menuAreaHoveredPath, setMenuAreaHoveredPath] = useState<string | null>(null);
  // 按钮列区域的虚拟 hover 路径
  const [buttonAreaHoveredPath, setButtonAreaHoveredPath] = useState<string | null>(null);

  // 是否有展开的 popover（注意：根节点 path 是空字符串 ''，所以要用 !== null）
  const hasExpandedPopover = lockedPopoverPath !== null;

  // 找到当前展开行的 offsetY
  const expandedRowInfo = hasExpandedPopover
    ? visibleRows.find(r => r.node.path === lockedPopoverPath) 
    : null;

  // 点击外部关闭
  useEffect(() => {
    if (!hasExpandedPopover) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        onPopoverOpenChange(null);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [hasExpandedPopover, onPopoverOpenChange]);

  // Menu 区域鼠标移动时，根据 Y 坐标计算对应的行
  const handleMenuAreaMouseMove = useCallback((e: React.MouseEvent) => {
    if (!menuColumnRef.current || visibleRows.length === 0) return;
    
    const rect = menuColumnRef.current.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    
    // 找到鼠标 Y 坐标对应的行
    let foundRow: VisibleRow | null = null;
    for (const row of visibleRows) {
      if (relativeY >= row.offsetY && relativeY < row.offsetY + rowHeight) {
        foundRow = row;
        break;
      }
    }
    
    const newPath = foundRow ? foundRow.node.path : null;
    if (newPath !== menuAreaHoveredPath) {
      setMenuAreaHoveredPath(newPath);
      onHoverRow?.(newPath); // 通知父组件，让 editor 也显示 hover
    }
  }, [visibleRows, rowHeight, menuAreaHoveredPath, onHoverRow]);

  const handleMenuAreaMouseLeave = useCallback(() => {
    setMenuAreaHoveredPath(null);
    onHoverRow?.(null);
  }, [onHoverRow]);

  // 按钮列区域鼠标移动时，根据 Y 坐标计算对应的行
  const handleButtonAreaMouseMove = useCallback((e: React.MouseEvent) => {
    if (!buttonColumnRef.current || visibleRows.length === 0) return;
    
    const rect = buttonColumnRef.current.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    
    // 找到鼠标 Y 坐标对应的行
    let foundRow: VisibleRow | null = null;
    for (const row of visibleRows) {
      if (relativeY >= row.offsetY && relativeY < row.offsetY + rowHeight) {
        foundRow = row;
        break;
      }
    }
    
    const newPath = foundRow ? foundRow.node.path : null;
    if (newPath !== buttonAreaHoveredPath) {
      setButtonAreaHoveredPath(newPath);
      onHoverRow?.(newPath); // 通知父组件，让 editor 也显示 hover
    }
  }, [visibleRows, rowHeight, buttonAreaHoveredPath, onHoverRow]);

  const handleButtonAreaMouseLeave = useCallback(() => {
    setButtonAreaHoveredPath(null);
    onHoverRow?.(null);
  }, [onHoverRow]);

  // 计算 menu 的位置
  const menuTop = expandedRowInfo ? expandedRowInfo.offsetY : 0;

  return (
    <div
      ref={sidebarRef}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        flexShrink: 0,
        marginLeft: 8,
        paddingRight: 24, // 增加到 24px，给 Menu 右侧留出充足的呼吸空间
        // 宽度：按钮列 (54 = 26 + 2 + 26) + menu 列（当展开时）+ padding
        // Overlay 模式下，宽度不变，Menu 浮在上面
        width: hasExpandedPopover && !isOverlayMode ? (54 + 8 + 300 + 24) : (54 + 24),
        transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* 按钮列 - 与 editor 行对齐，也监听鼠标位置 */}
      <div
        ref={buttonColumnRef}
        onMouseMove={handleButtonAreaMouseMove}
        onMouseLeave={handleButtonAreaMouseLeave}
        style={{
          width: 54,
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {visibleRows.map(({ node, offsetY }) => (
          <div
            key={node.path || '$root'}
            style={{
              position: 'absolute',
              top: offsetY,
              left: 0,
              height: rowHeight,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <RowButton
              path={node.path}
              configuredAccess={configuredAccessMap.get(node.path) || null}
              isExpanded={lockedPopoverPath === node.path}
              isHovered={hoveredRowPath === node.path || menuAreaHoveredPath === node.path || buttonAreaHoveredPath === node.path}
              onExpandChange={(expanded) => onPopoverOpenChange(expanded ? node.path : null)}
              isSelectingAccessPoint={isSelectingAccessPoint}
            />
          </div>
        ))}
      </div>

      {/* Menu 列 - 只渲染一个 menu，同时监听鼠标位置 */}
      {/* Overlay 模式下：在按钮下方展开，右边缘对齐；正常模式：flex 布局 */}
      <div
        ref={menuColumnRef}
        onMouseMove={handleMenuAreaMouseMove}
        onMouseLeave={handleMenuAreaMouseLeave}
        style={{
          width: 300,
          marginLeft: isOverlayMode ? 0 : 8,
          flexShrink: 0,
          // Overlay 模式：absolute 定位，在按钮下方展开
          position: isOverlayMode ? 'absolute' : 'relative',
          ...(isOverlayMode ? {
            // 展开行的位置 + 一行高度 = Menu 顶部位置
            top: menuTop + rowHeight + 4, // +4 留一点间距
            // 右边缘对齐按钮列右边缘
            right: 24, // paddingRight 的位置
            left: 'auto',
            zIndex: 100,
            boxShadow: hasExpandedPopover ? '0 8px 32px rgba(0,0,0,0.5)' : 'none',
          } : {}),
          opacity: hasExpandedPopover ? 1 : 0,
          transition: 'opacity 0.15s ease-out', // 只做淡入淡出
          pointerEvents: hasExpandedPopover ? 'auto' : 'none',
        }}
      >
        {hasExpandedPopover && expandedRowInfo && (
          <div
            style={{
              // Overlay 模式：外层已定位，内部用 top:0
              // 正常模式：内部用 top:menuTop 对齐行
              position: isOverlayMode ? 'relative' : 'absolute',
              top: isOverlayMode ? 0 : menuTop,
              left: 0,
              // 限制 menu 不超出容器底部
              maxHeight: 'calc(100vh - 200px)',
              overflowY: 'auto',
              overflowX: 'hidden', // 防止水平滚动条
            }}
          >
            <MenuPanel
              path={lockedPopoverPath!}
              configuredAccess={configuredAccessMap.get(lockedPopoverPath!) || null}
              onAccessChange={onAccessChange}
              onRemove={onRemove}
              onClose={() => onPopoverOpenChange(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default RightAccessSidebar;

