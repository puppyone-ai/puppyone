'use client';

import React, { useState } from 'react';
import type { AccessOption } from '../../chat/ChatInputArea';

const ToolIcon = () => (
  <svg
    width='12'
    height='12'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <path d='M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' />
  </svg>
);

export const NodeGroup = ({
  nodeName,
  nodeId,
  tools,
  selectedAccess,
  onToggleAccess,
  isCurrentNode,
  defaultExpanded,
}: {
  nodeName: string;
  nodeId: string | undefined;
  tools: AccessOption[];
  selectedAccess: Set<string>;
  onToggleAccess: (id: string) => void;
  isCurrentNode: boolean;
  defaultExpanded: boolean;
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const selectedCount = tools.filter(t => selectedAccess.has(t.id)).length;

  return (
    <div style={{ marginBottom: 2 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          borderRadius: 6,
          cursor: 'pointer',
          background: isCurrentNode ? 'rgba(74, 222, 128, 0.08)' : 'transparent',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          if (!isCurrentNode) e.currentTarget.style.background = '#1a1a1a';
        }}
        onMouseLeave={e => {
          if (!isCurrentNode) e.currentTarget.style.background = 'transparent';
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#666"
            strokeWidth="2"
            style={{
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s',
              flexShrink: 0,
            }}
          >
            <path d="M9 6L15 12L9 18" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{
            fontSize: 12,
            fontWeight: 500,
            color: isCurrentNode ? '#4ade80' : '#999',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {nodeName}
          </span>
          {selectedCount > 0 && (
            <span style={{
              fontSize: 10,
              padding: '1px 4px',
              borderRadius: 3,
              background: 'rgba(74, 222, 128, 0.15)',
              color: '#4ade80',
              fontWeight: 600,
            }}>
              {selectedCount}
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div style={{ paddingLeft: 8, marginTop: 2 }}>
          {tools.map(tool => (
            <div
              key={tool.id}
              onClick={() => onToggleAccess(tool.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '4px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                color: selectedAccess.has(tool.id) ? '#eee' : '#777',
                background: selectedAccess.has(tool.id) ? '#262626' : 'transparent',
                transition: 'all 0.1s',
              }}
              onMouseEnter={e => {
                if (!selectedAccess.has(tool.id)) e.currentTarget.style.background = '#1f1f1f';
              }}
              onMouseLeave={e => {
                if (!selectedAccess.has(tool.id)) e.currentTarget.style.background = 'transparent';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                <span style={{ opacity: 0.8, flexShrink: 0, color: selectedAccess.has(tool.id) ? '#fff' : '#555' }}>
                  {tool.type === 'bash' ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 17 10 11 4 5" />
                      <line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                  ) : (
                    <ToolIcon />
                  )}
                </span>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {tool.label.split(' · ').slice(1).join(' · ')}
                </span>
              </div>
              {selectedAccess.has(tool.id) && (
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

