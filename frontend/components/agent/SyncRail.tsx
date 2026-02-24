'use client';

import React, { useCallback } from 'react';
import useSWR from 'swr';
import { get } from '@/lib/apiClient';
import { useAgent, type SavedAgent } from '@/contexts/AgentContext';

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

type ItemKind = 'agent' | 'sync' | 'upload';

interface RailItem {
  kind: ItemKind;
  id: string;
  label: string;
  statusColor: string;
  pulse?: boolean;
  sortPriority: number;
  providerOrType: string;
  agent?: SavedAgent;
  sync?: SyncStatusItem;
  upload?: UploadStatusItem;
}

// ============================================================
// Provider icons — reuse /icons/* assets from public folder
// ============================================================

function ProviderImg({ src, alt, size }: { src: string; alt: string; size: number }) {
  return <img src={src} alt={alt} width={size} height={size} style={{ display: 'block' }} />;
}

function GitHubIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#a1a1aa">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
}

function getProviderIcon(provider: string, size: number): React.ReactNode {
  switch (provider) {
    case 'gmail': return <ProviderImg src="/icons/gmail.svg" alt="Gmail" size={size} />;
    case 'google_calendar': return <ProviderImg src="/icons/google_calendar.svg" alt="Google Calendar" size={size} />;
    case 'google_sheets': return <ProviderImg src="/icons/google_sheet.svg" alt="Google Sheets" size={size} />;
    case 'google_drive': return <ProviderImg src="/icons/google_doc.svg" alt="Google Drive" size={size} />;
    case 'google_docs': return <ProviderImg src="/icons/google_doc.svg" alt="Google Docs" size={size} />;
    case 'github': return <GitHubIcon size={size} />;
    case 'notion': return <ProviderImg src="/icons/notion.svg" alt="Notion" size={size} />;
    case 'linear': return <ProviderImg src="/icons/linear.svg" alt="Linear" size={size} />;
    case 'filesystem':
    case 'openclaw':
      return <span style={{ fontSize: size * 0.85, lineHeight: 1 }}>🦞</span>;
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
  }
}

function getAgentIcon(type: string, size: number): React.ReactNode {
  if (type === 'devbox') return <span style={{ fontSize: size * 0.85, lineHeight: 1 }}>🦞</span>;
  if (type === 'chat') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
  if (type === 'schedule') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
  if (type === 'webhook') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M8 12h8" />
    </svg>
  );
}

// ============================================================
// Constants & Helpers
// ============================================================

const RAIL_WIDTH = 48;

const PROVIDER_SHORT: Record<string, string> = {
  filesystem: 'OpenClaw', openclaw: 'OpenClaw',
  github: 'GitHub', notion: 'Notion', gmail: 'Gmail',
  google_calendar: 'Calendar', google_sheets: 'Sheets',
  google_drive: 'Drive', google_docs: 'Docs',
  airtable: 'Airtable', linear: 'Linear',
  url: 'URL', webhook: 'Webhook',
};

const DIRECTION_ARROWS: Record<string, string> = {
  inbound: '\u2190', outbound: '\u2192', bidirectional: '\u2194',
};

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

// ============================================================
// Build rail items
// ============================================================

function buildItems(
  agents: SavedAgent[],
  syncs: SyncStatusItem[],
  uploads: UploadStatusItem[],
): RailItem[] {
  const items: RailItem[] = [];

  const hasOpenClawSync = syncs.some(s => s.provider === 'openclaw' || s.provider === 'filesystem');
  for (const a of agents) {
    if (a.type === 'devbox' && hasOpenClawSync) continue;
    items.push({
      kind: a.type === 'devbox' ? 'sync' as ItemKind : 'agent',
      id: a.type === 'devbox' ? `agent:${a.id}` : `agent:${a.id}`,
      label: a.type === 'devbox' ? (a.resources?.[0]?.nodeName || 'OpenClaw') : a.name,
      statusColor: '#22c55e', sortPriority: 2,
      providerOrType: a.type === 'devbox' ? 'openclaw' : a.type, agent: a,
    });
  }

  for (const s of syncs) {
    items.push({
      kind: 'sync', id: `sync:${s.id}`,
      label: s.node_name || PROVIDER_SHORT[s.provider] || s.provider,
      statusColor: statusToColor(s.status),
      pulse: s.status === 'syncing',
      sortPriority: statusPriority(s.status),
      providerOrType: s.provider, sync: s,
    });
  }

  for (const u of uploads) {
    items.push({
      kind: 'upload', id: `upload:${u.id}`,
      label: u.task_type || 'Upload',
      statusColor: '#3b82f6', pulse: true, sortPriority: 1,
      providerOrType: u.task_type?.split('_')[0] || 'url', upload: u,
    });
  }

  items.sort((a, b) => a.sortPriority - b.sortPriority);
  return items;
}

// ============================================================
// Rail icon button
// ============================================================

function RailIcon({ item, isActive, onClick }: {
  item: RailItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const dirArrow = item.sync ? DIRECTION_ARROWS[item.sync.direction] || '' : '';
  const tooltip = item.kind === 'sync'
    ? `${PROVIDER_SHORT[item.sync!.provider] || item.sync!.provider} ${dirArrow} ${item.label}`
    : item.label;

  const icon = item.kind === 'agent'
    ? getAgentIcon(item.providerOrType, 15)
    : getProviderIcon(item.providerOrType, 15);

  return (
    <button
      onClick={onClick}
      title={tooltip}
      style={{
        position: 'relative',
        width: 32,
        height: 32,
        borderRadius: 8,
        border: 'none',
        background: isActive ? 'rgba(255,255,255,0.1)' : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 0.15s',
        flexShrink: 0,
        padding: 0,
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </span>

      {/* Status dot — top-right */}
      <span style={{
        position: 'absolute',
        top: 2,
        right: 2,
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: item.statusColor,
        border: '1.5px solid #1a1a1a',
        animation: item.pulse ? 'syncPulse 1.5s ease-in-out infinite' : undefined,
      }} />
    </button>
  );
}

// ============================================================
// SyncRail — exported
// ============================================================

export { RAIL_WIDTH };

export function SyncRail({ projectId }: { projectId: string }) {
  const {
    savedAgents, currentAgentId, selectedSyncId, sidebarMode,
    selectAgent, selectSync, openSetting, closeSidebar,
  } = useAgent();

  const { data: syncData } = useSWR<ProjectSyncStatus>(
    projectId ? ['sync-status', projectId] : null,
    () => get<ProjectSyncStatus>(`/api/v1/sync/status?project_id=${projectId}`),
    { refreshInterval: 15000, revalidateOnFocus: false, dedupingInterval: 5000 },
  );

  const items = buildItems(
    savedAgents,
    syncData?.syncs ?? [],
    syncData?.uploads ?? [],
  );

  const handleClick = useCallback((item: RailItem) => {
    if (item.agent) {
      const isShown = currentAgentId === item.agent.id
        && (sidebarMode === 'deployed' || sidebarMode === 'editing');
      if (isShown && sidebarMode === 'deployed') closeSidebar();
      else selectAgent(item.agent.id);
    } else if (item.sync) {
      const isShown = selectedSyncId === item.sync.id && sidebarMode === 'deployed';
      if (isShown) closeSidebar();
      else selectSync(item.sync.id, item.sync.node_id);
    }
  }, [currentAgentId, selectedSyncId, sidebarMode, closeSidebar, selectAgent, selectSync]);

  const handleAdd = () => {
    if (sidebarMode === 'setting') closeSidebar();
    else openSetting();
  };

  const isAddActive = sidebarMode === 'setting';
  const agentItems = items.filter(i => i.kind === 'agent');
  const otherItems = items.filter(i => i.kind !== 'agent');

  return (
    <div style={{
      width: RAIL_WIDTH,
      height: '100%',
      background: '#1a1a1a',
      borderLeft: '1px solid rgba(255,255,255,0.08)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      flexShrink: 0,
      overflowX: 'hidden',
    }}>
      {/* Header zone — 48px, aligned with main header */}
      <div style={{
        width: '100%', height: 48, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <button
          onClick={handleAdd}
          title="Add agent or sync"
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: isAddActive ? '1px solid #e5e5e5' : '1px solid rgba(255,255,255,0.12)',
            background: isAddActive ? '#e5e5e5' : 'rgba(255,255,255,0.06)',
            color: isAddActive ? '#000' : '#e5e5e5',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s',
            padding: 0,
          }}
          onMouseEnter={e => {
            if (!isAddActive) {
              e.currentTarget.style.background = '#e5e5e5';
              e.currentTarget.style.color = '#000';
              e.currentTarget.style.borderColor = '#e5e5e5';
            }
          }}
          onMouseLeave={e => {
            if (!isAddActive) {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
              e.currentTarget.style.color = '#e5e5e5';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
            }
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Divider — aligned with header bottom edge */}
      <div style={{ width: 24, height: 1, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />

      {/* Scrollable items area */}
      <div style={{
        flex: 1, width: '100%', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 10, paddingBottom: 10, gap: 10,
      }}>

      {agentItems.map(item => (
        <RailIcon
          key={item.id}
          item={item}
          isActive={
            currentAgentId === item.agent?.id
            && (sidebarMode === 'deployed' || sidebarMode === 'editing')
          }
          onClick={() => handleClick(item)}
        />
      ))}

      {agentItems.length > 0 && otherItems.length > 0 && (
        <div style={{
          width: 24, height: 1,
          background: 'rgba(255,255,255,0.08)',
          margin: '0',
          flexShrink: 0,
        }} />
      )}

      {otherItems.map(item => {
        const active = item.agent
          ? currentAgentId === item.agent.id && (sidebarMode === 'deployed' || sidebarMode === 'editing')
          : selectedSyncId === item.sync?.id && sidebarMode === 'deployed';
        return (
          <RailIcon
            key={item.id}
            item={item}
            isActive={active}
            onClick={() => handleClick(item)}
          />
        );
      })}

      </div>

      <style jsx global>{`
        @keyframes syncPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
