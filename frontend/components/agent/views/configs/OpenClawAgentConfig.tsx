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
    fontSize: 12, fontWeight: 500, color: '#666', marginBottom: 8, display: 'block',
  };

  return (
    <>
      {/* Workspace folder in a styled callout bubble */}
      <div style={{ position: 'relative', marginTop: 16 }}>
        {/* CSS Triangle pointing up to the Workspace logo */}
        <div style={{
          position: 'absolute',
          top: '-8px',
          left: 'calc(50% - 76px)',
          width: '16px',
          height: '16px',
          background: '#18181b',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          transform: 'rotate(45deg)',
          zIndex: 3,
          marginLeft: '-8px'
        }} />

        <div style={{
          position: 'relative',
          background: '#18181b',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '8px',
          padding: '16px',
          zIndex: 2
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <label style={{ ...labelStyle, marginBottom: 0, paddingLeft: 2, color: '#e4e4e7' }}>Workspace Folder</label>
            <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
            <span style={{ fontSize: 11, color: '#525252', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, padding: '1px 6px', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
              folder only · max 1
            </span>
          </div>
          <div style={{ color: '#a1a1aa', fontSize: 13, marginBottom: 12, lineHeight: 1.4, paddingLeft: 2 }}>
            Drag and drop a folder from the left sidebar to sync it with your local desktop.
          </div>

          <div
            style={{
              minHeight: 88,
              background: isDragging ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
              border: isDragging
                ? '1px dashed #71717a'
                : draftResources.length > 0
                  ? '1px solid rgba(255,255,255,0.15)'
                  : '1px dashed rgba(255,255,255,0.15)',
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
              color: isDragging ? '#a1a1aa' : '#71717a',
            }}>
              <div style={{ color: isDragging ? '#d4d4d4' : '#a1a1aa' }}><FolderIcon /></div>
              <span style={{ fontSize: 13 }}>
                {isDragging ? 'Drop folder here' : 'Drag a folder into this zone'}
              </span>
            </div>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
