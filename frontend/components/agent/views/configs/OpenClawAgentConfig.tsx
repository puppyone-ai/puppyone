'use client';

import React, { useState } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import type { AccessResource } from '@/contexts/AgentContext';
import { FolderIcon, CloseIcon, getNodeIcon } from '../_icons';
import type { AgentConfigProps } from './ChatAgentConfig';

// OpenClaw syncs data to an external agent workspace.
// Only folders can be dragged in — individual files or JSON paths are not supported.

export function OpenClawAgentConfig({}: AgentConfigProps) {
  const { draftResources, addDraftResource, updateDraftResource, removeDraftResource } = useAgent();
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    if (draftResources.length > 0) return; // already has a folder, don't accept more
    if (e.dataTransfer.types.includes('application/x-puppyone-node')) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent) => { e.stopPropagation(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const data = e.dataTransfer.getData('application/x-puppyone-node');
    if (!data) return;
    try {
      const node = JSON.parse(data);
      if (node.type !== 'folder') return; // only folders allowed
      if (draftResources.length > 0) return; // only one folder allowed
      addDraftResource({
        nodeId: node.nodeId || node.id,
        nodeName: node.name,
        nodeType: 'folder',
        readonly: true, // sync is always read-only from PuppyOne's perspective
        jsonPath: '',
      } as AccessResource);
    } catch { /* ignore */ }
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 500, color: '#666', marginBottom: 8, display: 'block',
  };

  return (
    <>
      {/* Workspace folder */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Workspace folder</label>
          <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
          {/* 约束提示 — 明确告知用户只能拖 1 个 folder */}
          <span style={{ fontSize: 11, color: '#525252', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, padding: '1px 6px', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            folder only · max 1
          </span>
        </div>

        <div
          style={{
            minHeight: 88,
            background: isDragging ? 'rgba(255,255,255,0.03)' : 'transparent',
            border: isDragging
              ? '1px dashed #525252'
              : draftResources.length > 0
                ? '1px solid #2a2a2a'   // solid when full — no more drop
                : '1px dashed #2a2a2a',
            borderRadius: 6,
            transition: 'all 0.15s',
            opacity: draftResources.length > 0 ? 1 : 1,
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div style={{ padding: draftResources.length > 0 ? 6 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {draftResources.map((resource) => {
              const { icon, color } = getNodeIcon(resource.nodeType);
              return (
                <div
                  key={resource.nodeId}
                  style={{
                    height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 10px', borderRadius: 4, background: '#1a1a1a', border: '1px solid #252525', transition: 'all 0.1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#222'; e.currentTarget.style.borderColor = '#333'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.borderColor = '#252525'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1, minWidth: 0 }}>
                    <div style={{ color, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</div>
                    <span style={{ fontSize: 14, color: '#e5e5e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {resource.nodeName}
                    </span>
                  </div>
                  <button
                    onClick={() => removeDraftResource(resource.nodeId)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 4, background: 'transparent', border: 'none', color: '#505050', cursor: 'pointer', transition: 'all 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#262626'; e.currentTarget.style.color = '#ef4444'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#505050'; }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              );
            })}
          </div>

          {draftResources.length === 0 && (
            <div style={{
              minHeight: 88,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
              color: isDragging ? '#a1a1aa' : '#525252',
            }}>
              <div style={{ color: isDragging ? '#d4d4d4' : '#a1a1aa' }}><FolderIcon /></div>
              <span style={{ fontSize: 12 }}>
                {isDragging ? 'Drop folder here' : 'Drag a folder into this'}
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
