'use client';

/**
 * Access Page
 *
 * Lists all access points (data syncs, agents, MCP, sandbox) for a project.
 * Clicking an access point opens its detail view.
 */

import React, { use, useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { get, post, del } from '@/lib/apiClient';
import { getProviderDisplayLabel, SYNC_MODE_META, type SyncModeType } from '@/lib/syncTriggerPolicy';
import { useConnectorSpecs } from '@/lib/hooks/useData';
import { getProviderLogo } from '@/components/agent/views/SyncDetailView';
import { getProjectHistory } from '@/lib/contentTreeApi';

/* ================================================================
   Types
   ================================================================ */

interface SyncStatusItem {
  id: string;
  path: string | null;
  node_name: string | null;
  node_type: string | null;
  provider: string;
  direction: string;
  status: string;
  name?: string | null;
  access_key?: string | null;
  last_synced_at: string | null;
  error_message: string | null;
  config?: Record<string, unknown>;
  trigger?: { type?: string; schedule?: string; timezone?: string } | null;
}

interface ProjectSyncStatus {
  syncs: SyncStatusItem[];
  uploads: { id: string; status: string }[];
}

/* ================================================================
   Provider Icons & UI Helpers
   ================================================================ */

const PROVIDER_LABELS: Record<string, string> = {
  filesystem: 'Machine Folder', gmail: 'Gmail', google_sheets: 'Google Sheets',
  google_calendar: 'Google Calendar', google_docs: 'Google Docs', github: 'GitHub',
  supabase: 'Supabase', notion: 'Notion', linear: 'Linear',
  agent: 'Agent', mcp: 'MCP Server', sandbox: 'Sandbox',
  url: 'Web Page', rss: 'RSS Feed', rest_api: 'REST API',
  hackernews: 'Hacker News', posthog: 'PostHog',
  google_search_console: 'Google Search Console',
  script: 'Custom Script',
};

function ProviderIcon({ provider, size = 16 }: { provider: string; size?: number }) {
  const logos: Record<string, string> = {
    gmail: 'https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png',
    google_sheets: 'https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png',
    google_calendar: 'https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_32dp.png',
    google_docs: 'https://www.gstatic.com/images/branding/product/1x/docs_2020q4_32dp.png',
    github: 'https://github.githubassets.com/favicons/favicon-dark.svg',
    notion: 'https://www.notion.so/images/favicon.ico',
  };

  if (logos[provider]) {
    return <img src={logos[provider]} alt={provider} width={size} height={size} style={{ display: 'block', borderRadius: 2 }} />;
  }

  if (provider === 'filesystem') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M2 20h20" /></svg>;
  if (provider === 'agent') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" /><path d="M6 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      </svg>
    );
  }
  if (provider === 'mcp') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    );
  }
  if (provider === 'sandbox') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }
  if (provider === 'url') return <span style={{ fontSize: size * 0.85 }}>🌐</span>;
  if (provider === 'hackernews') return <span style={{ fontSize: size * 0.85 }}>🟠</span>;
  if (provider === 'posthog') return <span style={{ fontSize: size * 0.85 }}>🦔</span>;
  if (provider === 'google_search_console') return <span style={{ fontSize: size * 0.85 }}>📊</span>;
  if (provider === 'script') return <span style={{ fontSize: size * 0.85 }}>📜</span>;

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: '#4ade80', syncing: '#60a5fa', error: '#ef4444',
  paused: '#f59e0b', pending: '#71717a', waiting: '#71717a',
};

const DIRECTION_LABELS: Record<string, string> = {
  inbound: 'Inbound', outbound: 'Outbound', bidirectional: 'Bidirectional',
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr);
  const now = new Date();
  const secs = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (secs < 60) return 'Just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function normalizeMode(raw?: string): SyncModeType {
  if (!raw) return 'import_once';
  if (raw === 'cli_push' || raw === 'realtime') return 'realtime';
  if (raw === 'cron' || raw === 'scheduled') return 'scheduled';
  if (raw === 'manual') return 'manual';
  return 'import_once';
}

function MiniDocShell({ type }: { type: 'json' | 'markdown' | 'file' }) {
  const accentColor = type === 'json' ? '#4ade80' : type === 'markdown' ? '#60a5fa' : '#a3a3a3';
  const label = type === 'json' ? '{ }' : type === 'markdown' ? 'MD' : 'FILE';
  return (
    <svg width="36" height="40" viewBox="0 0 36 40" fill="none">
      <path d="M4 2C4 1.44772 4.44772 1 5 1H23L32 10V38C32 38.5523 31.5523 39 31 39H5C4.44772 39 4 38.5523 4 38V2Z" fill="#222225" stroke="#3a3a3d" strokeWidth="0.75" />
      <path d="M23 1V10H32" stroke="#3a3a3d" strokeWidth="0.75" strokeLinejoin="round" />
      <path d="M23 1V10H32L23 1Z" fill="#2a2a2d" />
      <text x="18" y="28" textAnchor="middle" fontSize="7" fontWeight="600" fill={accentColor} fontFamily="'SF Mono', 'JetBrains Mono', monospace">{label}</text>
    </svg>
  );
}

function ConnectionLine({ direction, isActive, status }: { direction: string; isActive: boolean; status: string }) {
  if (!isActive) {
    const label = status === 'error' ? 'Sync error'
      : status === 'paused' ? 'Paused'
      : status === 'pending' || status === 'waiting' ? 'Waiting'
      : 'Not connected';
    const labelColor = status === 'error' ? '#ef4444' : status === 'paused' ? '#f59e0b' : '#525252';
    const lineColor = status === 'error' ? 'rgba(239,68,68,0.3)' : status === 'paused' ? 'rgba(245,158,11,0.2)' : '#333';
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', margin: '0 4px' }}>
        <div style={{ width: '100%', textAlign: 'center', position: 'relative', borderTop: `1px dashed ${lineColor}` }}>
          <span style={{ position: 'relative', top: -7, background: '#0e0e0e', padding: '0 6px', fontSize: 9, fontWeight: 500, color: labelColor, whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>
            {label}
          </span>
        </div>
      </div>
    );
  }
  const arrowColor = '#4ade80';
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 4px' }}>
      {direction === 'bidirectional' ? (
        <svg width="48" height="16" viewBox="0 0 48 16" fill="none" stroke={arrowColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 5h44M6 2L2 5l4 3" /><path d="M42 8l4 3-4 3M2 11h44" />
        </svg>
      ) : direction === 'outbound' ? (
        <svg width="48" height="16" viewBox="0 0 48 16" fill="none" stroke={arrowColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M46 8H2M6 4L2 8l4 4" />
        </svg>
      ) : (
        <svg width="48" height="16" viewBox="0 0 48 16" fill="none" stroke={arrowColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 8h44M42 4l4 4-4 4" />
        </svg>
      )}
    </div>
  );
}

/* ================================================================
   AccessPage
   ================================================================ */

const PROVIDER_GROUPS: { key: string; label: string; providers: string[] }[] = [
  { key: 'filesystem', label: 'Filesystem', providers: ['filesystem'] },
  { key: 'datasources', label: 'Data Sources', providers: ['gmail', 'google_sheets', 'google_calendar', 'google_docs', 'github', 'supabase', 'notion', 'linear', 'hackernews', 'posthog', 'google_search_console', 'url', 'rss', 'rest_api', 'script'] },
  { key: 'agents', label: 'Agents', providers: ['agent'] },
  { key: 'mcp', label: 'MCP', providers: ['mcp'] },
  { key: 'sandbox', label: 'Sandbox', providers: ['sandbox'] },
];

function groupConnections(connections: SyncStatusItem[]) {
  return PROVIDER_GROUPS
    .map(g => ({
      ...g,
      items: connections.filter(c => g.providers.includes(c.provider)),
    }))
    .filter(g => g.items.length > 0);
}

export default function AccessPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  // `?ap=<id>` is the deep-link entry point — Home's AP cards push that URL
  // when clicked, and we treat the query string as the source-of-truth for
  // selection so back/forward and shared links round-trip cleanly.  Local
  // state is kept in sync via `useEffect` (one-way: URL → state); user clicks
  // in the sidebar go through `selectAp()` which sets state AND patches the
  // URL with `router.replace` (so reload preserves the selection without
  // polluting browser history).
  const queryAp = searchParams.get('ap');
  const [selectedId, setSelectedIdState] = useState<string | null>(queryAp);
  useEffect(() => {
    if (queryAp && queryAp !== selectedId) setSelectedIdState(queryAp);
  }, [queryAp]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectAp = useCallback((id: string | null) => {
    setSelectedIdState(id);
    const next = new URLSearchParams(searchParams.toString());
    if (id) next.set('ap', id);
    else next.delete('ap');
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : '?');
  }, [router, searchParams]);

  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const { data: syncData, mutate: mutateSyncs } = useSWR<ProjectSyncStatus>(
    projectId ? `/api/v1/sync/status?project_id=${projectId}` : null,
    (url: string) => get<ProjectSyncStatus>(url),
    { refreshInterval: 15000 },
  );

  const connections = useMemo(() => syncData?.syncs || [], [syncData]);
  const allGroups = useMemo(() => groupConnections(connections), [connections]);
  const filteredConnections = useMemo(() => {
    if (!activeFilter) return connections;
    return connections.filter(c => {
      const group = PROVIDER_GROUPS.find(g => g.providers.includes(c.provider));
      return group?.key === activeFilter;
    });
  }, [connections, activeFilter]);
  const groups = useMemo(() => groupConnections(filteredConnections), [filteredConnections]);

  const effectiveSelectedId = selectedId && filteredConnections.find(c => c.id === selectedId)
    ? selectedId
    : filteredConnections.length > 0 ? filteredConnections[0].id : null;

  const selected = connections.find(c => c.id === effectiveSelectedId) || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0e0e0e' }}>
      {/* Header */}
      <div style={{
        height: 40, minHeight: 40, borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
        background: '#0e0e0e', fontSize: 13, fontWeight: 500, color: '#e4e4e7', flexShrink: 0,
      }}>
        <span>Access</span>
        <button
          onClick={() => {/* TODO: open create modal */}}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5,
            padding: '3px 10px', color: '#a1a1aa', fontSize: 12, fontWeight: 500,
            cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#e4e4e7'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#a1a1aa'; }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"></path></svg>
          Access
        </button>
      </div>

      {/* Left-right split */}
      <div className="flex flex-1 min-h-0">

        {/* Left sidebar */}
        <div className="w-[280px] flex-shrink-0 border-r border-white/[0.06] flex flex-col bg-[#0e0e0e]">

          {/* Filter tabs */}
          {allGroups.length > 0 && (
            <div className="h-[40px] min-h-[40px] shrink-0 flex items-center gap-2 px-3 overflow-x-auto no-scrollbar border-b border-white/[0.06] bg-[#0e0e0e] relative z-10" style={{ scrollbarWidth: 'none' }}>
              <button
                onClick={() => setActiveFilter(null)}
                className={`flex-shrink-0 px-2.5 py-1 rounded-[6px] text-[12px] font-medium transition-colors ${
                  activeFilter === null
                    ? 'bg-[#1a1a1a] text-[#eee]'
                    : 'bg-transparent text-[#71717a] hover:text-[#a1a1aa] hover:bg-white/[0.04]'
                }`}
              >
                All
              </button>
              {allGroups.map(g => (
                <button
                  key={g.key}
                  onClick={() => setActiveFilter(g.key)}
                  className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-[12px] font-medium transition-colors ${
                    activeFilter === g.key
                      ? 'bg-[#1a1a1a] text-[#eee]'
                      : 'bg-transparent text-[#71717a] hover:text-[#a1a1aa] hover:bg-white/[0.04]'
                  }`}
                >
                  {g.label}
                  <span className={`text-[10px] font-bold leading-none px-1.5 py-0.5 rounded border ${
                    activeFilter === g.key 
                      ? 'bg-[#222] text-[#888] border-[#333]' 
                      : 'bg-[#111] text-[#666] border-[#222]'
                  }`}>
                    {g.items.length}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto overflow-x-hidden relative pt-2 pb-12 custom-scrollbar">
            {connections.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#3f3f46', fontSize: 13 }}>
                No access points yet
              </div>
            ) : (
              filteredConnections.map(conn => (
                <AccessSidebarRow
                  key={conn.id}
                  connection={conn}
                  isSelected={conn.id === effectiveSelectedId}
                  onClick={() => selectAp(conn.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right detail panel */}
        <div className="flex-1 overflow-auto bg-[#0e0e0e]">
          {selected ? (
            <AccessDetailPanel
              connection={selected}
              projectId={projectId}
              onRefresh={() => mutateSyncs()}
            />
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '100%', gap: 8, color: '#3f3f46',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" />
                <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
              </svg>
              <span style={{ fontSize: 13 }}>Select an access point</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   AccessSidebarRow — matches VerticalCommitNode row style from History
   ================================================================ */

function AccessSidebarRow({ connection: c, isSelected, onClick }: {
  connection: SyncStatusItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  const name = c.name || c.node_name || PROVIDER_LABELS[c.provider] || c.provider;
  const statusColor = STATUS_COLORS[c.status] || '#71717a';

  return (
    <div
      onClick={onClick}
      className={`group flex items-center mx-1.5 h-[30px] rounded-md cursor-pointer px-2.5 gap-2 select-none transition-colors ${
        isSelected ? 'bg-[#2a2a2a] text-white' : 'bg-transparent text-[#a1a1aa] hover:bg-white/[0.06] hover:text-[#d4d4d4]'
      }`}
    >
      <div className="w-4 h-4 flex items-center justify-center shrink-0">
        <ProviderIcon provider={c.provider} size={14} />
      </div>
      <span className="flex-1 truncate text-[13px]">
        {name}
      </span>
      <div 
        className="w-1.5 h-1.5 rounded-full shrink-0" 
        style={{ backgroundColor: statusColor, boxShadow: `0 0 8px ${statusColor}40` }}
      />
    </div>
  );
}

/* ================================================================
   AccessDetailPanel (right panel in split layout)
   ================================================================ */

function AccessDetailPanel({ connection: c, projectId, onRefresh }: {
  connection: SyncStatusItem;
  projectId: string;
  onRefresh: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const { specs } = useConnectorSpecs();

  const label = getProviderDisplayLabel(c.provider, specs) || PROVIDER_LABELS[c.provider] || c.provider;
  const name = c.name || c.node_name || label;

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await post(`/api/v1/sync/syncs/${c.id}/refresh`);
      onRefresh();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }, [c.id, onRefresh]);

  const handlePause = useCallback(async () => {
    setPausing(true);
    try {
      const action = c.status === 'paused' ? 'resume' : 'pause';
      await post(`/api/v1/sync/syncs/${c.id}/${action}`);
      onRefresh();
    } catch (err) {
      console.error('Pause/resume failed:', err);
    } finally {
      setPausing(false);
    }
  }, [c.id, c.status, onRefresh]);

  const isAgent = c.provider === 'agent';
  const isMcp = c.provider === 'mcp';
  const isSandbox = c.provider === 'sandbox';
  const showSyncActions = !isAgent && !isMcp && !isSandbox;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 24px' }}>
      <div style={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column' }}>

        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)',
            }}>
              <ProviderIcon provider={c.provider} size={16} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#e4e4e7', lineHeight: 1.2 }}>{name}</div>
              <div style={{ fontSize: 12, color: '#52525b', marginTop: 2 }}>{label}</div>
            </div>
          </div>

          {showSyncActions && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={handlePause}
                disabled={pausing}
                style={{
                  height: 28, padding: '0 10px', fontSize: 12, background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: '#a1a1aa',
                  cursor: pausing ? 'not-allowed' : 'pointer', fontWeight: 500,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if(!pausing) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={e => { if(!pausing) e.currentTarget.style.background = 'transparent'; }}
              >
                {c.status === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button
                onClick={handleSync}
                disabled={syncing}
                style={{
                  height: 28, padding: '0 12px', fontSize: 12, background: '#22c55e',
                  border: 'none', borderRadius: 5, color: '#fff',
                  cursor: syncing ? 'not-allowed' : 'pointer', fontWeight: 500,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if(!syncing) e.currentTarget.style.background = '#16a34a'; }}
                onMouseLeave={e => { if(!syncing) e.currentTarget.style.background = '#22c55e'; }}
              >
                {syncing ? 'Syncing...' : 'Sync now'}
              </button>
            </div>
          )}
        </div>

        {/* All-in-one detail — no tabs, everything visible */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Connection visualization */}
          <OverviewTab connection={c} projectId={projectId} />

          {/* Filesystem: Getting Started */}
          {c.provider === 'filesystem' && c.access_key && (
            <FilesystemGettingStarted accessKey={c.access_key} nodeName={c.node_name} />
          )}

          {/* Configuration (from Settings) */}
          <div style={{
            background: '#111113', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 8, display: 'flex', flexDirection: 'column',
          }}>
            <InfoRow label="Status" value={
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[c.status] || '#71717a' }} />
                <span style={{ textTransform: 'capitalize' }}>{c.status}</span>
                {c.last_synced_at && <span style={{ color: '#52525b' }}>· Last synced {timeAgo(c.last_synced_at)}</span>}
              </div>
            } />
            <InfoRow label="Provider" value={label} />
            <InfoRow label="Direction" value={DIRECTION_LABELS[c.direction] || c.direction} />
            {showSyncActions && (
              <InfoRow label="Sync Mode" value={
                <span style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 4, color: '#d4d4d8' }}>
                  {SYNC_MODE_META[normalizeMode(c.trigger?.type)]?.label || c.trigger?.type || 'Realtime'}
                </span>
              } />
            )}
            {c.access_key && (
              <InfoRow label="Access Key" value={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code style={{ fontSize: 12, color: '#a1a1aa', fontFamily: "'JetBrains Mono', monospace" }}>
                    {c.access_key.length > 16 ? c.access_key.slice(0, 8) + '...' + c.access_key.slice(-4) : c.access_key}
                  </code>
                  <button
                    onClick={() => navigator.clipboard.writeText(c.access_key!)}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: '#a1a1aa', padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
                  >
                    Copy
                  </button>
                </div>
              } />
            )}
            <InfoRow label="Path" value={c.path || '/'} mono />
            <InfoRow label="ID" value={c.id} mono isLast />
          </div>

          {/* Recent Activity (from History) */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7', marginBottom: 8 }}>Recent Activity</div>
            <HistoryTab connectionPath={c.path} projectId={projectId} />
          </div>

          {/* Danger Zone (from Settings) */}
          <SettingsTab connection={c} onRefresh={onRefresh} />
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   FilesystemGettingStarted
   ================================================================ */

type SetupMode = 'clone' | 'connect';

function FilesystemGettingStarted({ accessKey, nodeName }: { accessKey: string; nodeName: string | null }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [mode, setMode] = useState<SetupMode>('clone');
  const apiBase = typeof window !== 'undefined' ? window.location.origin : '';
  const cloneUrl = `${apiBase}/mut/ap/${accessKey}`;

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const cmdStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '10px 14px', background: '#0a0a0a',
    border: '1px solid rgba(255,255,255,0.04)', borderRadius: 6,
  };
  const codeStyle: React.CSSProperties = {
    flex: 1, fontSize: 12, color: '#d4d4d8', fontFamily: "'JetBrains Mono', monospace",
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.6,
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 20,
      background: '#111113', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 8, padding: '24px',
    }}>
      {/* Setup */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>
          Setup
        </div>

        {/* ── Path picker ── */}
        <div style={{
          display: 'flex', gap: 0, marginBottom: 12,
          background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: 6, padding: 3,
        }}>
          <ModeTab
            active={mode === 'clone'}
            label="Clone to new folder"
            hint="No local files yet"
            onClick={() => setMode('clone')}
          />
          <ModeTab
            active={mode === 'connect'}
            label="Connect existing folder"
            hint="Already have files locally"
            onClick={() => setMode('connect')}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={cmdStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#525252', flexShrink: 0 }}>$</span>
              <code style={codeStyle}>pip install mutai</code>
            </div>
            <CopyBtn copied={copied === 'install'} onCopy={() => copy('pip install mutai', 'install')} />
          </div>

          {mode === 'clone' ? (
            <div style={{ ...cmdStyle, whiteSpace: 'normal' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#525252', flexShrink: 0, marginTop: 2 }}>$</span>
                <code style={{ ...codeStyle, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {`mut clone ${cloneUrl} \\\n  --credential ${accessKey}`}
                </code>
              </div>
              <CopyBtn copied={copied === 'clone'} onCopy={() => copy(`mut clone ${cloneUrl} --credential ${accessKey}`, 'clone')} />
            </div>
          ) : (
            <div style={{ ...cmdStyle, whiteSpace: 'normal' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#525252', flexShrink: 0, marginTop: 2 }}>$</span>
                <code style={{ ...codeStyle, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {`cd /path/to/your/folder\nmut connect ${cloneUrl} \\\n  --credential ${accessKey}`}
                </code>
              </div>
              <CopyBtn copied={copied === 'connect'} onCopy={() => copy(`mut connect ${cloneUrl} --credential ${accessKey}`, 'connect')} />
            </div>
          )}
        </div>

        {mode === 'clone' ? (
          <div style={{ fontSize: 12, color: '#525252', marginTop: 8, lineHeight: 1.5 }}>
            Run once. Creates a local <code style={{ fontFamily: "'JetBrains Mono', monospace", color: '#71717a' }}>./{nodeName || 'project'}/</code> folder
            with whatever is already in this context.
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#525252', marginTop: 8, lineHeight: 1.5 }}>
            Run inside an existing folder. Pulls cloud state, three-way merges with your local files,
            then pushes the result. Files only on disk get uploaded; files only in cloud get downloaded.
            <span style={{ color: '#facc15', fontWeight: 500 }}> No data loss.</span>
          </div>
        )}
      </div>

      {/* Usage */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>
          Usage
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div style={cmdStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#525252', flexShrink: 0 }}>$</span>
                <code style={codeStyle}>mut commit -m &quot;message&quot; &amp;&amp; mut push</code>
              </div>
              <CopyBtn copied={copied === 'push'} onCopy={() => copy('mut commit -m "message" && mut push', 'push')} />
            </div>
            <div style={{ fontSize: 12, color: '#525252', marginTop: 4, paddingLeft: 20 }}>Send local changes to the cloud</div>
          </div>
          <div>
            <div style={cmdStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#525252', flexShrink: 0 }}>$</span>
                <code style={codeStyle}>mut pull</code>
              </div>
              <CopyBtn copied={copied === 'pull'} onCopy={() => copy('mut pull', 'pull')} />
            </div>
            <div style={{ fontSize: 12, color: '#525252', marginTop: 4, paddingLeft: 20 }}>Fetch changes from other agents or the web UI</div>
          </div>
        </div>
      </div>

      {/* Credentials */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }}>
          Credentials
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <CopyField value={accessKey} label="Access Key" masked copied={copied === 'key'} onCopy={() => copy(accessKey, 'key')} />
          <CopyField value={cloneUrl} label="Endpoint URL" copied={copied === 'url'} onCopy={() => copy(cloneUrl, 'url')} />
        </div>
      </div>
    </div>
  );
}

function ModeTab({ active, label, hint, onClick }: { active: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '8px 12px', borderRadius: 4, border: 'none',
        background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
        color: active ? '#e5e5e5' : '#71717a',
        cursor: 'pointer', textAlign: 'left',
        transition: 'all 0.15s',
        display: 'flex', flexDirection: 'column', gap: 2,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = '#a3a3a3'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = '#71717a'; }}
    >
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 11, color: active ? '#a3a3a3' : '#525252' }}>{hint}</span>
    </button>
  );
}

function CopyBtn({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <button onClick={onCopy} style={{
      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4,
      color: copied ? '#4ade80' : '#525252', padding: '3px 8px',
      cursor: 'pointer', fontSize: 11, fontWeight: 500, flexShrink: 0, transition: 'all 0.15s',
    }}
    onMouseEnter={e => { if(!copied) { e.currentTarget.style.color = '#a1a1aa'; } }}
    onMouseLeave={e => { if(!copied) { e.currentTarget.style.color = '#525252'; } }}
    >
      {copied ? '✓' : 'Copy'}
    </button>
  );
}

/* ================================================================
   OverviewTab
   ================================================================ */

function OverviewTab({ connection: c, projectId }: { connection: SyncStatusItem; projectId: string }) {
  const { specs } = useConnectorSpecs();
  const label = getProviderDisplayLabel(c.provider, specs) || PROVIDER_LABELS[c.provider] || c.provider;
  const isActive = c.status === 'active' || c.status === 'syncing';

  if (c.provider === 'mcp') {
    return <McpOverviewTab connection={c} />;
  }
  if (c.provider === 'sandbox') {
    return <SandboxOverviewTab connection={c} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Connection visualization (borrowed from SyncDetailView) */}
      <div style={{
        borderRadius: 10, padding: '24px 32px',
        background: '#111113', border: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 100 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 8,
              background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {getProviderLogo(c.provider, 24)}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#a3a3a3', textAlign: 'center' }}>
              {label}
            </div>
          </div>

          <div style={{ flex: 1, padding: '0 16px' }}>
            <ConnectionLine
              direction={c.direction}
              isActive={isActive}
              status={c.status}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 100 }}>
            {c.node_type === 'folder' || !c.node_type
              ? <img src="/icons/folder.svg" alt="Folder" width={40} height={40} style={{ display: 'block' }} />
              : <MiniDocShell type={c.node_type as 'json' | 'markdown' | 'file'} />
            }
            <div style={{ fontSize: 12, fontWeight: 500, color: '#a3a3a3', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
              {c.node_name || 'Workspace'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[c.status] || '#71717a' }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: '#a1a1aa', textTransform: 'capitalize' }}>
            {c.status === 'syncing' ? 'Syncing...' : c.status}
          </span>
          {c.last_synced_at && (
            <span style={{ fontSize: 12, color: '#525252' }}>
              · Last synced {timeAgo(c.last_synced_at)}
            </span>
          )}
        </div>
      </div>

      {c.error_message && (
        <div style={{
          padding: '12px 16px', background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8,
          fontSize: 13, color: '#f87171', lineHeight: 1.5,
        }}>
          {c.error_message}
        </div>
      )}
    </div>
  );
}

/* ================================================================
   McpOverviewTab
   ================================================================ */

function McpOverviewTab({ connection: c }: { connection: SyncStatusItem }) {
  const [copied, setCopied] = useState<string | null>(null);
  const apiKey = c.access_key || '';
  const mcpUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/v1/mcp/${c.id}/sse`
    : `/api/v1/mcp/${c.id}/sse`;

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{
        padding: '24px', background: '#111113', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 20
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#71717a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>MCP Endpoint URL</div>
          <CopyField value={mcpUrl} copied={copied === 'url'} onCopy={() => copy(mcpUrl, 'url')} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#71717a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>API Key</div>
          <CopyField value={apiKey} masked copied={copied === 'key'} onCopy={() => copy(apiKey, 'key')} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#71717a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Client Configuration</div>
          <pre style={{
            padding: '16px', background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.04)',
            borderRadius: 6, fontSize: 12, color: '#a1a1aa', lineHeight: 1.6, overflow: 'auto',
            whiteSpace: 'pre-wrap', margin: 0, fontFamily: "'JetBrains Mono', monospace"
          }}>
{JSON.stringify({
  mcpServers: {
    puppyone: {
      url: mcpUrl,
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  },
}, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function CopyField({ value, label, masked, copied, onCopy }: { value: string; label?: string; masked?: boolean; copied: boolean; onCopy: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
      background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 6,
    }}>
      {label && <span style={{ fontSize: 11, fontWeight: 500, color: '#525252', flexShrink: 0, width: 72 }}>{label}</span>}
      <span style={{ flex: 1, fontSize: 13, color: '#d4d4d8', fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {masked ? value.slice(0, 8) + '···' + value.slice(-4) : value}
      </span>
      <button onClick={onCopy} style={{
        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, 
        color: copied ? '#4ade80' : '#a1a1aa', padding: '4px 10px',
        cursor: 'pointer', fontSize: 11, fontWeight: 500, flexShrink: 0, transition: 'all 0.15s'
      }}
      onMouseEnter={e => { if(!copied) { e.currentTarget.style.color = '#e4e4e7'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; } }}
      onMouseLeave={e => { if(!copied) { e.currentTarget.style.color = '#a1a1aa'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; } }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/* ================================================================
   SandboxOverviewTab
   ================================================================ */

function SandboxOverviewTab({ connection: c }: { connection: SyncStatusItem }) {
  const [copied, setCopied] = useState(false);
  const apiKey = c.access_key || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{
        padding: '24px', background: '#111113', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 20
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#71717a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Sandbox API Key</div>
          <CopyField value={apiKey} masked copied={copied} onCopy={() => {
            navigator.clipboard.writeText(apiKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#71717a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Usage</div>
          <div style={{
            padding: '14px 16px', background: '#0a0a0a',
            border: '1px solid rgba(255,255,255,0.04)', borderRadius: 6,
            fontSize: 13, color: '#a1a1aa', lineHeight: 1.6,
          }}>
            Use the Sandbox API to execute commands in an isolated environment.
            <br/><br/>
            Send requests to <code style={{ color: '#d4d4d8', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>/api/v1/sandbox/sessions/start</code> with
            your API key in the <code style={{ color: '#d4d4d8', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>X-API-KEY</code> header.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   HistoryTab
   ================================================================ */

function HistoryTab({ connectionPath, projectId }: { connectionPath: string | null; projectId: string }) {
  const { data: historyData } = useSWR(
    projectId ? ['access-history', projectId, connectionPath] : null,
    () => getProjectHistory(projectId, 20),
  );

  const commits = useMemo(() => {
    if (!historyData?.commits) return [];
    if (!connectionPath) return historyData.commits;
    return historyData.commits.filter(c =>
      c.scope_path === connectionPath ||
      c.changes.some(ch => ch.path.startsWith(connectionPath))
    );
  }, [historyData, connectionPath]);

  return (
    <div>
      <div style={{
        background: '#111113', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8, overflow: 'hidden',
      }}>
        {commits.length === 0 && (
          <div style={{ textAlign: 'center', color: '#525252', fontSize: 13, padding: '40px 0' }}>
            No activity yet
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {commits.map((c, i) => (
            <div key={c.commit_id} style={{
              display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px',
              borderBottom: i < commits.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            }}>
              <span
                title={c.commit_id}
                style={{ fontSize: 11, color: '#52525b', fontFamily: 'monospace', width: 64, flexShrink: 0 }}
              >
                {c.commit_id.slice(0, 8)}
              </span>
              <span style={{ flex: 1, fontSize: 13, color: '#d4d4d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                {c.message || '(no message)'}
              </span>
              <span style={{ fontSize: 12, color: '#3f3f46', flexShrink: 0 }}>{c.changes.length} file{c.changes.length !== 1 ? 's' : ''}</span>
              <span style={{ fontSize: 12, color: '#52525b', flexShrink: 0 }}>{timeAgo(c.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   SettingsTab
   ================================================================ */

function SettingsTab({ connection: c, onRefresh }: { connection: SyncStatusItem; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleDisconnect = async () => {
    try {
      await del(`/api/v1/sync/syncs/${c.id}`);
      onRefresh();
    } catch (err) {
      console.error('Disconnect failed:', err);
    }
  };

  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 12 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
          cursor: 'pointer', fontSize: 12, color: '#52525b', padding: 0, transition: 'color 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#a1a1aa'}
        onMouseLeave={e => e.currentTarget.style.color = '#52525b'}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
          <path d="M6 4l4 4-4 4" />
        </svg>
        Danger Zone
      </button>
      {expanded && (
        <div style={{
          marginTop: 12, background: 'rgba(239,68,68,0.02)', border: '1px solid rgba(239,68,68,0.1)',
          borderRadius: 8, padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>Delete Access Point</div>
            <div style={{ fontSize: 12, color: '#71717a', marginTop: 4 }}>This action cannot be undone.</div>
          </div>
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              style={{
                height: 28, padding: '0 12px', fontSize: 12, fontWeight: 500, background: 'transparent',
                border: '1px solid rgba(239,68,68,0.3)', borderRadius: 5, color: '#ef4444',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.05)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              Disconnect
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#71717a', marginRight: 4 }}>Sure?</span>
              <button
                onClick={() => setConfirming(false)}
                style={{ height: 28, padding: '0 10px', fontSize: 12, fontWeight: 500, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: '#a1a1aa', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDisconnect}
                style={{ height: 28, padding: '0 12px', fontSize: 12, fontWeight: 500, background: '#ef4444', border: 'none', borderRadius: 5, color: '#fff', cursor: 'pointer' }}
              >
                Confirm
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, mono, isLast }: { label: string; value: React.ReactNode; mono?: boolean; isLast?: boolean }) {
  return (
    <div style={{ 
      display: 'flex', gap: 24, padding: '16px 20px',
      borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.04)'
    }}>
      <div style={{ fontSize: 13, color: '#71717a', width: 140, flexShrink: 0 }}>{label}</div>
      <div style={{
        fontSize: 13, color: '#e4e4e7', flex: 1, minWidth: 0,
        fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit',
      }}>
        {value}
      </div>
    </div>
  );
}
