'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import useSWR from 'swr';
import { get } from '@/lib/apiClient';
import { useAgent, type SavedAgent, type AccessResource } from '@/contexts/AgentContext';

// ============================================================
// Types
// ============================================================

interface SyncStatusItem {
  id: string;
  node_id: string;
  node_name: string | null;
  provider: string;
  direction: string;
  status: string;
  last_synced_at: string | null;
  error_message: string | null;
}

interface UploadStatusItem {
  id: string;
  node_id: string | null;
  type: string;
  task_type: string | null;
  status: string;
  progress: number;
  message: string | null;
}

interface ProjectSyncStatus {
  syncs: SyncStatusItem[];
  uploads: UploadStatusItem[];
}

type ChipKind = 'agent' | 'sync' | 'upload';

interface UnifiedChip {
  kind: ChipKind;
  id: string;
  label: string;
  icon: React.ReactNode;
  statusColor: string;
  pulse?: boolean;
  sortPriority: number;
  agent?: SavedAgent;
  sync?: SyncStatusItem;
  upload?: UploadStatusItem;
}

// ============================================================
// Constants
// ============================================================

const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif";
const MAX_VISIBLE = 8;

const PROVIDER_SHORT: Record<string, string> = {
  filesystem: 'OClaw',
  openclaw: 'OClaw',
  github: 'GitHub',
  notion: 'Notion',
  gmail: 'Gmail',
  google_calendar: 'Cal',
  google_sheets: 'Sheets',
  google_drive: 'Drive',
  google_docs: 'Docs',
  airtable: 'Airtable',
  linear: 'Linear',
  url: 'URL',
  webhook: 'Hook',
};

const PROVIDER_COLORS: Record<string, string> = {
  github: '#8b5cf6',
  notion: '#fff',
  gmail: '#ea4335',
  google_calendar: '#4285f4',
  google_sheets: '#34a853',
  google_drive: '#fbbc04',
  google_docs: '#4285f4',
  airtable: '#18bfff',
  linear: '#5e6ad2',
  filesystem: '#22c55e',
  openclaw: '#22c55e',
  url: '#888',
  webhook: '#f59e0b',
};

const DIRECTION_ARROWS: Record<string, string> = {
  inbound: '←',
  outbound: '→',
  bidirectional: '↔',
};

// ============================================================
// Helpers
// ============================================================

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function mapNodeType(backendType: string): 'folder' | 'json' | 'file' {
  if (backendType === 'folder') return 'folder';
  if (backendType === 'json') return 'json';
  return 'file';
}

function statusToColor(status: string): string {
  if (status === 'error') return '#ef4444';
  if (status === 'syncing' || status === 'running') return '#3b82f6';
  if (status === 'paused') return '#f59e0b';
  return '#22c55e';
}

function statusPriority(status: string): number {
  if (status === 'error') return 0;
  if (status === 'syncing' || status === 'running') return 1;
  if (status === 'active') return 3;
  if (status === 'paused') return 4;
  return 5;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ============================================================
// Small icon components
// ============================================================

function ProviderDot({ provider }: { provider: string }) {
  const bg = PROVIDER_COLORS[provider] || '#666';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 14, height: 14, borderRadius: 3, background: bg,
      color: provider === 'notion' ? '#000' : '#fff',
      fontSize: 7, fontWeight: 700, lineHeight: 1, flexShrink: 0,
    }}>
      {provider.charAt(0).toUpperCase()}
    </span>
  );
}

function AgentTypeIcon({ type }: { type: string }) {
  const size = 12;
  if (type === 'schedule') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
  if (type === 'webhook') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
  if (type === 'devbox') return <span style={{ fontSize: 11, lineHeight: 1 }}>🦞</span>;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ============================================================
// Build unified chip list
// ============================================================

function buildChips(
  agents: SavedAgent[],
  syncs: SyncStatusItem[],
  uploads: UploadStatusItem[],
): UnifiedChip[] {
  const chips: UnifiedChip[] = [];

  for (const a of agents) {
    chips.push({
      kind: 'agent',
      id: `agent:${a.id}`,
      label: truncate(a.name, 6),
      icon: <AgentTypeIcon type={a.type} />,
      statusColor: '#22c55e',
      sortPriority: 2,
      agent: a,
    });
  }

  for (const s of syncs) {
    chips.push({
      kind: 'sync',
      id: `sync:${s.id}`,
      label: truncate(s.node_name || PROVIDER_SHORT[s.provider] || s.provider, 6),
      icon: <ProviderDot provider={s.provider} />,
      statusColor: statusToColor(s.status),
      pulse: s.status === 'syncing',
      sortPriority: statusPriority(s.status),
      sync: s,
    });
  }

  for (const u of uploads) {
    chips.push({
      kind: 'upload',
      id: `upload:${u.id}`,
      label: truncate(u.task_type || 'Upload', 6),
      icon: <ProviderDot provider={u.task_type?.split('_')[0] || 'url'} />,
      statusColor: '#3b82f6',
      pulse: true,
      sortPriority: 1,
      upload: u,
    });
  }

  chips.sort((a, b) => a.sortPriority - b.sortPriority);
  return chips;
}

// ============================================================
// AccessDock — Unified process dock
// ============================================================

export function AccessDock({ projectId }: { projectId?: string | null }) {
  const {
    savedAgents, currentAgentId, selectedSyncId, sidebarMode,
    selectAgent, selectSync, openSetting, closeSidebar,
    hoveredAgentId, setHoveredAgentId, updateAgentResources,
  } = useAgent();

  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  const { data: syncData } = useSWR<ProjectSyncStatus>(
    projectId ? ['sync-status', projectId] : null,
    () => get<ProjectSyncStatus>(`/api/v1/sync/status?project_id=${projectId}`),
    { revalidateOnFocus: false, dedupingInterval: 5000 },
  );

  useEffect(() => {
    if (!overflowOpen) return;
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [overflowOpen]);

  const allChips = buildChips(
    savedAgents,
    syncData?.syncs ?? [],
    syncData?.uploads ?? [],
  );

  const visibleChips = allChips.slice(0, MAX_VISIBLE);
  const overflowChips = allChips.slice(MAX_VISIBLE);
  const errorCount = (syncData?.syncs ?? []).filter(s => s.status === 'error').length;

  const handleChipClick = useCallback((chip: UnifiedChip) => {
    if (chip.kind === 'agent' && chip.agent) {
      const isShown = currentAgentId === chip.agent.id
        && (sidebarMode === 'deployed' || sidebarMode === 'editing');
      if (isShown && sidebarMode === 'deployed') closeSidebar();
      else selectAgent(chip.agent.id);
    } else if (chip.kind === 'sync' && chip.sync) {
      const isShown = selectedSyncId === chip.sync.id && sidebarMode === 'deployed';
      if (isShown) closeSidebar();
      else selectSync(chip.sync.id);
    }
  }, [currentAgentId, selectedSyncId, sidebarMode, closeSidebar, selectAgent, selectSync]);

  const handleAddClick = () => {
    if (sidebarMode === 'setting') closeSidebar();
    else openSetting();
  };

  const handleNodeDrop = useCallback(async (agent: SavedAgent, nodeData: { id: string; name: string; type: string }) => {
    const existing = agent.resources || [];
    if (existing.some(r => r.nodeId === nodeData.id)) return;
    const newResource: AccessResource = {
      nodeId: nodeData.id, nodeName: nodeData.name,
      nodeType: mapNodeType(nodeData.type), readonly: true,
    };
    try {
      await updateAgentResources(agent.id, [...existing, newResource]);
    } catch { /* ignore */ }
  }, [updateAgentResources]);

  const isAddActive = sidebarMode === 'setting';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      {visibleChips.map(chip => (
        <ChipButton
          key={chip.id}
          chip={chip}
          isActive={
            (chip.kind === 'agent' && currentAgentId === chip.agent?.id
              && (sidebarMode === 'deployed' || sidebarMode === 'editing'))
            || (chip.kind === 'sync' && selectedSyncId === chip.sync?.id && sidebarMode === 'deployed')
          }
          isHovered={chip.kind === 'agent' && hoveredAgentId === chip.agent?.id}
          onClick={() => handleChipClick(chip)}
          onMouseEnter={() => chip.agent && setHoveredAgentId(chip.agent.id)}
          onMouseLeave={() => chip.agent && setHoveredAgentId(null)}
          onNodeDrop={chip.agent ? (nd) => handleNodeDrop(chip.agent!, nd) : undefined}
        />
      ))}

      {overflowChips.length > 0 && (
        <div ref={overflowRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setOverflowOpen(o => !o)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              height: 26, padding: '0 8px', borderRadius: 5,
              background: overflowOpen ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
              border: 'none',
              color: errorCount > 0 ? '#ef4444' : '#888',
              fontSize: 11, fontWeight: 500, fontFamily: FONT,
              cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!overflowOpen) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
            onMouseLeave={e => { if (!overflowOpen) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
          >
            +{overflowChips.length}
            {errorCount > 0 && <span style={{ color: '#ef4444' }}>⚠</span>}
          </button>

          {overflowOpen && (
            <div style={panelStyle}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: 10, color: '#666', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                +{overflowChips.length} more
              </div>
              {overflowChips.map(chip => (
                <OverflowRow key={chip.id} chip={chip} onClick={() => { handleChipClick(chip); setOverflowOpen(false); }} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add button */}
      <button
        onClick={handleAddClick}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          height: 26, padding: '0 8px', borderRadius: 5,
          background: isAddActive ? 'rgba(255,255,255,0.08)' : 'transparent',
          border: isAddActive ? '1px solid rgba(255,255,255,0.15)' : '1px dashed rgba(255,255,255,0.15)',
          color: isAddActive ? '#fff' : '#555',
          fontSize: 11, fontWeight: 500, fontFamily: FONT,
          cursor: 'pointer',
          transition: 'background 0.1s, color 0.1s, border-color 0.1s',
          whiteSpace: 'nowrap', flexShrink: 0,
          marginLeft: allChips.length > 0 ? 6 : 0,
        }}
        onMouseEnter={e => {
          if (!isAddActive) {
            e.currentTarget.style.color = '#999';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
          }
        }}
        onMouseLeave={e => {
          if (!isAddActive) {
            e.currentTarget.style.color = '#555';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add
      </button>

      <style jsx global>{`
        @keyframes syncPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// ============================================================
// ChipButton — unified chip for agents and syncs
// ============================================================

function ChipButton({ chip, isActive, isHovered, onClick, onMouseEnter, onMouseLeave, onNodeDrop }: {
  chip: UnifiedChip;
  isActive: boolean;
  isHovered: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onNodeDrop?: (nodeData: { id: string; name: string; type: string }) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (onNodeDrop && e.dataTransfer.types.includes('application/x-puppyone-node')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, [onNodeDrop]);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!onNodeDrop) return;
    const raw = e.dataTransfer.getData('application/x-puppyone-node');
    if (!raw) return;
    try { onNodeDrop(JSON.parse(raw)); } catch { /* ignore */ }
  }, [onNodeDrop]);

  const bg = isDragOver
    ? 'rgba(249, 115, 22, 0.25)'
    : isActive ? 'rgba(255,255,255,0.12)'
    : isHovered ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)';

  const borderStyle = isDragOver ? '1px solid rgba(249, 115, 22, 0.6)' : 'none';

  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title={chip.sync ? `${chip.sync.provider} ${DIRECTION_ARROWS[chip.sync.direction] || ''} ${chip.sync.node_name || ''}` : chip.label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        height: 26, padding: '0 8px', borderRadius: 5,
        background: bg, border: borderStyle,
        color: isDragOver ? '#f97316' : isActive ? '#fff' : isHovered ? '#ccc' : '#999',
        fontSize: 11, fontWeight: 500, fontFamily: FONT,
        cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s, border 0.15s',
        whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      <span style={{ display: 'flex', opacity: isActive || isDragOver ? 1 : 0.65 }}>
        {chip.icon}
      </span>
      {isDragOver ? 'Drop' : chip.label}
      <span style={{
        width: 5, height: 5, borderRadius: '50%',
        background: isDragOver ? '#f97316' : chip.statusColor,
        flexShrink: 0,
        opacity: isActive || isDragOver ? 1 : 0.5,
        animation: chip.pulse ? 'syncPulse 1.5s ease-in-out infinite' : undefined,
      }} />
    </button>
  );
}

// ============================================================
// Overflow row
// ============================================================

function OverflowRow({ chip, onClick }: { chip: UnifiedChip; onClick: () => void }) {
  const subtitle = chip.sync
    ? `${DIRECTION_ARROWS[chip.sync.direction] || '↔'} ${PROVIDER_SHORT[chip.sync.provider] || chip.sync.provider}${chip.sync.last_synced_at ? ' · ' + relativeTime(chip.sync.last_synced_at) : ''}`
    : chip.upload
    ? `${chip.upload.progress}% · ${chip.upload.message || 'Processing'}`
    : chip.agent?.type || '';

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', padding: '6px 12px',
        background: 'none', border: 'none', cursor: 'pointer',
        transition: 'background 0.1s',
        textAlign: 'left',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
      onMouseLeave={e => e.currentTarget.style.background = 'none'}
    >
      <span style={{ display: 'flex', flexShrink: 0 }}>{chip.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {chip.sync?.node_name || chip.label}
        </div>
        <div style={{ fontSize: 10, color: '#666' }}>{subtitle}</div>
        {chip.sync?.error_message && (
          <div style={{ fontSize: 10, color: '#ef4444', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {chip.sync.error_message}
          </div>
        )}
      </div>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: chip.statusColor, flexShrink: 0,
        animation: chip.pulse ? 'syncPulse 1.5s ease-in-out infinite' : undefined,
      }} />
    </button>
  );
}

// ============================================================
// Styles
// ============================================================

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  width: 300,
  maxHeight: 360,
  overflowY: 'auto',
  background: '#1e1e1e',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  zIndex: 100,
};
