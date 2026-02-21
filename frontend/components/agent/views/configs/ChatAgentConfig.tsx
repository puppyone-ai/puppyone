'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import type { AccessResource } from '@/contexts/AgentContext';
import type { Tool as DbTool } from '@/lib/mcpApi';
import {
  FolderIcon, JsonIcon, MarkdownIcon,
  CloseIcon, PlusIcon, ChevronDownIcon,
  ToolIcon, toolTypeLabels, getNodeIcon,
} from '../_icons';

export interface AgentConfigProps {
  projectTools?: DbTool[];
}

export function ChatAgentConfig({ projectTools }: AgentConfigProps) {
  const { draftResources, addDraftResource, updateDraftResource, removeDraftResource } = useAgent();

  const [isDragging, setIsDragging] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set());
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
      if (draftResources.some(r => r.nodeId === node.id)) return;
      const newResource: AccessResource = {
        nodeId: node.nodeId || node.id,
        nodeName: node.name,
        nodeType: node.type === 'folder' ? 'folder' : node.type === 'json' ? 'json' : 'file',
        readonly: false,
        jsonPath: node.jsonPath || '',
      };
      addDraftResource(newResource);
    } catch { /* ignore */ }
  };

  const toggleReadonly = (nodeId: string) => {
    const resource = draftResources.find(r => r.nodeId === nodeId);
    if (!resource) return;
    const current = resource.readonly ?? resource.terminalReadonly ?? true;
    updateDraftResource(nodeId, { readonly: !current });
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
    fontSize: 13, fontWeight: 500, color: '#666', marginBottom: 8, display: 'block',
  };

  return (
    <>
      {/* Agent's bash access */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Agent's bash access</label>
          <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
        </div>

        <div
          style={{
            minHeight: 88,
            background: isDragging ? 'rgba(255,255,255,0.03)' : 'transparent',
            border: isDragging ? '1px dashed #525252' : '1px dashed #2a2a2a',
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
              const pathDisplay = resource.jsonPath
                ? `${resource.nodeName} (${resource.jsonPath})`
                : resource.nodeName;
              const isReadonly = resource.readonly ?? resource.terminalReadonly ?? true;
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
                      {pathDisplay}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <div style={{ display: 'flex', background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: 4, padding: 2, gap: 1 }}>
                      <button
                        onClick={() => { if (!isReadonly) toggleReadonly(resource.nodeId); }}
                        style={{ background: isReadonly ? '#333' : 'transparent', border: 'none', borderRadius: 3, color: isReadonly ? '#e5e5e5' : '#505050', cursor: 'pointer', fontSize: 11, padding: '3px 10px', fontWeight: 500, transition: 'all 0.1s' }}
                      >View</button>
                      <button
                        onClick={() => { if (isReadonly) toggleReadonly(resource.nodeId); }}
                        style={{ background: !isReadonly ? 'rgba(249,115,22,0.15)' : 'transparent', border: 'none', borderRadius: 3, color: !isReadonly ? '#fb923c' : '#505050', cursor: 'pointer', fontSize: 11, padding: '3px 10px', fontWeight: 500, transition: 'all 0.1s' }}
                      >Edit</button>
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
                </div>
              );
            })}
          </div>

          <div style={{
            minHeight: draftResources.length > 0 ? 32 : 88,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            color: isDragging ? '#a1a1aa' : '#525252',
          }}>
            {draftResources.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ color: isDragging ? '#d4d4d4' : '#a1a1aa' }}><FolderIcon /></div>
                <div style={{ color: isDragging ? '#6ee7b7' : '#34d399' }}><JsonIcon /></div>
                <div style={{ color: isDragging ? '#93c5fd' : '#60a5fa' }}><MarkdownIcon /></div>
              </div>
            )}
            <span style={{ fontSize: 12 }}>
              {isDragging ? 'Drop here' : draftResources.length > 0 ? 'Drag more' : 'Drag items into this'}
            </span>
          </div>
        </div>
      </div>

      {/* Agent's tools */}
      <div style={{ position: 'relative', zIndex: isToolsOpen ? 50 : 20 }} ref={toolsRef}>
        <label style={labelStyle}>Agent's tools</label>
        <button
          onClick={() => setIsToolsOpen(!isToolsOpen)}
          style={{
            width: '100%', height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: '#161616', border: `1px solid ${isToolsOpen ? '#525252' : '#2a2a2a'}`, borderRadius: 6,
            padding: '0 10px', color: '#e5e5e5', cursor: 'pointer', fontSize: 14, textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PlusIcon /><span style={{ color: '#737373' }}>Add a tool...</span>
          </div>
          <ChevronDownIcon open={isToolsOpen} />
        </button>

        {isToolsOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6,
            overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', zIndex: 100, maxHeight: 240, overflowY: 'auto',
          }}>
            {(!projectTools || projectTools.length === 0) ? (
              <div style={{ padding: '16px 12px', textAlign: 'center', color: '#525252', fontSize: 13 }}>
                <div style={{ marginBottom: 4 }}>No tools configured</div>
                <div style={{ fontSize: 11 }}>Add tools in Toolkit</div>
              </div>
            ) : projectTools.map((tool) => {
              const typeInfo = toolTypeLabels[tool.type] || { label: tool.type, desc: '' };
              const isSelected = selectedToolIds.has(tool.id);
              return (
                <button
                  key={tool.id}
                  onClick={() => handleAddTool(tool.id)}
                  style={{
                    width: '100%', height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 10px', gap: 8,
                    background: isSelected ? 'rgba(34,197,94,0.1)' : 'transparent',
                    border: 'none', borderBottom: '1px solid #1f1f1f', cursor: 'pointer', textAlign: 'left', fontSize: 13,
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#1f1f1f'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'rgba(34,197,94,0.1)' : 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, color: isSelected ? '#22c55e' : '#737373' }}>
                    <div style={{ width: 14, height: 14, flexShrink: 0, borderRadius: 3, border: isSelected ? 'none' : '1px solid #525252', background: isSelected ? '#22c55e' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {isSelected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                    </div>
                    <ToolIcon type={tool.type} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tool.name || typeInfo.label}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: '#525252', flexShrink: 0 }}>{tool.description || typeInfo.desc}</span>
                </button>
              );
            })}
          </div>
        )}

        {selectedTools.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {selectedTools.map((tool) => {
              const typeInfo = toolTypeLabels[tool.type] || { label: tool.type, desc: '' };
              return (
                <div
                  key={tool.id}
                  style={{
                    height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 10px', background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6, fontSize: 13,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#a3a3a3', flex: 1, minWidth: 0 }}>
                    <ToolIcon type={tool.type} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tool.name || typeInfo.label}
                    </span>
                  </div>
                  <button
                    onClick={() => handleAddTool(tool.id)}
                    style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#525252', flexShrink: 0 }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#2a2a2a'; e.currentTarget.style.color = '#ef4444'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#525252'; }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
