'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import type { AccessResource } from '@/contexts/AgentContext';
import type { Tool as DbTool } from '@/lib/mcpApi';
import { isWithinScope } from '@/lib/repoApi';
import { ActivityIconButton } from '@/components/ActivityIconButton';
import {
  FolderIcon, JsonIcon, MarkdownIcon,
  PlusIcon, ChevronDownIcon,
  ToolIcon, toolTypeLabels, getNodeIcon,
} from '../_icons';

export interface AgentConfigProps {
  projectTools?: DbTool[];
  /**
   * Canonical path of the scope this config edits, when it's opened from
   * a scope context (e.g. clicking the "AI Agent" default in the scope
   * panel). When set, drop targets reject folders outside the scope —
   * the user is then prompted to configure those at the parent scope
   * instead. Pass `undefined` from non-scope contexts to keep the
   * legacy permissive behaviour.
   */
  scopeBoundary?: string;
  /** Human-readable name for the scope (used in the rejection toast). */
  scopeBoundaryLabel?: string;
}

export function ChatAgentConfig({
  projectTools,
  targetLabel,
  targetDescription,
  scopeBoundary,
  scopeBoundaryLabel,
}: AgentConfigProps & {
  targetLabel?: string;
  targetDescription?: string;
}) {
  const { draftResources, addDraftResource, updateDraftResource, removeDraftResource } = useAgent();

  const [isDragging, setIsDragging] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set());
  const [dropError, setDropError] = useState<string | null>(null);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) {
        setIsToolsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Drag & drop ──────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
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
      const nodePath: string = node.nodeId || node.id;
      // Scope-aware guard (redesign Q1 decision 2026-05-04): when this
      // config is opened from a scope context, only folders within that
      // scope's boundary can be attached. Out-of-scope drops surface an
      // inline error pointing the user back to the parent scope where
      // the integration should be configured instead.
      if (scopeBoundary !== undefined && !isWithinScope(nodePath, scopeBoundary)) {
        const boundary = scopeBoundaryLabel || (scopeBoundary === '' ? 'root' : `/${scopeBoundary}`);
        setDropError(
          `${node.name || nodePath} is outside this scope (${boundary}). Configure integrations for it from its own scope.`,
        );
        setTimeout(() => setDropError(null), 5000);
        return;
      }
      if (draftResources.some(r => r.path === nodePath)) return;
      const newResource: AccessResource = {
        path: nodePath,
        nodeName: node.name,
        nodeType: node.type === 'folder' ? 'folder' : node.type === 'json' ? 'json' : 'file',
        readonly: false,
      };
      setDropError(null);
      addDraftResource(newResource);
    } catch { /* ignore */ }
  };

  const toggleReadonly = (path: string) => {
    const resource = draftResources.find(r => r.path === path);
    if (!resource) return;
    const current = resource.readonly ?? true;
    updateDraftResource(path, { readonly: !current });
  };

  // ── Tools ────────────────────────────────────────────────────
  const selectedTools = useMemo(() => {
    if (!projectTools) return [];
    return projectTools.filter(t => selectedToolIds.has(t.id));
  }, [projectTools, selectedToolIds]);

  const handleAddTool = (toolId: string) => {
    setSelectedToolIds(prev => {
      const next = new Set(prev);
      next.has(toolId) ? next.delete(toolId) : next.add(toolId);
      return next;
    });
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 13, fontWeight: 500, color: 'var(--po-text-subtle)', marginBottom: 8, display: 'block',
  };

  return (
    <>
      {/* Agent's bash access wrapped in a styled callout bubble */}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <label style={{ ...labelStyle, marginBottom: 0, paddingLeft: 2, color: 'var(--po-text)' }}>{targetLabel || 'Agent Access Target'}</label>
            <span style={{ width: 5, height: 5, background: 'var(--po-danger)', borderRadius: '50%' }} title="Required" />
          </div>
          <div style={{ color: 'var(--po-text-muted)', fontSize: 13, marginBottom: 12, lineHeight: 1.4, paddingLeft: 2 }}>
            {targetDescription || 'Drag and drop a folder to define the workspace scope this agent can interact with.'}
          </div>

          {scopeBoundary !== undefined && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--po-text-subtle)',
                paddingLeft: 2,
                marginBottom: 8,
                lineHeight: 1.5,
              }}
            >
              Only folders inside{' '}
              <code style={{ color: 'var(--po-text-muted)' }}>
                {scopeBoundary === '' ? '/ (root)' : `/${scopeBoundary}`}
              </code>{' '}
              can be attached. To configure folders outside this scope, use their parent scope.
            </div>
          )}

          {dropError && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--po-danger)',
                background: 'color-mix(in srgb, var(--po-danger) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--po-danger) 25%, transparent)',
                borderRadius: 6,
                padding: '6px 10px',
                marginBottom: 8,
                lineHeight: 1.5,
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
              border: isDragging ? '1px dashed var(--po-text-subtle)' : draftResources.length > 0 ? '1px solid var(--po-border-strong)' : '1px dashed var(--po-border-strong)',
              borderRadius: 6,
              transition: 'all 0.15s',
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
          <div style={{ padding: draftResources.length > 0 ? 6 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {draftResources.map((resource) => {
              const { icon, color } = getNodeIcon(resource.nodeType);
              const pathDisplay = resource.nodeName;
              const isReadonly = resource.readonly ?? true;
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
                      {pathDisplay}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <div style={{ display: 'flex', background: 'var(--po-panel)', border: '1px solid var(--po-border)', borderRadius: 4, padding: 2, gap: 1 }}>
                      <button
                        onClick={() => { if (!isReadonly) toggleReadonly(resource.path); }}
                        style={{ background: isReadonly ? 'var(--po-border-strong)' : 'transparent', border: 'none', borderRadius: 3, color: isReadonly ? 'var(--po-text)' : 'var(--po-text-disabled)', cursor: 'pointer', fontSize: 11, padding: '3px 10px', fontWeight: 500, transition: 'all 0.1s' }}
                      >View</button>
                      <button
                        onClick={() => { if (isReadonly) toggleReadonly(resource.path); }}
                        style={{ background: !isReadonly ? 'color-mix(in srgb, var(--po-warning) 15%, transparent)' : 'transparent', border: 'none', borderRadius: 3, color: !isReadonly ? 'var(--po-warning)' : 'var(--po-text-disabled)', cursor: 'pointer', fontSize: 11, padding: '3px 10px', fontWeight: 500, transition: 'all 0.1s' }}
                      >Edit</button>
                    </div>
                    <ActivityIconButton
                      kind="close"
                      title="Remove resource"
                      size="sm"
                      onClick={() => removeDraftResource(resource.path)}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{
            minHeight: draftResources.length > 0 ? 32 : 88,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            color: isDragging ? 'var(--po-text-muted)' : 'var(--po-text-subtle)',
          }}>
            {draftResources.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ color: isDragging ? 'var(--po-text)' : 'var(--po-text-muted)' }}><FolderIcon /></div>
                <div style={{ color: isDragging ? 'var(--po-success)' : 'var(--po-success)' }}><JsonIcon /></div>
                <div style={{ color: isDragging ? 'var(--po-accent-text)' : 'var(--po-accent)' }}><MarkdownIcon /></div>
              </div>
            )}
            <span style={{ fontSize: 12 }}>
              {isDragging ? 'Drop here' : draftResources.length > 0 ? 'Drag more' : 'Drag items into this'}
            </span>
          </div>
        </div>
      </div>
      </div>

      {/* HIDDEN: Agent's tools section temporarily disabled */}
    </>
  );
}
