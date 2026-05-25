'use client';

import React, { useState, useEffect } from 'react';
import { useAgent, AgentType } from '@/contexts/AgentContext';
import type { Tool as DbTool } from '@/lib/mcpApi';
import { ChatAgentConfig } from './configs/ChatAgentConfig';
import { ScheduleAgentConfig } from './configs/ScheduleAgentConfig';
import { FilesystemAgentConfig } from './configs/FilesystemAgentConfig';
import type { AgentConfigProps } from './configs/ChatAgentConfig';
import { ActivityIconButton } from '@/components/ActivityIconButton';

/**
 * Per-type edit view for an already-deployed access point.
 *
 * Key difference from AgentSettingView:
 *   - NO type selector — the type is locked after deploy
 *   - Header shows agent name + type badge
 *   - Renders only the config for the agent's locked type
 */

interface AgentEditViewProps {
  projectTools?: DbTool[];
}

const AGENT_CONFIG_MAP: Record<AgentType, React.ComponentType<AgentConfigProps>> = {
  chat:     ChatAgentConfig,
  schedule: ScheduleAgentConfig,
  devbox:   FilesystemAgentConfig,
  webhook:  ChatAgentConfig,
};

const AGENT_TYPE_LABELS: Record<AgentType, { label: string; icon: string }> = {
  chat:     { label: 'Chat Agent', icon: '💬' },
  schedule: { label: 'Schedule',   icon: '⏰' },
  devbox:   { label: 'Machine Folder', icon: '💻' },
  webhook:  { label: 'N8N/Zapier', icon: '⚡' },
};

export function AgentEditView({ projectTools }: AgentEditViewProps) {
  const {
    draftType,
    deployAgent,
    draftResources,
    cancelSetting,
    editingAgentId,
    savedAgents,
  } = useAgent();

  const editingAgent = editingAgentId ? savedAgents.find(a => a.id === editingAgentId) : null;

  const [draftName, setDraftName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);

  useEffect(() => {
    if (editingAgent) setDraftName(editingAgent.name);
  }, [editingAgent]);

  if (!editingAgent) return null;

  const agentType = editingAgent.type || 'chat';
  const typeInfo = AGENT_TYPE_LABELS[agentType];
  const ActiveConfig = AGENT_CONFIG_MAP[agentType];
  const displayName = draftName.trim() || editingAgent.name;
  const hasAnyContent = draftResources.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header — shows agent type + name, no type selector */}
      <div style={{
        height: 48, padding: '0 16px',
        borderBottom: '1px solid var(--po-border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--po-control)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>{typeInfo.icon}</span>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--po-text-subtle)' }}>
            Settings
          </span>
          <span style={{
            fontSize: 10, color: 'var(--po-text-disabled)',
            background: 'var(--po-panel-raised)', border: '1px solid var(--po-border)',
            borderRadius: 4, padding: '1px 6px',
          }}>
            {typeInfo.label}
          </span>
        </div>
        <ActivityIconButton kind="close" title="Back" onClick={cancelSetting} />
      </div>

      {/* Scrollable content — config only, no type selector */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

        <ActiveConfig projectTools={projectTools} />

        {/* Footer: name + save */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 0', borderTop: '1px solid var(--po-panel-raised)',
          }}>
            <span style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--po-panel-raised)', border: '1px solid var(--po-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, flexShrink: 0,
            }}>
              {typeInfo.icon}
            </span>

            {isEditingName ? (
              <input
                type="text" value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onBlur={() => setIsEditingName(false)}
                onKeyDown={e => { if (e.key === 'Enter') setIsEditingName(false); }}
                placeholder={editingAgent.name} autoFocus
                style={{
                  flex: 1, height: 24, background: 'var(--po-panel)',
                  border: '1px solid var(--po-border-strong)', borderRadius: 4,
                  padding: '0 8px', color: 'var(--po-text)', fontSize: 14, outline: 'none',
                }}
              />
            ) : (
              <button
                onClick={() => setIsEditingName(true)}
                style={{
                  flex: 1, height: 24, background: 'transparent', border: 'none',
                  borderRadius: 4, padding: '0 4px',
                  color: 'var(--po-text)', fontSize: 14, cursor: 'text',
                  textAlign: 'left', transition: 'all 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--po-panel-raised)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                title="Click to rename"
              >
                {displayName}
              </button>
            )}
          </div>

          <button
            onClick={() => deployAgent(displayName, agentType)}
            disabled={!hasAnyContent}
            style={{
              height: 32,
              background: hasAnyContent ? 'var(--po-success)' : 'var(--po-border)',
              color: hasAnyContent ? 'var(--po-text-inverse)' : 'var(--po-text-disabled)',
              border: 'none', borderRadius: 6,
              cursor: hasAnyContent ? 'pointer' : 'not-allowed',
              fontSize: 14, fontWeight: 600, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (hasAnyContent) e.currentTarget.style.background = 'var(--po-success)'; }}
            onMouseLeave={e => { if (hasAnyContent) e.currentTarget.style.background = 'var(--po-success)'; }}
          >
            Save
          </button>
        </div>

      </div>
    </div>
  );
}
