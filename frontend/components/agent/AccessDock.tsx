'use client';

import React, { useState, useCallback } from 'react';
import { useAgent, type SavedAgent, type AccessResource } from '@/contexts/AgentContext';

const CHAT_TYPES = new Set(['chat', 'schedule']);

function ChatIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ScheduleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function WebhookIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function DevboxIcon() {
  return <span style={{ fontSize: 11, lineHeight: 1 }}>🦞</span>;
}

function getTypeIcon(type: string): React.ReactNode {
  switch (type) {
    case 'chat':     return <ChatIcon />;
    case 'schedule': return <ScheduleIcon />;
    case 'webhook':  return <WebhookIcon />;
    case 'devbox':   return <DevboxIcon />;
    default:         return <ChatIcon />;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function mapNodeType(backendType: string): 'folder' | 'json' | 'file' {
  if (backendType === 'folder') return 'folder';
  if (backendType === 'json') return 'json';
  return 'file';
}

const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif";

function AgentChip({ agent, isActive, isHovered, onChipClick, onMouseEnter, onMouseLeave, onNodeDrop }: {
  agent: SavedAgent;
  isActive: boolean;
  isHovered: boolean;
  onChipClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onNodeDrop: (agent: SavedAgent, nodeData: { id: string; name: string; type: string }) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-puppyone-node')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const raw = e.dataTransfer.getData('application/x-puppyone-node');
    if (!raw) return;
    try {
      const nodeData = JSON.parse(raw);
      onNodeDrop(agent, nodeData);
    } catch { /* ignore */ }
  }, [agent, onNodeDrop]);

  const bg = isDragOver
    ? 'rgba(249, 115, 22, 0.25)'
    : isActive
      ? 'rgba(255,255,255,0.12)'
      : isHovered ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)';

  const borderStyle = isDragOver
    ? '1px solid rgba(249, 115, 22, 0.6)'
    : 'none';

  return (
    <button
      onClick={onChipClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        height: 26, padding: '0 8px',
        borderRadius: 5,
        background: bg,
        border: borderStyle,
        color: isDragOver ? '#f97316' : isActive ? '#fff' : isHovered ? '#ccc' : '#999',
        fontSize: 11, fontWeight: 500, fontFamily: FONT,
        cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s, border 0.15s',
        whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      <span style={{ display: 'flex', opacity: isActive || isDragOver ? 1 : 0.65 }}>
        {getTypeIcon(agent.type)}
      </span>
      {isDragOver ? 'Drop here' : truncate(agent.name, 5)}
      <span style={{
        width: 5, height: 5, borderRadius: '50%',
        background: isDragOver ? '#f97316' : '#22c55e', flexShrink: 0,
        opacity: isActive || isDragOver ? 1 : 0.5,
      }} />
    </button>
  );
}

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
    updateAgentResources,
  } = useAgent();

  const handleChipClick = (agent: SavedAgent) => {
    const isThisAgentShown = currentAgentId === agent.id
      && (sidebarMode === 'deployed' || sidebarMode === 'editing');

    if (isThisAgentShown && sidebarMode === 'deployed') {
      closeSidebar();
    } else {
      selectAgent(agent.id);
    }
  };

  const handleAddClick = () => {
    if (sidebarMode === 'setting') {
      closeSidebar();
    } else {
      openSetting();
    }
  };

  const handleNodeDrop = useCallback(async (agent: SavedAgent, nodeData: { id: string; name: string; type: string }) => {
    const existing = agent.resources || [];
    if (existing.some(r => r.nodeId === nodeData.id)) return;

    const newResource: AccessResource = {
      nodeId: nodeData.id,
      nodeName: nodeData.name,
      nodeType: mapNodeType(nodeData.type),
      readonly: true,
    };

    try {
      await updateAgentResources(agent.id, [...existing, newResource]);
    } catch (err) {
      console.error('Failed to add resource to agent:', err);
    }
  }, [updateAgentResources]);

  const chatAgents = savedAgents.filter(a => CHAT_TYPES.has(a.type));
  const channelAgents = savedAgents.filter(a => !CHAT_TYPES.has(a.type));

  const renderChip = (agent: SavedAgent) => {
    const isActive = currentAgentId === agent.id
      && (sidebarMode === 'deployed' || sidebarMode === 'editing');
    const isHovered = hoveredAgentId === agent.id;

    return (
      <AgentChip
        key={agent.id}
        agent={agent}
        isActive={isActive}
        isHovered={isHovered}
        onChipClick={() => handleChipClick(agent)}
        onMouseEnter={() => setHoveredAgentId(agent.id)}
        onMouseLeave={() => setHoveredAgentId(null)}
        onNodeDrop={handleNodeDrop}
      />
    );
  };

  const isAddActive = sidebarMode === 'setting';
  const hasAgents = savedAgents.length > 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      {channelAgents.map(renderChip)}

      {channelAgents.length > 0 && chatAgents.length > 0 && (
        <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.08)', flexShrink: 0, margin: '0 4px' }} />
      )}

      {chatAgents.map(renderChip)}

      <button
        onClick={handleAddClick}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          height: 26, padding: '0 8px',
          borderRadius: 5,
          background: isAddActive ? 'rgba(255,255,255,0.08)' : 'transparent',
          border: isAddActive ? '1px solid rgba(255,255,255,0.15)' : '1px dashed rgba(255,255,255,0.15)',
          color: isAddActive ? '#fff' : '#555',
          fontSize: 11, fontWeight: 500, fontFamily: FONT,
          cursor: 'pointer',
          transition: 'background 0.1s, color 0.1s, border-color 0.1s',
          whiteSpace: 'nowrap', flexShrink: 0,
          marginLeft: hasAgents ? 6 : 0,
        }}
        onMouseEnter={e => {
          if (!isAddActive) {
            e.currentTarget.style.color = '#999';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
          }
        }}
        onMouseLeave={e => {
          if (!isAddActive) {
            e.currentTarget.style.color = '#555';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Access
      </button>
    </div>
  );
}
