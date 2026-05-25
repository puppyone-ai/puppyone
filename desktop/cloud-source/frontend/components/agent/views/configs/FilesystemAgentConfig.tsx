'use client';

import React, { useState } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import type { AccessResource } from '@/contexts/AgentContext';
import { isWithinScope } from '@/lib/repoApi';
import { ActivityIconButton } from '@/components/ActivityIconButton';
import { FolderIcon, getNodeIcon } from '../_icons';
import type { AgentConfigProps } from './ChatAgentConfig';

// Filesystem connector syncs a local folder with the cloud workspace.
// Only folders can be dragged in — individual files are not supported.

export function FilesystemAgentConfig({ scopeBoundary, scopeBoundaryLabel }: AgentConfigProps) {
  const { draftResources, addDraftResource, updateDraftResource, removeDraftResource } = useAgent();
  const [isDragging, setIsDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

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
      const nodePath: string = node.nodeId || node.id;
      // Scope-aware guard: when this config is opened from a scope
      // context, only folders inside that scope's boundary can be
      // attached. Out-of-scope drops surface an inline error.
      if (scopeBoundary !== undefined && !isWithinScope(nodePath, scopeBoundary)) {
        const boundary = scopeBoundaryLabel || (scopeBoundary === '' ? 'root' : `/${scopeBoundary}`);
        setDropError(
          `${node.name || nodePath} is outside this scope (${boundary}). Configure integrations for it from its own scope.`,
        );
        setTimeout(() => setDropError(null), 5000);
        return;
      }
      setDropError(null);
      addDraftResource({
        path: nodePath,
        nodeName: node.name,
        nodeType: 'folder',
        readonly: true,
      } as AccessResource);
    } catch { /* ignore */ }
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 500, color: 'var(--po-text-subtle)', marginBottom: 8, display: 'block',
  };

  return (
    <>
      {/* Workspace folder in a styled callout bubble */}
      <div style={{ position: 'relative', marginTop: 16 }}>
        {/* CSS Triangle pointing up to the Workspace logo */}
        <div style={{
          position: 'absolute',
          top: '-8px',
          left: 'calc(50% + 68px)',
          width: '16px',
          height: '16px',
          background: 'var(--po-hover)',
          borderLeft: '1px solid var(--po-border)',
          borderTop: '1px solid var(--po-border)',
          transform: 'rotate(45deg)',
          zIndex: 3,
          marginLeft: '-8px'
        }} />

        <div style={{
          position: 'relative',
          background: 'var(--po-hover)',
          border: '1px solid var(--po-border)',
          borderRadius: '8px',
          padding: '16px',
          zIndex: 2
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <label style={{ ...labelStyle, marginBottom: 0, paddingLeft: 2, color: 'var(--po-text)' }}>Workspace Folder</label>
            <span style={{ width: 5, height: 5, background: 'var(--po-danger)', borderRadius: '50%' }} title="Required" />
            <span style={{ fontSize: 11, color: 'var(--po-text-disabled)', background: 'var(--po-panel-raised)', border: '1px solid var(--po-border)', borderRadius: 4, padding: '1px 6px', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
              folder only · max 1
            </span>
          </div>
          <div style={{ color: 'var(--po-text-muted)', fontSize: 13, marginBottom: 12, lineHeight: 1.4, paddingLeft: 2 }}>
            Drag and drop a folder from the left sidebar to sync it with your local desktop.
          </div>

          {scopeBoundary !== undefined && (
            <div style={{ fontSize: 11, color: 'var(--po-text-subtle)', paddingLeft: 2, marginBottom: 8, lineHeight: 1.5 }}>
              Only folders inside{' '}
              <code style={{ color: 'var(--po-text-muted)' }}>
                {scopeBoundary === '' ? '/ (root)' : `/${scopeBoundary}`}
              </code>{' '}
              can be attached.
            </div>
          )}

          {dropError && (
            <div
              style={{
                fontSize: 12, color: 'var(--po-danger)',
                background: 'color-mix(in srgb, var(--po-danger) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--po-danger) 25%, transparent)',
                borderRadius: 6, padding: '6px 10px',
                marginBottom: 8, lineHeight: 1.5,
              }}
              role="alert"
            >
              {dropError}
            </div>
          )}

          <div
            style={{
              minHeight: 88,
              background: isDragging ? 'var(--po-hover)' : 'var(--po-panel)',
              border: isDragging
                ? '1px dashed var(--po-text-subtle)'
                : draftResources.length > 0
                  ? '1px solid var(--po-border-strong)'
                  : '1px dashed var(--po-border-strong)',
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
                  key={resource.path}
                  style={{
                    height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 10px', borderRadius: 4, background: 'var(--po-panel-raised)', border: '1px solid var(--po-border-strong)', transition: 'all 0.1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--po-hover)'; e.currentTarget.style.borderColor = 'var(--po-border-strong)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--po-panel-raised)'; e.currentTarget.style.borderColor = 'var(--po-border-strong)'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1, minWidth: 0 }}>
                    <div style={{ color, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</div>
                    <span style={{ fontSize: 14, color: 'var(--po-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {resource.nodeName}
                    </span>
                  </div>
                  <ActivityIconButton
                    kind="close"
                    title="Remove resource"
                    size="sm"
                    onClick={() => removeDraftResource(resource.path)}
                  />
                </div>
              );
            })}
          </div>

          {draftResources.length === 0 && (
            <div style={{
              minHeight: 88,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
              color: isDragging ? 'var(--po-text-muted)' : 'var(--po-text-subtle)',
            }}>
              <div style={{ color: isDragging ? 'var(--po-text)' : 'var(--po-text-muted)' }}><FolderIcon /></div>
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
