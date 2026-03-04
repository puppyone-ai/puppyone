'use client';

/**
 * Connections Page
 *
 * Lists all connections (data syncs, agents, MCP, sandbox) for a project.
 * Clicking a connection opens its detail view.
 */

import React, { use, useState, useMemo, useCallback } from 'react';
import useSWR from 'swr';
import { get, post, del } from '@/lib/apiClient';
import { getProviderDisplayLabel, SYNC_MODE_META, type SyncModeType } from '@/lib/syncTriggerPolicy';
import { getProviderLogo } from '@/components/agent/views/SyncDetailView';

/* ================================================================
   Types
   ================================================================ */

interface SyncStatusItem {
  id: string;
  node_id: string | null;
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
  filesystem: 'Desktop Folder', gmail: 'Gmail', google_sheets: 'Google Sheets',
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

  if (provider === 'filesystem') return <span style={{ fontSize: size * 0.85 }}>🦞</span>;
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
   ConnectionsPage
   ================================================================ */

export default function ConnectionsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: syncData, mutate: mutateSyncs } = useSWR<ProjectSyncStatus>(
    projectId ? `/api/v1/sync/status?project_id=${projectId}` : null,
    (url: string) => get<ProjectSyncStatus>(url),
    { refreshInterval: 15000 },
  );

  const connections = useMemo(() => syncData?.syncs || [], [syncData]);
  const selected = useMemo(() => connections.find(c => c.id === selectedId) || null, [connections, selectedId]);

  if (selectedId && selected) {
    return (
      <ConnectionDetailView
        connection={selected}
        projectId={projectId}
        onBack={() => setSelectedId(null)}
        onRefresh={() => mutateSyncs()}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0a' }}>
      {/* Header */}
      <div style={{
        height: 40, minHeight: 40, borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', padding: '0 16px',
        background: '#0e0e0e', fontSize: 13, fontWeight: 500, color: '#e4e4e7',
      }}>
        Connections
      </div>

      {/* Centered Form-like List */}
      <div style={{ flex: 1, overflow: 'auto', padding: '32px 16px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column' }}>
          
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, color: '#e4e4e7', letterSpacing: '-0.01em' }}>
              Connections
            </h1>
            <p style={{ fontSize: 13, color: '#71717a', marginTop: 4 }}>
              Manage your active data integrations, MCP servers, and sandbox environments.
            </p>
          </div>

          <div style={{
            background: '#111113', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 8, overflow: 'hidden'
          }}>
            {connections.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#525252', fontSize: 13, padding: '60px 0' }}>
                No connections yet
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {connections.map((conn, idx) => (
                  <ConnectionRow 
                    key={conn.id} 
                    connection={conn} 
                    onClick={() => setSelectedId(conn.id)} 
                    isLast={idx === connections.length - 1}
                  />
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

/* ================================================================
   ConnectionRow
   ================================================================ */

function ConnectionRow({ connection: c, onClick, isLast }: { connection: SyncStatusItem; onClick: () => void; isLast: boolean }) {
  const [hovered, setHovered] = useState(false);
  const label = getProviderDisplayLabel(c.provider) || PROVIDER_LABELS[c.provider] || c.provider;
  const name = c.name || c.node_name || label;
  const statusColor = STATUS_COLORS[c.status] || '#71717a';

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '14px 16px',
        background: hovered ? 'rgba(255,255,255,0.03)' : 'transparent',
        border: 'none', 
        borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.04)',
        cursor: 'pointer', width: '100%',
        textAlign: 'left', transition: 'background 0.15s',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', flexShrink: 0,
      }}>
        <ProviderIcon provider={c.provider} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
        <div style={{ fontSize: 12, color: '#71717a' }}>
          {label} · {DIRECTION_LABELS[c.direction] || c.direction}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: '#525252', width: 60, textAlign: 'right' }}>{timeAgo(c.last_synced_at)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 70, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 12, color: '#71717a', textTransform: 'capitalize' }}>{c.status}</span>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
        </div>
      </div>
    </button>
  );
}

/* ================================================================
   ConnectionDetailView
   ================================================================ */

function ConnectionDetailView({ connection: c, projectId, onBack, onRefresh }: {
  connection: SyncStatusItem;
  projectId: string;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'settings'>('overview');
  const [syncing, setSyncing] = useState(false);
  const [pausing, setPausing] = useState(false);

  const label = getProviderDisplayLabel(c.provider) || PROVIDER_LABELS[c.provider] || c.provider;
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

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'history', label: 'History' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0a' }}>
      
      {/* Top action bar: Back button on left */}
      <div style={{
        height: 40, minHeight: 40, borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
        background: '#0e0e0e',
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer',
          fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.15s'
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#e4e4e7'}
        onMouseLeave={e => e.currentTarget.style.color = '#a1a1aa'}
        >
          <span>←</span> <span style={{ fontWeight: 500 }}>Back to connections</span>
        </button>
      </div>

      {/* Main detail content area (Centered) */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '32px 16px' }}>
        <div style={{ width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column' }}>
          
          {/* Title Area */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)'
              }}>
                <ProviderIcon provider={c.provider} size={20} />
              </div>
              <div>
                <h1 style={{ fontSize: 20, fontWeight: 600, color: '#e4e4e7', margin: 0, letterSpacing: '-0.01em' }}>
                  {name}
                </h1>
                <div style={{ fontSize: 13, color: '#71717a', marginTop: 4 }}>
                  {label} connection
                </div>
              </div>
            </div>

            {showSyncActions && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handlePause}
                  disabled={pausing}
                  style={{
                    height: 32, padding: '0 12px', fontSize: 13, background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, color: '#a1a1aa',
                    cursor: pausing ? 'not-allowed' : 'pointer', fontWeight: 500,
                    transition: 'all 0.15s'
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
                    height: 32, padding: '0 14px', fontSize: 13, background: '#e4e4e7',
                    border: 'none', borderRadius: 6, color: '#000',
                    cursor: syncing ? 'not-allowed' : 'pointer', fontWeight: 500,
                    transition: 'all 0.15s'
                  }}
                  onMouseEnter={e => { if(!syncing) e.currentTarget.style.background = '#fff'; }}
                  onMouseLeave={e => { if(!syncing) e.currentTarget.style.background = '#e4e4e7'; }}
                >
                  {syncing ? 'Syncing...' : 'Sync now'}
                </button>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div style={{
            display: 'flex', gap: 24, borderBottom: '1px solid rgba(255,255,255,0.06)',
            marginBottom: 24
          }}>
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                style={{
                  padding: '0 0 10px 0', fontSize: 13, fontWeight: 500,
                  color: activeTab === t.key ? '#e4e4e7' : '#71717a',
                  background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: activeTab === t.key ? '2px solid #e4e4e7' : '2px solid transparent',
                  marginBottom: -1, transition: 'all 0.15s'
                }}
                onMouseEnter={e => { if(activeTab !== t.key) e.currentTarget.style.color = '#a1a1aa'; }}
                onMouseLeave={e => { if(activeTab !== t.key) e.currentTarget.style.color = '#71717a'; }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div>
            {activeTab === 'overview' && (
              <OverviewTab connection={c} projectId={projectId} />
            )}
            {activeTab === 'history' && (
              <HistoryTab connectionId={c.id} projectId={projectId} />
            )}
            {activeTab === 'settings' && (
              <SettingsTab connection={c} onRefresh={onRefresh} />
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

/* ================================================================
   OverviewTab
   ================================================================ */

function OverviewTab({ connection: c, projectId }: { connection: SyncStatusItem; projectId: string }) {
  const label = getProviderDisplayLabel(c.provider) || PROVIDER_LABELS[c.provider] || c.provider;
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

function CopyField({ value, masked, copied, onCopy }: { value: string; masked?: boolean; copied: boolean; onCopy: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
      background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 6,
    }}>
      <span style={{ flex: 1, fontSize: 13, color: '#d4d4d8', fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {masked ? '•'.repeat(Math.min(value.length, 32)) : value}
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

function HistoryTab({ connectionId, projectId }: { connectionId: string; projectId: string }) {
  const { data: logs } = useSWR(
    connectionId ? `/api/v1/collaboration/audit-logs?project_id=${projectId}&entity_id=${connectionId}&limit=50` : null,
    (url: string) => get<{ logs: AuditLog[] }>(url),
  );

  const entries = logs?.logs || [];

  return (
    <div>
      <div style={{
        background: '#111113', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8, overflow: 'hidden'
      }}>
        {entries.length === 0 && (
          <div style={{ textAlign: 'center', color: '#525252', fontSize: 13, padding: '60px 0' }}>
            No activity recorded yet
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {entries.map((log, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 24, padding: '14px 20px',
              borderBottom: i < entries.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            }}>
              <div style={{ fontSize: 12, color: '#71717a', width: 140, flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>
                {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
              </div>
              <div style={{ fontSize: 13, color: '#d4d4d8' }}>
                {log.action || 'Activity'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface AuditLog {
  action: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

/* ================================================================
   SettingsTab
   ================================================================ */

function SettingsTab({ connection: c, onRefresh }: { connection: SyncStatusItem; onRefresh: () => void }) {
  const [confirming, setConfirming] = useState(false);

  const handleDisconnect = async () => {
    try {
      await del(`/api/v1/sync/syncs/${c.id}`);
      onRefresh();
    } catch (err) {
      console.error('Disconnect failed:', err);
    }
  };

  const syncMode = normalizeMode(c.trigger?.type);
  const syncModeLabel = SYNC_MODE_META[syncMode]?.label || syncMode;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      
      {/* General Settings Box */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7', marginBottom: 12 }}>Configuration</div>
        <div style={{
          background: '#111113', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 8, display: 'flex', flexDirection: 'column'
        }}>
          <InfoRow label="Provider" value={getProviderDisplayLabel(c.provider) || c.provider} />
          <InfoRow label="Direction" value={DIRECTION_LABELS[c.direction] || c.direction} />
          
          {c.provider !== 'mcp' && c.provider !== 'sandbox' && c.provider !== 'agent' && (
            <InfoRow label="Sync Mode" value={
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 4, color: '#d4d4d8' }}>
                  {syncModeLabel}
                </span>
                {c.provider === 'filesystem' && (
                  <span style={{ fontSize: 11, color: '#71717a' }}>Fixed for Desktop Folder</span>
                )}
              </div>
            } />
          )}

          {/* Render Mount Paths for Sandbox */}
          {c.provider === 'sandbox' && c.config?.mounts && Array.isArray(c.config.mounts) && (
            <InfoRow label="Mount Paths" value={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {c.config.mounts.map((m: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <code style={{ background: '#0a0a0a', padding: '2px 6px', borderRadius: 4, color: '#a1a1aa', border: '1px solid rgba(255,255,255,0.04)' }}>
                      {m.mount_path}
                    </code>
                    <span style={{ color: '#525252' }}>→</span>
                    <span style={{ color: '#d4d4d8' }}>{m.node_id}</span>
                    <span style={{ color: '#71717a' }}>({m.permissions?.write ? 'read-write' : 'read-only'})</span>
                  </div>
                ))}
              </div>
            } />
          )}

          {/* Render Accesses for MCP */}
          {c.provider === 'mcp' && c.config?.accesses && Array.isArray(c.config.accesses) && (
            <InfoRow label="Access Points" value={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {c.config.accesses.map((a: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ color: '#d4d4d8' }}>{a.node_id}</span>
                    <span style={{ color: '#71717a' }}>({a.readonly ? 'read-only' : 'read-write'})</span>
                  </div>
                ))}
              </div>
            } />
          )}

          <InfoRow label="Connection ID" value={c.id} mono isLast />
        </div>
      </div>

      {/* Danger Zone */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#ef4444', marginBottom: 12 }}>Danger Zone</div>
        <div style={{
          background: 'rgba(239,68,68,0.02)', border: '1px solid rgba(239,68,68,0.1)',
          borderRadius: 8, padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>Delete Connection</div>
            <div style={{ fontSize: 12, color: '#71717a', marginTop: 4 }}>This action cannot be undone. Data already imported will remain.</div>
          </div>
          
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              style={{
                height: 32, padding: '0 16px', fontSize: 13, fontWeight: 500, background: 'transparent',
                border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444',
                cursor: 'pointer', transition: 'all 0.15s'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.05)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              Disconnect
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#a1a1aa', marginRight: 8 }}>Are you sure?</span>
              <button
                onClick={() => setConfirming(false)}
                style={{
                  height: 32, padding: '0 14px', fontSize: 13, fontWeight: 500, background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#a1a1aa',
                  cursor: 'pointer', transition: 'all 0.15s'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#e4e4e7'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#a1a1aa'; }}
              >
                Cancel
              </button>
              <button
                onClick={handleDisconnect}
                style={{
                  height: 32, padding: '0 16px', fontSize: 13, fontWeight: 500, background: '#ef4444',
                  border: 'none', borderRadius: 6, color: '#fff',
                  cursor: 'pointer', transition: 'all 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#dc2626'}
                onMouseLeave={e => e.currentTarget.style.background = '#ef4444'}
              >
                Confirm Delete
              </button>
            </div>
          )}
        </div>
      </div>

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
