'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import type { AccessResource } from '@/contexts/AgentContext';
import { ActivityIconButton } from '@/components/ActivityIconButton';
import { FolderIcon, JsonIcon, MarkdownIcon, getNodeIcon } from '../_icons';

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
      draftResources.forEach(r => removeDraftResource(r.path));
      prevMode.current = mode;
    }
  }, [mode]);

  // In "new" mode, sync the name to a draft resource
  useEffect(() => {
    if (mode !== 'new') return;
    const existing = draftResources.find(r => r.path.startsWith('__new:'));
    if (newName.trim()) {
      if (existing) {
        if (existing.nodeName !== newName.trim()) {
          removeDraftResource(existing.path);
          addDraftResource({ path: `__new:${Date.now()}`, nodeName: newName.trim(), nodeType: primaryType, readonly: true } as AccessResource);
        }
      } else {
        addDraftResource({ path: `__new:${Date.now()}`, nodeName: newName.trim(), nodeType: primaryType, readonly: true } as AccessResource);
      }
    } else if (existing) {
      removeDraftResource(existing.path);
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
      if (draftResources.some(r => r.path === (node.nodeId || node.id))) return;
      addDraftResource({ path: node.nodeId || node.id, nodeName: node.name, nodeType, readonly: true } as AccessResource);
    } catch { /* ignore */ }
  };

  const acceptIcons = accept.map(t => {
    switch (t) {
      case 'folder': return { key: t, el: <FolderIcon />, color: 'var(--po-text-muted)' };
      case 'json': return { key: t, el: <JsonIcon />, color: 'var(--po-success)' };
      case 'markdown': return { key: t, el: <MarkdownIcon />, color: 'var(--po-accent)' };
      default: return { key: t, el: <FolderIcon />, color: 'var(--po-text-muted)' };
    }
  });

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--po-text-subtle)' }}>{label}</label>
        <span style={{ width: 5, height: 5, background: 'var(--po-danger)', borderRadius: '50%' }} title="Required" />
        <span style={{ fontSize: 11, color: 'var(--po-text-disabled)', background: 'var(--po-panel-raised)', border: '1px solid var(--po-border)', borderRadius: 4, padding: '1px 6px', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {hint}
        </span>
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', marginBottom: 8, background: 'var(--po-control)', borderRadius: 6, border: '1px solid var(--po-border-strong)', padding: 2 }}>
        {(['new', 'existing'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              flex: 1, height: 30, borderRadius: 4, border: 'none', fontSize: 11, fontWeight: 500, cursor: 'pointer',
              background: mode === m ? 'var(--po-border-strong)' : 'transparent',
              color: mode === m ? 'var(--po-text)' : 'var(--po-text-disabled)',
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
                background: 'var(--po-panel)', border: '1px solid var(--po-border)', borderRadius: 6,
                color: 'var(--po-text)', fontSize: 12, outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--po-border-strong)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--po-border)'}
            />
            <span style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              fontSize: 10, color: 'var(--po-text-disabled)', background: 'var(--po-panel-raised)', border: '1px solid var(--po-border-strong)',
              borderRadius: 3, padding: '1px 5px',
            }}>
              .{primaryType === 'json' ? 'json' : primaryType === 'markdown' ? 'md' : primaryType}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--po-border-strong)', display: 'flex', alignItems: 'center', gap: 4 }}>
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
            background: isDragging ? 'var(--po-hover)' : 'transparent',
            border: isDragging ? '1px dashed var(--po-text-disabled)' : isFull ? '1px solid var(--po-border)' : '1px dashed var(--po-border)',
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
                    key={res.path}
                    style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px', borderRadius: 4, background: 'var(--po-panel-raised)', border: '1px solid var(--po-border-strong)', transition: 'all 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--po-hover)'; e.currentTarget.style.borderColor = 'var(--po-border-strong)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--po-panel-raised)'; e.currentTarget.style.borderColor = 'var(--po-border-strong)'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1, minWidth: 0 }}>
                      <div style={{ color, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</div>
                      <span style={{ fontSize: 14, color: 'var(--po-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {res.nodeName}
                      </span>
                    </div>
                    <ActivityIconButton
                      kind="close"
                      title="Remove resource"
                      size="sm"
                      onClick={() => removeDraftResource(res.path)}
                    />
                  </div>
                );
              })}
            </div>
          )}
          {!isFull && (
            <div style={{
              minHeight: draftResources.length > 0 ? 32 : 80,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
              color: isDragging ? 'var(--po-text-muted)' : 'var(--po-text-disabled)',
            }}>
              {draftResources.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {acceptIcons.map(({ key, el, color }) => (
                    <div key={key} style={{ color: isDragging ? 'var(--po-text)' : color }}>{el}</div>
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
