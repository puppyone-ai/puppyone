'use client';

import React from 'react';
import { type McpToolType } from '../../../lib/mcpApi';
import { TOOL_ICONS } from '../../../lib/toolIcons';
import { type AccessPoint } from './types';
import { TOOL_CONFIG, ACCENT_COLOR, BashIcon, DefaultToolIcon } from './constants';

interface ToolItemProps {
  ap: AccessPoint;
  toolId: McpToolType;
  safeName: string;
  activeBaseName?: string;
  onToggle: (apId: string, toolId: McpToolType) => void;
  expandedToolId: string | null;
  setExpandedToolId: React.Dispatch<React.SetStateAction<string | null>>;
}

export function ToolItem({
  ap,
  toolId,
  safeName,
  activeBaseName,
  onToggle,
  expandedToolId,
  setExpandedToolId,
}: ToolItemProps) {
  const config = TOOL_CONFIG[toolId] || { label: toolId, short: toolId };
  const isExpanded = expandedToolId === `${ap.id}-${toolId}`;
  const isBash = toolId === 'shell_access';

  // 生成工具名称
  const toolName = isBash
    ? `${toolId}_${safeName}`
    : `${toolId}_${safeName}`;

  const handleToggle = () => {
    setExpandedToolId(isExpanded ? null : `${ap.id}-${toolId}`);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(ap.id, toolId);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 6,
        overflow: 'hidden',
        background: isExpanded ? 'rgba(255,255,255,0.03)' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      {/* Tool Header */}
      <div
        onClick={handleToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          cursor: 'pointer',
          borderRadius: 6,
        }}
        className="tool-item-hover"
      >
        {/* Icon */}
        <span
          style={{
            color: isBash ? ACCENT_COLOR : '#71717a',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          {isBash ? (
            <BashIcon size={14} />
          ) : (
            TOOL_ICONS[toolId] || <DefaultToolIcon size={14} />
          )}
        </span>

        {/* Tool Short Name */}
        <span
          style={{
            fontSize: 12,
            color: '#a1a1aa',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {config.short}
        </span>

        {/* Tool Full Name (truncated) */}
        <span
          style={{
            fontSize: 11,
            color: '#52525b',
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 120,
          }}
        >
          {toolName}
        </span>

        {/* Delete Button */}
        <button
          onClick={handleDelete}
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
            flexShrink: 0,
            opacity: 0.6,
            transition: 'opacity 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.color = '#ef4444';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.6';
            e.currentTarget.style.color = '#52525b';
          }}
          title="Remove capability"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div
          style={{
            padding: '8px 12px',
            borderTop: '1px solid rgba(255,255,255,0.05)',
            fontSize: 11,
            color: '#71717a',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: '#52525b', width: 50 }}>Type:</span>
            <span style={{ color: '#a1a1aa' }}>{config.label}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: '#52525b', width: 50 }}>Name:</span>
            <span style={{ color: '#a1a1aa', fontFamily: 'monospace' }}>
              {toolName}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: '#52525b', width: 50 }}>Path:</span>
            <span style={{ color: '#a1a1aa', fontFamily: 'monospace' }}>
              {ap.path || '/'}
            </span>
          </div>
        </div>
      )}

      <style jsx>{`
        .tool-item-hover:hover {
          background: rgba(255, 255, 255, 0.05) !important;
        }
      `}</style>
    </div>
  );
}
