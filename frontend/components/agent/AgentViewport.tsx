'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import { AgentSettingView } from './views/AgentSettingView';
import { ChatRuntimeView } from './views/ChatRuntimeView';
import { type McpToolPermissions, type Tool as DbTool } from '../lib/mcpApi';
import type { AccessOption } from './chat/ChatInputArea';

// Access Point 图标 - 动物 emoji（和 ProjectsHeader 保持一致）
const ACCESS_ICONS = [
  '🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁',
  '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦉',
  '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌',
  '🐙', '🦑', '🦐', '🦀', '🐠', '🐬', '🦈', '🐳',
];
const parseAgentIcon = (icon?: string): string => {
  if (!icon) return '💬';
  const idx = parseInt(icon);
  if (isNaN(idx)) return icon;
  return ACCESS_ICONS[idx % ACCESS_ICONS.length] || '💬';
};

const MIN_CHAT_WIDTH = 280;
const MAX_CHAT_WIDTH = 600;
const DEFAULT_CHAT_WIDTH = 360;

// Tool labels (Duplicated from ChatSidebar, maybe extract to constants later)
const toolTypeLabels: Record<string, string> = {
  query_data: 'Query',
  search: 'Search',
  get_all_data: 'Get All',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  shell_access: 'Bash',
  shell_access_readonly: 'Bash (Read-only)',
};

interface AccessPoint {
  id: string;
  path: string;
  permissions: McpToolPermissions;
}

interface AgentViewportProps {
  chatWidth?: number;
  onChatWidthChange?: (width: number) => void;
  contextData?: unknown;
  workingDirectory?: string;
  tableData?: unknown;
  tableId?: number | string;
  projectId?: number | string;
  onDataUpdate?: (newData: unknown) => void;
  accessPoints?: AccessPoint[];
  projectTools?: DbTool[];
  tableNameById?: Record<string, string>;
}

export function AgentViewport({
  chatWidth = DEFAULT_CHAT_WIDTH,
  onChatWidthChange,
  contextData,
  workingDirectory,
  tableData,
  tableId,
  projectId,
  onDataUpdate,
  accessPoints = [],
  projectTools,
  tableNameById,
}: AgentViewportProps) {
  const { sidebarMode, savedAgents, currentAgentId, deleteAgent, editAgent } = useAgent();
  const [isResizing, setIsResizing] = useState(false);
  const [isFullyOpen, setIsFullyOpen] = useState(sidebarMode !== 'closed');

  // --- Animation State ---
  useEffect(() => {
    if (sidebarMode !== 'closed') {
      const timer = setTimeout(() => setIsFullyOpen(true), 220);
      return () => clearTimeout(timer);
    } else {
      setIsFullyOpen(false);
    }
  }, [sidebarMode]);

  // --- Resize Logic ---
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const windowWidth = window.innerWidth;
      const railWidth = 52 + 8; // Rail width + margin
      const newWidth = windowWidth - e.clientX - railWidth;
      const clampedWidth = Math.min(Math.max(newWidth, MIN_CHAT_WIDTH), MAX_CHAT_WIDTH);
      onChatWidthChange?.(clampedWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, onChatWidthChange]);

  // --- Available Tools Calculation ---
  const availableTools: AccessOption[] = [];
  const allToolTypes = [
    'shell_access',
    'shell_access_readonly',
    'query_data',
    'search',
    'get_all_data',
    'create',
    'update',
    'delete',
  ] as const;

  if (projectTools && projectTools.length > 0) {
    for (const t of projectTools) {
      const type = (t.type || '').trim();
      const isBash = type === 'shell_access' || type === 'shell_access_readonly';
      const nid = t.node_id || null;
      const nodeName =
        nid && tableNameById?.[nid]
          ? tableNameById[nid]
          : nid
            ? `Node ${nid}`
            : 'Node';
      const scopePath = (t.json_path || '').trim() || 'root';
      const labelBase = toolTypeLabels[type] || type || 'tool';
      const label = `${nodeName} · ${labelBase} · ${scopePath}`;
      const optionId = `tool:${t.id}`;
      availableTools.push({
        id: optionId,
        label,
        type: isBash ? ('bash' as const) : ('tool' as const),
        tableId: nid ?? undefined,
        tableName: nodeName,
      });
    }
  } else {
    accessPoints.forEach(ap => {
      allToolTypes.forEach(toolType => {
        // @ts-ignore
        if (ap.permissions[toolType]) {
          availableTools.push({
            id: `${ap.id}-${toolType}`,
            label: toolTypeLabels[toolType] || toolType,
            type:
              toolType === 'shell_access' || toolType === 'shell_access_readonly'
                ? ('bash' as const)
                : ('tool' as const),
          });
        }
      });
    });
  }

  // --- Determine Current Agent Type ---
  const currentAgent = currentAgentId ? savedAgents.find(a => a.id === currentAgentId) : null;
  // If playground (null), default to 'chat'.
  const currentType = currentAgent?.type || 'chat';

  return (
    <aside
      style={{
        // Layout: In-flow, width controlled by sidebarMode
        width: sidebarMode !== 'closed' ? chatWidth : 0,
        minWidth: sidebarMode !== 'closed' ? chatWidth : 0,
        flexShrink: 0,
        overflow: 'hidden',

        // Visuals
        background: '#0d0d0d',
        borderLeft: sidebarMode !== 'closed' ? '1px solid #222' : 'none',

        display: 'flex',
        flexDirection: 'column',
        transition: isResizing ? 'none' : 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          position: 'absolute',
          top: 0,
          left: -4,
          width: 8,
          height: '100%',
          cursor: 'col-resize',
          zIndex: 60,
          background: isResizing ? 'rgba(74, 222, 128, 0.2)' : 'transparent',
        }}
        onMouseEnter={e => {
          if (!isResizing) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
        }}
        onMouseLeave={e => {
          if (!isResizing) e.currentTarget.style.background = 'transparent';
        }}
      />

      {/* Content based on Mode */}
      {sidebarMode === 'setting' && (
        <AgentSettingView 
          availableTools={availableTools} 
          currentTableId={tableId ? String(tableId) : undefined} 
        />
      )}

      {sidebarMode === 'deployed' && (
        <>
          {currentType === 'chat' && (
            <ChatRuntimeView
              availableTools={availableTools}
              tableData={tableData}
              tableId={tableId}
              projectId={projectId}
              onDataUpdate={onDataUpdate}
              projectTools={projectTools}
            />
          )}
          {currentType === 'devbox' && currentAgent && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Header */}
              <div style={{ 
                padding: '12px 16px', 
                borderBottom: '1px solid #222', 
                background: '#0d0d0d',
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                flexShrink: 0 
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#666' }}>
                    {currentAgent.name}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button 
                    onClick={() => editAgent(currentAgent.id)} 
                    title="Edit settings"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#666',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 4,
                      borderRadius: 4,
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#aaa'}
                    onMouseLeave={e => e.currentTarget.style.color = '#666'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3"></circle>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                  </button>
                  <button 
                    onClick={() => {
                      if (confirm(`Delete "${currentAgent.name}"? This cannot be undone.`)) {
                        deleteAgent(currentAgent.id);
                      }
                    }} 
                    title="Delete"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#666',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 4,
                      borderRadius: 4,
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = '#666'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </div>
              {/* Content */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888', fontStyle: 'italic' }}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>⚡</div>
                <div>Cloud Code Environment</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Coming Soon</div>
              </div>
            </div>
          )}
          {currentType === 'webhook' && currentAgent && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Header */}
              <div style={{ 
                padding: '12px 16px', 
                borderBottom: '1px solid #222', 
                background: '#0d0d0d',
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                flexShrink: 0 
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: '#666' }}>
                    {currentAgent.name}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button 
                    onClick={() => editAgent(currentAgent.id)} 
                    title="Edit settings"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#666',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 4,
                      borderRadius: 4,
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#aaa'}
                    onMouseLeave={e => e.currentTarget.style.color = '#666'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3"></circle>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                  </button>
                  <button 
                    onClick={() => {
                      if (confirm(`Delete "${currentAgent.name}"? This cannot be undone.`)) {
                        deleteAgent(currentAgent.id);
                      }
                    }} 
                    title="Delete"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#666',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 4,
                      borderRadius: 4,
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = '#666'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </div>
              {/* Content */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888', fontStyle: 'italic' }}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>🔗</div>
                <div>Webhook Trigger</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Coming Soon</div>
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

