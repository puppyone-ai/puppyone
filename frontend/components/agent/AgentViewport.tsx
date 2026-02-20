'use client';

import React, { useState, useEffect } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import { AgentSettingView } from './views/AgentSettingView';
import { ChatRuntimeView } from './views/ChatRuntimeView';
import { McpConnectionView } from './views/McpConnectionView';
import { OpenClawSetupView } from './views/OpenClawSetupView';
import { AgentDetailView } from './views/AgentDetailView';
import { type McpToolPermissions, type Tool as DbTool } from '@/lib/mcpApi';
import type { AccessOption } from '../chat/ChatInputArea';
import type { SavedAgent } from '@/components/AgentRail';

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

const DEFAULT_CHAT_WIDTH = 400;

// Tool type labels
// NOTE: shell_access is NOT a tool - it's managed via agent_bash per Agent
const toolTypeLabels: Record<string, string> = {
  query_data: 'Query',
  search: 'Search',
  get_all_data: 'Get All',
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  custom_script: 'Custom Script',
};

interface AccessPoint {
  id: string;
  path: string;
  permissions: McpToolPermissions;
}

interface AgentViewportProps {
  chatWidth?: number;
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
  const [isFullyOpen, setIsFullyOpen] = useState(sidebarMode !== 'closed');

  // --- Determine Current Agent ---
  const currentAgent = currentAgentId ? savedAgents.find(a => a.id === currentAgentId) : null;
  const currentType = currentAgent?.type || 'chat'; // If playground (null), default to 'chat'.

  // --- Animation State ---
  useEffect(() => {
    if (sidebarMode !== 'closed') {
      const timer = setTimeout(() => setIsFullyOpen(true), 220);
      return () => clearTimeout(timer);
    } else {
      setIsFullyOpen(false);
    }
  }, [sidebarMode]);

  // --- Available Tools Calculation ---
  // NOTE: shell_access is NOT stored in projectTools anymore
  // It's managed via agent.resources (loaded from agent_bash table)
  const availableTools: AccessOption[] = [];

  // 1. Add real tools from projectTools (not shell_access)
  if (projectTools && projectTools.length > 0) {
    for (const t of projectTools) {
      const type = (t.type || '').trim();
      // Skip any legacy shell_access entries (they should be cleaned up)
      if (type === 'shell_access' || type === 'shell_access_readonly') continue;
      
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
        type: 'tool' as const,
        tableId: nid ?? undefined,
        tableName: nodeName,
      });
    }
  }

  // 2. Add bash accesses from current agent's resources
  // These come from agent_bash table via agent.resources
  if (currentAgent?.resources && currentAgent.resources.length > 0) {
    for (const res of currentAgent.resources) {
      const nodeName = res.nodeName || res.nodeId;
      const label = `${nodeName} · Bash${res.readonly ? ' (Read-only)' : ''}`;
      const optionId = `bash:${res.nodeId}`;
      availableTools.push({
        id: optionId,
        label,
        type: 'bash' as const,
        tableId: res.nodeId,
        tableName: nodeName,
      });
    }
  }

  return (
    <aside
      style={{
        // Layout: In-flow, width controlled by sidebarMode
        position: 'relative',
        width: sidebarMode !== 'closed' ? chatWidth : 0,
        minWidth: sidebarMode !== 'closed' ? chatWidth : 0,
        flexShrink: 0,
        overflow: 'hidden',

        // Visuals
        background: '#0d0d0d',
        borderLeft: sidebarMode !== 'closed' ? '1px solid #222' : 'none',

        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >

      {/* Content based on Mode */}
      {sidebarMode === 'setting' && (
        <AgentSettingView 
          availableTools={availableTools} 
          projectTools={projectTools}
          tableNameById={tableNameById}
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
            <OpenClawSetupView
              agent={currentAgent}
              projectId={projectId}
              onEdit={() => editAgent(currentAgent.id)}
              onDelete={() => {
                if (confirm(`Delete "${currentAgent.name}"? This cannot be undone.`)) {
                  deleteAgent(currentAgent.id);
                }
              }}
            />
          )}
          {/* Schedule 和 Webhook 类型使用 AgentDetailView 显示设置 */}
          {currentType === 'schedule' && currentAgent && (
            <AgentDetailView agent={currentAgent} />
          )}
          {currentType === 'webhook' && currentAgent && (
            <AgentDetailView agent={currentAgent} />
          )}
        </>
      )}
    </aside>
  );
}

