'use client';

import React, { useState, useMemo } from 'react';
import { NodeGroup } from './NodeGroup';
import type { AccessOption } from '../../chat/ChatInputArea';

export const RunSettings = ({
  availableTools,
  selectedAccess,
  onToggleAccess,
  currentTableId,
  defaultOpen = true,
}: {
  availableTools: AccessOption[];
  selectedAccess: Set<string>;
  onToggleAccess: (id: string) => void;
  currentTableId?: string;
  defaultOpen?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  // Group tools by node
  const toolsByNode = useMemo(() => {
    const map = new Map<string, { name: string; tools: AccessOption[] }>();
    for (const tool of availableTools) {
      const nodeId = tool.tableId?.toString() || '__no_node__';
      const nodeName = tool.tableName || 'Unknown';
      if (!map.has(nodeId)) {
        map.set(nodeId, { name: nodeName, tools: [] });
      }
      map.get(nodeId)!.tools.push(tool);
    }
    return map;
  }, [availableTools]);

  const sortedNodes = useMemo(() => {
    return Array.from(toolsByNode.entries()).sort(([aId], [bId]) => {
      if (aId === currentTableId) return -1;
      if (bId === currentTableId) return 1;
      return 0;
    });
  }, [toolsByNode, currentTableId]);

  return (
    <div style={{ borderBottom: '1px solid #1a1a1a', background: '#0d0d0d' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'transparent',
          border: 'none',
          color: '#eee',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <span>Run settings</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
            opacity: 0.5,
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div style={{ padding: '0 16px 16px' }}>
          {/* Capabilities */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Capabilities
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sortedNodes.length > 0 ? (
                sortedNodes.map(([nodeId, { name, tools }]) => (
                  <NodeGroup
                    key={nodeId}
                    nodeName={name}
                    nodeId={nodeId === '__no_node__' ? undefined : nodeId}
                    tools={tools}
                    selectedAccess={selectedAccess}
                    onToggleAccess={onToggleAccess}
                    isCurrentNode={nodeId === currentTableId}
                    defaultExpanded={true}
                  />
                ))
              ) : (
                <div style={{ padding: '8px 0', fontSize: 12, color: '#555', fontStyle: 'italic' }}>
                  No tools available
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

