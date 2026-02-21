'use client';

import React, { useState } from 'react';
import { useAgent, type SavedAgent } from '@/contexts/AgentContext';

// Access Point 图标 - 动物 emoji
const ACCESS_ICONS = [
  '🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁',
  '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦉',
  '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌',
  '🐙', '🦑', '🦐', '🦀', '🐠', '🐬', '🦈', '🐳',
];

// 解析 icon：支持数字索引和直接 emoji
const parseAgentIcon = (icon?: string): string => {
  if (!icon) return '🤖';
  const idx = parseInt(icon);
  if (isNaN(idx)) return icon; // 如果不是数字，可能是直接存的 emoji
  return ACCESS_ICONS[idx % ACCESS_ICONS.length] || '🤖';
};

// Agent 类型的显示名称（简短版）
const TYPE_LABELS: Record<string, string> = {
  'chat': 'Chat',
  'schedule': 'Scheduled',
  'external': 'External',
};

// Agent 类型角标组件
// 只在特殊类型时显示（Chat 是默认类型，不显示）
function AgentTypeBadge({ type }: { type: string }) {
  // Chat 是默认类型，不需要显示 badge
  if (type === 'chat') {
    return null;
  }
  
  let icon = null;
  const iconSize = 12; // 稍微缩小一点
  
  switch (type) {
    case 'schedule':
      icon = (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
      break;
    case 'external':
      icon = (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      );
      break;
    default:
      return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: -3,
        right: -3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#a1a1aa',
        zIndex: 10,
        filter: 'drop-shadow(0px 1px 2px rgba(0,0,0,0.8))',
      }}
    >
      {icon}
    </div>
  );
}

// Hover Tooltip 组件 - 紧凑版，高度与按钮一致
function AgentTooltip({ agent, visible }: { agent: SavedAgent; visible: boolean }) {
  if (!visible) return null;
  
  const typeLabel = TYPE_LABELS[agent.type] || 'Agent';
  
  return (
    <div
      style={{
        position: 'absolute',
        right: 'calc(100% + 8px)',
        top: '50%',
        transform: 'translateY(-50%)',
        background: '#1f1f1f',
        border: '1px solid #333',
        borderRadius: 6,
        padding: '6px 10px',
        height: 32, // 与按钮高度一致
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        zIndex: 1000,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {/* 小三角箭头 */}
      <div
        style={{
          position: 'absolute',
          right: -6,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 0,
          height: 0,
          borderTop: '5px solid transparent',
          borderBottom: '5px solid transparent',
          borderLeft: '5px solid #333',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: -5,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 0,
          height: 0,
          borderTop: '4px solid transparent',
          borderBottom: '4px solid transparent',
          borderLeft: '4px solid #1f1f1f',
        }}
      />
      
      {/* Name + Type 在同一行 */}
      <span style={{ fontSize: 12, fontWeight: 500, color: '#e5e5e5' }}>
        {agent.name}
      </span>
      <span style={{ fontSize: 10, color: '#525252' }}>
        •
      </span>
      <span style={{ fontSize: 10, color: '#737373' }}>
        {typeLabel}
      </span>
    </div>
  );
}

export function AgentRailVertical() {
  const { 
    savedAgents, 
    currentAgentId, 
    sidebarMode,
    selectAgent, 
    openSetting,
    closeSidebar,
    openChat,
    hoveredAgentId,
    setHoveredAgentId,
  } = useAgent();

  // Agent chip is active when deployed or editing (agent is "in focus")
  const isAgentFocused = sidebarMode === 'deployed' || sidebarMode === 'editing';

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
        paddingTop: 4, // 减少顶部 padding，因为第一个 item 有 paddingTop
        paddingBottom: 4,
        gap: 0, // 改为 0，用 padding 控制间距
      }}
    >
      {/* Agent 列表 - 在上面 */}
      {visibleAgents.map((agent) => {
        const isActive = currentAgentId === agent.id && isAgentFocused;
        const isHovered = hoveredAgentId === agent.id;
        // 解析 icon（支持数字索引和直接 emoji）
        const emoji = parseAgentIcon(agent.icon);

        return (
          // 外层容器：hover 区域，padding 控制视觉间距
          <div 
            key={agent.id} 
            style={{ 
              position: 'relative',
              padding: '4px 0', // 上下各 4px，总共 8px 间距
              display: 'flex',
              justifyContent: 'center',
            }}
            onMouseEnter={() => setHoveredAgentId(agent.id)}
            onMouseLeave={() => setHoveredAgentId(null)}
          >
            <button
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
                background: isHovered ? '#3a3a3a' : '#2a2a2a',
                border: isActive 
                  ? '2px solid #f97316' 
                  : isHovered ? '2px solid #4a4a4a' : '2px solid transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                cursor: 'pointer',
                transition: 'all 0.15s',
                flexShrink: 0,
                position: 'relative', // 为了定位 TypeBadge
              }}
            >
              {emoji}
              <AgentTypeBadge type={agent.type} />
            </button>
            
            {/* Hover Tooltip */}
            <AgentTooltip agent={agent} visible={isHovered && !isActive} />
          </div>
        );
      })}

      {/* Add Agent Button - 在所有 agent 下面，也用 padding 保持间距一致 */}
      <div style={{ padding: '4px 0', display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={() => {
            if (sidebarMode === 'setting') closeSidebar();
            else openSetting();
          }}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: sidebarMode === 'setting' ? '#2a2a2a' : 'transparent',
            border: sidebarMode === 'setting' 
              ? '2px solid #f97316' 
              : '1px dashed #525252', // 更细的虚线，颜色稍微亮一点
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
          title="Add new agent"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
