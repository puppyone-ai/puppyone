'use client';

/**
 * Connections Page
 *
 * Lists all connections (data syncs, agents, MCP, sandbox) for a project.
 * Clicking a connection opens its detail view.
 */

import React, { use, useState, useMemo, useCallback } from 'react';
import useSWR from 'swr';
import { get, post } from '@/lib/apiClient';
import { useAgent } from '@/contexts/AgentContext';
import { getProviderDisplayLabel } from '@/lib/syncTriggerPolicy';

/* ================================================================
   Types
   ================================================================ */

interface SyncStatusItem {
  id: string;
  node_id: string;
  node_name: string | null;
  node_type: string | null;
  provider: string;
  direction: string;
  status: string;
  access_key?: string | null;
  last_synced_at: string | null;
  error_message: string | null;
  config?: Record<string, unknown>;
}

interface ProjectSyncStatus {
  syncs: SyncStatusItem[];
  uploads: { id: string; status: string }[];
}

/* ================================================================
   Provider Icons
   ================================================================ */

const PROVIDER_LABELS: Record<string, string> = {
  openclaw: 'Desktop Folder', gmail: 'Gmail', google_sheets: 'Google Sheets',
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

  if (provider === 'openclaw') {
    return <span style={{ fontSize: size * 0.85 }}>🦞</span>;
  }

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

/* ================================================================
   Status helpers
   ================================================================ */

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

/* ================================================================
   ConnectionsPage
   ================================================================ */

export default function ConnectionsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: syncData, mutate: mutateSyncs } = useSWR<ProjectSyncStatus>(
    projectId ? `/api/v1/connections/status?project_id=${projectId}` : null,
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        height: 40, minHeight: 40, borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', alignItems: 'center', padding: '0 16px',
        background: '#0e0e0e', fontSize: 13, fontWeight: 500, color: '#e4e4e7',
      }}>
        Connections
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {connections.length === 0 && (
          <div style={{ textAlign: 'center', color: '#525252', fontSize: 13, padding: '40px 0' }}>
            No connections yet
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {connections.map(conn => (
            <ConnectionRow key={conn.id} connection={conn} onClick={() => setSelectedId(conn.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   ConnectionRow
   ================================================================ */

function ConnectionRow({ connection: c, onClick }: { connection: SyncStatusItem; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const label = getProviderDisplayLabel(c.provider) || PROVIDER_LABELS[c.provider] || c.provider;
  const name = (c.config as Record<string, unknown>)?.name as string || c.node_name || label;
  const statusColor = STATUS_COLORS[c.status] || '#71717a';

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
        background: hovered ? 'rgba(255,255,255,0.03)' : 'transparent',
        border: 'none', borderRadius: 6, cursor: 'pointer', width: '100%',
        textAlign: 'left', transition: 'background 0.15s',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.04)', flexShrink: 0,
      }}>
        <ProviderIcon provider={c.provider} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
        <div style={{ fontSize: 12, color: '#71717a', lineHeight: 1.3 }}>
          {label} · {DIRECTION_LABELS[c.direction] || c.direction}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: '#525252' }}>{timeAgo(c.last_synced_at)}</span>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
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
  const name = (c.config as Record<string, unknown>)?.name as string || c.node_name || label;
  const statusColor = STATUS_COLORS[c.status] || '#71717a';

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await post(`/api/v1/connections/syncs/${c.id}/refresh`);
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
      await post(`/api/v1/connections/syncs/${c.id}/${action}`);
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        height: 40, minHeight: 40, borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px',
        background: '#0e0e0e',
      }}>
        <button onClick={onBack} style={{
          background: 'none', border: 'none', color: '#71717a', cursor: 'pointer',
          fontSize: 13, display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span>←</span> <span style={{ color: '#525252' }}>Back</span>
        </button>
        <span style={{ color: '#333', margin: '0 4px' }}>/</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ProviderIcon provider={c.provider} size={14} />
          <span style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
          <span style={{ fontSize: 12, color: '#71717a', textTransform: 'capitalize' }}>{c.status}</span>
        </div>
        <div style={{ flex: 1 }} />
        {showSyncActions && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handlePause}
              disabled={pausing}
              style={{
                height: 28, padding: '0 10px', fontSize: 12, background: 'transparent',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: '#a1a1aa',
                cursor: pausing ? 'not-allowed' : 'pointer',
              }}
            >
              {c.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              style={{
                height: 28, padding: '0 10px', fontSize: 12, background: 'rgba(59,130,246,0.1)',
                border: '1px solid rgba(59,130,246,0.2)', borderRadius: 5, color: '#60a5fa',
                cursor: syncing ? 'not-allowed' : 'pointer',
              }}
            >
              {syncing ? 'Syncing...' : 'Sync now'}
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '0 16px',
      }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '8px 12px', fontSize: 12, fontWeight: 500,
              color: activeTab === t.key ? '#e4e4e7' : '#525252',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === t.key ? '1px solid #e4e4e7' : '1px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
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
  );
}

/* ================================================================
   OverviewTab
   ================================================================ */

function OverviewTab({ connection: c, projectId }: { connection: SyncStatusItem; projectId: string }) {
  const label = getProviderDisplayLabel(c.provider) || PROVIDER_LABELS[c.provider] || c.provider;

  if (c.provider === 'mcp') {
    return <McpOverviewTab connection={c} />;
  }

  if (c.provider === 'sandbox') {
    return <SandboxOverviewTab connection={c} />;
  }

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Pipeline visualization */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
        padding: '20px 24px', background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.04)', borderRadius: 8,
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ProviderIcon provider={c.provider} size={20} />
          <span style={{ fontSize: 13, color: '#a1a1aa' }}>{label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {(c.direction === 'inbound' || c.direction === 'bidirectional') && (
            <svg width={16} height={8} viewBox="0 0 16 8"><path d="M0 4h14M10 0l4 4-4 4" stroke="#4ade80" strokeWidth="1.5" fill="none" /></svg>
          )}
          {c.direction === 'bidirectional' && (
            <svg width={16} height={8} viewBox="0 0 16 8" style={{ transform: 'rotate(180deg)' }}><path d="M0 4h14M10 0l4 4-4 4" stroke="#4ade80" strokeWidth="1.5" fill="none" /></svg>
          )}
          {c.direction === 'outbound' && (
            <svg width={16} height={8} viewBox="0 0 16 8" style={{ transform: 'rotate(180deg)' }}><path d="M0 4h14M10 0l4 4-4 4" stroke="#4ade80" strokeWidth="1.5" fill="none" /></svg>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#a1a1aa' }}>{c.node_name || 'Node'}</span>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
        <StatCard label="Status" value={c.status} color={STATUS_COLORS[c.status]} />
        <StatCard label="Direction" value={DIRECTION_LABELS[c.direction] || c.direction} />
        <StatCard label="Last synced" value={timeAgo(c.last_synced_at)} />
      </div>

      {c.error_message && (
        <div style={{
          padding: '10px 14px', background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.15)', borderRadius: 6,
          fontSize: 12, color: '#f87171', lineHeight: 1.5,
        }}>
          {c.error_message}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      padding: '12px 14px', background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.04)', borderRadius: 6,
    }}>
      <div style={{ fontSize: 11, color: '#525252', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: color || '#e4e4e7', textTransform: 'capitalize' }}>{value}</div>
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
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: '#71717a', marginBottom: 6 }}>MCP Endpoint URL</div>
        <CopyField value={mcpUrl} copied={copied === 'url'} onCopy={() => copy(mcpUrl, 'url')} />
      </div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: '#71717a', marginBottom: 6 }}>API Key</div>
        <CopyField value={apiKey} masked copied={copied === 'key'} onCopy={() => copy(apiKey, 'key')} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#71717a', marginBottom: 6 }}>Client configuration</div>
        <pre style={{
          padding: '12px 14px', background: '#111113', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 6, fontSize: 12, color: '#a1a1aa', lineHeight: 1.6, overflow: 'auto',
          whiteSpace: 'pre-wrap',
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
  );
}

function CopyField({ value, masked, copied, onCopy }: { value: string; masked?: boolean; copied: boolean; onCopy: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
      background: '#111113', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6,
    }}>
      <span style={{ flex: 1, fontSize: 12, color: '#a1a1aa', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {masked ? '•'.repeat(Math.min(value.length, 32)) : value}
      </span>
      <button onClick={onCopy} style={{
        background: 'none', border: 'none', color: copied ? '#4ade80' : '#525252',
        cursor: 'pointer', fontSize: 12, flexShrink: 0,
      }}>
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
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: '#71717a', marginBottom: 6 }}>Sandbox API Key</div>
        <CopyField value={apiKey} masked copied={copied} onCopy={() => {
          navigator.clipboard.writeText(apiKey);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }} />
      </div>
      <div style={{
        padding: '12px 14px', background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.04)', borderRadius: 6,
        fontSize: 12, color: '#71717a', lineHeight: 1.5,
      }}>
        Use the Sandbox API to execute commands in an isolated environment.
        Send requests to <code style={{ color: '#a1a1aa' }}>/api/v1/sandbox/sessions/start</code> with
        your API key in the <code style={{ color: '#a1a1aa' }}>X-API-KEY</code> header.
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
    <div style={{ maxWidth: 720 }}>
      {entries.length === 0 && (
        <div style={{ textAlign: 'center', color: '#525252', fontSize: 13, padding: '32px 0' }}>
          No activity recorded yet
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {entries.map((log, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
            borderBottom: '1px solid rgba(255,255,255,0.03)',
          }}>
            <div style={{ fontSize: 12, color: '#525252', width: 120, flexShrink: 0 }}>
              {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
            </div>
            <div style={{ fontSize: 12, color: '#a1a1aa' }}>
              {log.action || 'Activity'}
            </div>
          </div>
        ))}
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
      await post(`/api/v1/connections/syncs/${c.id}/disconnect`);
      onRefresh();
    } catch (err) {
      console.error('Disconnect failed:', err);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7', marginBottom: 8 }}>Connection info</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <InfoRow label="Provider" value={getProviderDisplayLabel(c.provider) || c.provider} />
          <InfoRow label="Direction" value={DIRECTION_LABELS[c.direction] || c.direction} />
          <InfoRow label="Status" value={c.status} />
          <InfoRow label="ID" value={c.id} mono />
        </div>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#ef4444', marginBottom: 8 }}>Danger zone</div>
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            style={{
              height: 32, padding: '0 14px', fontSize: 12, background: 'transparent',
              border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, color: '#ef4444',
              cursor: 'pointer',
            }}
          >
            Disconnect
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#a1a1aa' }}>Are you sure?</span>
            <button
              onClick={handleDisconnect}
              style={{
                height: 32, padding: '0 14px', fontSize: 12, background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#ef4444',
                cursor: 'pointer',
              }}
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirming(false)}
              style={{
                height: 32, padding: '0 14px', fontSize: 12, background: 'transparent',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#71717a',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: '#525252', width: 80, flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: 12, color: '#a1a1aa',
        fontFamily: mono ? 'monospace' : 'inherit',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  );
}
