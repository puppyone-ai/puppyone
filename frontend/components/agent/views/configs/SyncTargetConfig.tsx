'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import type { AccessResource } from '@/contexts/AgentContext';
import { FolderIcon, JsonIcon, MarkdownIcon, CloseIcon, getNodeIcon } from '../_icons';

export type AcceptedNodeType = 'folder' | 'json' | 'markdown' | 'file';

export interface SyncTargetConfigProps {
  accept: AcceptedNodeType[];
  label: string;
  hint: string;
  maxItems?: number;
  defaultNewName?: string;
}

const TYPE_LABELS: Record<AcceptedNodeType, string> = {
  folder: 'folder', json: 'JSON file', markdown: 'Markdown file', file: 'file',
};

export function SyncTargetConfig({ accept, label, hint, maxItems = 1, defaultNewName }: SyncTargetConfigProps) {
  const { draftResources, addDraftResource, removeDraftResource } = useAgent();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [newName, setNewName] = useState(defaultNewName || '');
  const [isDragging, setIsDragging] = useState(false);
  const prevMode = useRef(mode);
  const isFull = draftResources.length >= maxItems;
  const primaryType = accept[0];

  // When switching modes, clear drafts
  useEffect(() => {
    if (prevMode.current !== mode) {
      draftResources.forEach(r => removeDraftResource(r.nodeId));
      prevMode.current = mode;
    }
  }, [mode]);

  // In "new" mode, sync the name to a draft resource
  useEffect(() => {
    if (mode !== 'new') return;
    const existing = draftResources.find(r => r.nodeId.startsWith('__new:'));
    if (newName.trim()) {
      if (existing) {
        if (existing.nodeName !== newName.trim()) {
          removeDraftResource(existing.nodeId);
          addDraftResource({ nodeId: `__new:${Date.now()}`, nodeName: newName.trim(), nodeType: primaryType, readonly: true, jsonPath: '' } as AccessResource);
        }
      } else {
        addDraftResource({ nodeId: `__new:${Date.now()}`, nodeName: newName.trim(), nodeType: primaryType, readonly: true, jsonPath: '' } as AccessResource);
      }
    } else if (existing) {
      removeDraftResource(existing.nodeId);
    }
  }, [newName, mode]);

  // ── Drag handlers (for "existing" mode) ──
  const handleDragOver = (e: React.DragEvent) => {
    if (mode !== 'existing' || isFull) return;
    if (e.dataTransfer.types.includes('application/x-puppyone-node')) {
      e.preventDefault(); e.stopPropagation(); setIsDragging(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent) => { e.stopPropagation(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    if (mode !== 'existing' || isFull) return;
    const data = e.dataTransfer.getData('application/x-puppyone-node');
    if (!data) return;
    try {
      const node = JSON.parse(data);
      const nodeType: AcceptedNodeType = node.type === 'folder' ? 'folder' : node.type === 'json' ? 'json' : node.type === 'markdown' ? 'markdown' : 'file';
      if (!accept.includes(nodeType)) return;
      if (draftResources.some(r => r.nodeId === (node.nodeId || node.id))) return;
      addDraftResource({ nodeId: node.nodeId || node.id, nodeName: node.name, nodeType, readonly: true, jsonPath: node.jsonPath || '' } as AccessResource);
    } catch { /* ignore */ }
  };

  const acceptIcons = accept.map(t => {
    switch (t) {
      case 'folder': return { key: t, el: <FolderIcon />, color: '#a1a1aa' };
      case 'json': return { key: t, el: <JsonIcon />, color: '#34d399' };
      case 'markdown': return { key: t, el: <MarkdownIcon />, color: '#60a5fa' };
      default: return { key: t, el: <FolderIcon />, color: '#a1a1aa' };
    }
  });

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: '#666' }}>{label}</label>
        <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
        <span style={{ fontSize: 11, color: '#525252', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, padding: '1px 6px', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {hint}
        </span>
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', marginBottom: 8, background: '#141414', borderRadius: 6, border: '1px solid #252525', padding: 2 }}>
        {(['new', 'existing'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              flex: 1, height: 26, borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 500, cursor: 'pointer',
              background: mode === m ? '#252525' : 'transparent',
              color: mode === m ? '#e5e5e5' : '#525252',
              transition: 'all 0.12s',
            }}
          >
            {m === 'new' ? 'Create new' : 'Use existing'}
          </button>
        ))}
      </div>

      {/* ── Create new mode ── */}
      {mode === 'new' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={`e.g. ${primaryType === 'folder' ? 'My Sync Folder' : primaryType === 'json' ? 'inbox-data' : 'notes'}`}
              style={{
                width: '100%', height: 32, padding: '0 10px', paddingRight: 80,
                background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6,
                color: '#e5e5e5', fontSize: 12, outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => e.currentTarget.style.borderColor = '#3a3a3a'}
              onBlur={e => e.currentTarget.style.borderColor = '#2a2a2a'}
            />
            <span style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              fontSize: 10, color: '#525252', background: '#1a1a1a', border: '1px solid #252525',
              borderRadius: 3, padding: '1px 5px',
            }}>
              .{primaryType === 'json' ? 'json' : primaryType === 'markdown' ? 'md' : primaryType}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#3a3a3a', display: 'flex', alignItems: 'center', gap: 4 }}>
            {acceptIcons[0] && <span style={{ color: acceptIcons[0].color, display: 'flex' }}>{acceptIcons[0].el}</span>}
            Will create a new {TYPE_LABELS[primaryType]} in the current directory
          </div>
        </div>
      )}

      {/* ── Use existing mode ── */}
      {mode === 'existing' && (
        <div
          style={{
            minHeight: 80,
            background: isDragging ? 'rgba(255,255,255,0.03)' : 'transparent',
            border: isDragging ? '1px dashed #525252' : isFull ? '1px solid #2a2a2a' : '1px dashed #2a2a2a',
            borderRadius: 6, transition: 'all 0.15s',
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {draftResources.length > 0 && (
            <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {draftResources.map(res => {
                const { icon, color } = getNodeIcon(res.nodeType);
                return (
                  <div
                    key={res.nodeId}
                    style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px', borderRadius: 4, background: '#1a1a1a', border: '1px solid #252525', transition: 'all 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#222'; e.currentTarget.style.borderColor = '#333'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.borderColor = '#252525'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1, minWidth: 0 }}>
                      <div style={{ color, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</div>
                      <span style={{ fontSize: 14, color: '#e5e5e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {res.jsonPath ? `${res.nodeName} (${res.jsonPath})` : res.nodeName}
                      </span>
                    </div>
                    <button
                      onClick={() => removeDraftResource(res.nodeId)}
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
          )}
          {!isFull && (
            <div style={{
              minHeight: draftResources.length > 0 ? 32 : 80,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
              color: isDragging ? '#a1a1aa' : '#525252',
            }}>
              {draftResources.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {acceptIcons.map(({ key, el, color }) => (
                    <div key={key} style={{ color: isDragging ? '#d4d4d4' : color }}>{el}</div>
                  ))}
                </div>
              )}
              <span style={{ fontSize: 12 }}>
                {isDragging ? 'Drop here' : draftResources.length > 0 ? 'Drag more' : `Drag ${accept.length === 1 ? (accept[0] === 'folder' ? 'a folder' : `a ${accept[0]} file`) : 'an item'} here`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
