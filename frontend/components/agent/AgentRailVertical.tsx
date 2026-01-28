'use client';

import React from 'react';
import { useAgent } from '@/contexts/AgentContext';

export function AgentRailVertical() {
  const { 
    savedAgents, 
    currentAgentId, 
    sidebarMode,
    selectAgent, 
    openSetting,
    closeSidebar,
    openChat,
  } = useAgent();

  // Agent 只在 deployed 模式下激活，setting 模式下不激活
  const isDeployedMode = sidebarMode === 'deployed';

  // 显示所有 agents（用户有权看到所有 sub-agents）
  const visibleAgents = savedAgents;

  return (
    <div
      style={{
        width: 48,
        background: '#141414',
        borderLeft: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 8,
        gap: 8,
      }}
    >
      {/* Agent 列表 - 在上面 */}
      {visibleAgents.map((agent) => {
        const isActive = currentAgentId === agent.id && isDeployedMode;
        // 直接使用 agent 存储的 icon，如果没有则显示默认
        const emoji = agent.icon || '🤖';

        return (
          <button
            key={agent.id}
            onClick={() => {
              if (currentAgentId !== agent.id) {
                // 切换到另一个 agent
                selectAgent(agent.id);
              } else {
                // 点击当前 agent：toggle sidebar
                if (isDeployedMode) closeSidebar();
                else selectAgent(agent.id); // 重新选择会打开 deployed 模式
              }
            }}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: '#2a2a2a',
              border: isActive 
                ? '2px solid #f97316' 
                : '2px solid transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              cursor: 'pointer',
              transition: 'all 0.15s',
              flexShrink: 0,
            }}
            onMouseEnter={e => {
              if (!isActive) {
                e.currentTarget.style.background = '#3a3a3a';
                e.currentTarget.style.borderColor = '#4a4a4a';
              }
            }}
            onMouseLeave={e => {
              if (!isActive) {
                e.currentTarget.style.background = '#2a2a2a';
                e.currentTarget.style.borderColor = 'transparent';
              }
            }}
            title={agent.name}
          >
            {emoji}
          </button>
        );
      })}

      {/* Add Agent Button - 在所有 agent 下面 */}
      <button
        onClick={() => {
          if (sidebarMode === 'setting') {
            closeSidebar();
          } else {
            openSetting();
          }
        }}
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: sidebarMode === 'setting' ? '#2a2a2a' : 'transparent',
          border: sidebarMode === 'setting' 
            ? '2px solid #f97316' 
            : '2px dashed #4a4a4a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: sidebarMode === 'setting' ? '#fff' : '#606060',
          cursor: 'pointer',
          transition: 'all 0.15s',
          flexShrink: 0,
        }}
        onMouseEnter={e => {
          if (sidebarMode !== 'setting') {
            e.currentTarget.style.borderColor = '#5a5a5a';
            e.currentTarget.style.color = '#888';
            e.currentTarget.style.background = '#1f1f1f';
          }
        }}
        onMouseLeave={e => {
          if (sidebarMode !== 'setting') {
            e.currentTarget.style.borderColor = '#4a4a4a';
            e.currentTarget.style.color = '#606060';
            e.currentTarget.style.background = 'transparent';
          }
        }}
        title="Add new agent"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
}
