'use client';

import React, { useState } from 'react';
import { useAgent, type SavedAgent } from '@/contexts/AgentContext';
import { SetupDialog } from '@/components/agent/views/OpenClawSetupView';

const CHAT_TYPES = new Set(['chat', 'schedule']);

const ACCESS_ICONS = [
  '🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁',
  '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦉',
];

const parseAgentIcon = (icon?: string): string => {
  if (!icon) return '🤖';
  const idx = parseInt(icon);
  if (isNaN(idx)) return icon;
  return ACCESS_ICONS[idx % ACCESS_ICONS.length] || '🤖';
};

const TYPE_LABELS: Record<string, string> = {
  chat: 'Chat',
  schedule: 'Scheduled',
  devbox: 'OpenClaw',
  webhook: 'Webhook',
};

// ────────────────────────────────────────────
// Tooltip (appears below icon on hover)
// ────────────────────────────────────────────

function DockTooltip({ agent, visible }: { agent: SavedAgent; visible: boolean }) {
  if (!visible) return null;
  return (
    <div style={{
      position: 'absolute', top: 'calc(100% + 6px)', left: '50%',
      transform: 'translateX(-50%)',
      background: '#1f1f1f', border: '1px solid #333', borderRadius: 6,
      padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 6,
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 1000,
      pointerEvents: 'none', whiteSpace: 'nowrap',
    }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: '#e5e5e5' }}>{agent.name}</span>
      <span style={{ fontSize: 10, color: '#525252' }}>·</span>
      <span style={{ fontSize: 10, color: '#737373' }}>{TYPE_LABELS[agent.type] || 'Agent'}</span>
    </div>
  );
}

// ────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────

export function AccessDock() {
  const {
    savedAgents,
    currentAgentId,
    sidebarMode,
    selectAgent,
    openSetting,
    closeSidebar,
    hoveredAgentId,
    setHoveredAgentId,
  } = useAgent();

  const [dialogAgent, setDialogAgent] = useState<SavedAgent | null>(null);

  const chatAgents = savedAgents.filter(a => CHAT_TYPES.has(a.type));
  const channelAgents = savedAgents.filter(a => !CHAT_TYPES.has(a.type));

  const handleClick = (agent: SavedAgent) => {
    if (CHAT_TYPES.has(agent.type)) {
      if (currentAgentId === agent.id && sidebarMode === 'deployed') {
        closeSidebar();
      } else {
        selectAgent(agent.id);
      }
    } else {
      setDialogAgent(agent);
    }
  };

  const renderIcon = (agent: SavedAgent) => {
    const isChat = CHAT_TYPES.has(agent.type);
    const isActive = isChat
      ? (currentAgentId === agent.id && sidebarMode === 'deployed')
      : (dialogAgent?.id === agent.id);
    const isHovered = hoveredAgentId === agent.id;
    const emoji = parseAgentIcon(agent.icon);

    return (
      <div
        key={agent.id}
        style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
        onMouseEnter={() => setHoveredAgentId(agent.id)}
        onMouseLeave={() => setHoveredAgentId(null)}
      >
        <button
          onClick={() => handleClick(agent)}
          style={{
            width: 32, height: 32, borderRadius: '50%',
            background: isHovered ? '#3a3a3a' : '#2a2a2a',
            border: isActive
              ? '2px solid #f97316'
              : isHovered ? '2px solid #4a4a4a' : '2px solid transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
          }}
        >
          {emoji}
        </button>
        <DockTooltip agent={agent} visible={isHovered && !isActive} />
      </div>
    );
  };

  const hasBothGroups = chatAgents.length > 0 && channelAgents.length > 0;

  return (
    <>
      <div style={{
        height: 48, background: '#141414',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 8, flexShrink: 0,
      }}>
        {/* Agents group */}
        {chatAgents.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {chatAgents.map(renderIcon)}
          </div>
        )}

        {/* Divider */}
        {hasBothGroups && (
          <div style={{ width: 1, height: 20, background: '#333', flexShrink: 0 }} />
        )}

        {/* Channels group */}
        {channelAgents.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {channelAgents.map(renderIcon)}
          </div>
        )}

        {/* Add button */}
        <button
          onClick={() => {
            if (sidebarMode === 'setting') closeSidebar();
            else openSetting();
          }}
          style={{
            width: 32, height: 32, borderRadius: '50%',
            background: sidebarMode === 'setting' ? '#2a2a2a' : 'transparent',
            border: sidebarMode === 'setting'
              ? '2px solid #f97316'
              : '1px dashed #525252',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: sidebarMode === 'setting' ? '#fff' : '#606060',
            cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
            marginLeft: (savedAgents.length === 0) ? 0 : 4,
          }}
          onMouseEnter={e => {
            if (sidebarMode !== 'setting') {
              e.currentTarget.style.borderColor = '#737373';
              e.currentTarget.style.color = '#a3a3a3';
              e.currentTarget.style.background = '#1f1f1f';
            }
          }}
          onMouseLeave={e => {
            if (sidebarMode !== 'setting') {
              e.currentTarget.style.borderColor = '#525252';
              e.currentTarget.style.color = '#606060';
              e.currentTarget.style.background = 'transparent';
            }
          }}
          title="Add access point"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Channel setup dialog */}
      {dialogAgent && dialogAgent.type === 'devbox' && (
        <SetupDialog
          open={true}
          onClose={() => setDialogAgent(null)}
          accessKey={dialogAgent.mcp_api_key || '<access-key>'}
          apiUrl={process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090'}
        />
      )}
    </>
  );
}
