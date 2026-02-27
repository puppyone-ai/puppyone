'use client';

import React, { useState, useCallback } from 'react';
import useSWR from 'swr';
import { get } from '@/lib/apiClient';
import { useAgent } from '@/contexts/AgentContext';

interface SyncDetail {
  id: string;
  node_id: string;
  node_name: string | null;
  node_type: string | null;
  provider: string;
  direction: string;
  status: string;
  access_key: string | null;
  last_synced_at: string | null;
  error_message: string | null;
}

// Mini DocShell — matches the product's document icon with folded corner
function MiniDocShell({ type }: { type: 'json' | 'markdown' | 'file' }) {
  const accentColor = type === 'json' ? '#4ade80' : type === 'markdown' ? '#60a5fa' : '#a3a3a3';
  const label = type === 'json' ? '{ }' : type === 'markdown' ? 'MD' : 'FILE';
  return (
    <svg width="36" height="40" viewBox="0 0 36 40" fill="none">
      <path d="M4 2C4 1.44772 4.44772 1 5 1H23L32 10V38C32 38.5523 31.5523 39 31 39H5C4.44772 39 4 38.5523 4 38V2Z"
        fill="#222225" stroke="#3a3a3d" strokeWidth="0.75" />
      <path d="M23 1V10H32" stroke="#3a3a3d" strokeWidth="0.75" strokeLinejoin="round" />
      <path d="M23 1V10H32L23 1Z" fill="#2a2a2d" />
      <text x="18" y="28" textAnchor="middle" fontSize="7" fontWeight="600" fill={accentColor} fontFamily="'SF Mono', 'JetBrains Mono', monospace">
        {label}
      </text>
    </svg>
  );
}

interface SyncDetailViewProps {
  syncId: string;
  projectId?: number | string;
}

// ============================================================
// Provider logos — reuse /icons/* assets from public folder
// ============================================================

function ProviderImg({ src, alt, size }: { src: string; alt: string; size: number }) {
  return <img src={src} alt={alt} width={size} height={size} style={{ display: 'block' }} />;
}

function GitHubLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
}

function getProviderLogo(provider: string, size: number) {
  switch (provider) {
    case 'gmail': return <ProviderImg src="/icons/gmail.svg" alt="Gmail" size={size} />;
    case 'google_calendar': return <ProviderImg src="/icons/google_calendar.svg" alt="Google Calendar" size={size} />;
    case 'google_sheets': return <ProviderImg src="/icons/google_sheet.svg" alt="Google Sheets" size={size} />;
    case 'google_drive': return <ProviderImg src="/icons/google_doc.svg" alt="Google Drive" size={size} />;
    case 'google_docs': return <ProviderImg src="/icons/google_doc.svg" alt="Google Docs" size={size} />;
    case 'github': return <GitHubLogo size={size} />;
    case 'notion': return <ProviderImg src="/icons/notion.svg" alt="Notion" size={size} />;
    case 'linear': return <ProviderImg src="/icons/linear.svg" alt="Linear" size={size} />;
    case 'filesystem':
    case 'openclaw':
      return <span style={{ fontSize: size * 0.65 }}>🦞</span>;
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <rect x="2" y="2" width="20" height="20" rx="4" fill="#333"/>
          <text x="12" y="16" textAnchor="middle" fontSize="12" fontWeight="700" fill="#aaa" fontFamily="sans-serif">
            {provider.charAt(0).toUpperCase()}
          </text>
        </svg>
      );
  }
}

// ============================================================
// ConnectionLine — animated flowing square dots
// ============================================================

function ConnectionLine({ direction, color, isActive, status }: { direction: string; color: string; isActive: boolean; status: string }) {
  const id = React.useId();
  const cls = id.replace(/:/g, '');

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
          <span style={{ position: 'relative', top: -7, background: '#141414', padding: '0 6px', fontSize: 9, fontWeight: 500, color: labelColor, whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>
            {label}
          </span>
        </div>
      </div>
    );
  }

  const dotSize = 4, gapSize = 14, period = dotSize + gapSize;
  const DotTrack = ({ animName }: { animName: string }) => (
    <div style={{ height: dotSize, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: gapSize, animation: `${animName} ${period * 50}ms linear infinite` }}>
        {Array.from({ length: 30 }).map((_, i) => (
          <div key={i} style={{ width: dotSize, height: dotSize, flexShrink: 0, background: color, borderRadius: 1, opacity: 0.85 }} />
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: direction === 'bidirectional' ? 5 : 0, margin: '0 4px' }}>
      <style>{`
        @keyframes fl-${cls} { from { transform: translateX(0); } to { transform: translateX(-${period}px); } }
        @keyframes fr-${cls} { from { transform: translateX(-${period}px); } to { transform: translateX(0); } }
      `}</style>
      {(direction === 'inbound' || direction === 'bidirectional') && <DotTrack animName={`fl-${cls}`} />}
      {(direction === 'outbound' || direction === 'bidirectional') && <DotTrack animName={`fr-${cls}`} />}
    </div>
  );
}

// ============================================================
// Constants
// ============================================================

const PROVIDER_LABELS: Record<string, string> = {
  filesystem: 'OpenClaw', openclaw: 'OpenClaw',
  github: 'GitHub', notion: 'Notion', gmail: 'Gmail',
  google_calendar: 'Google Calendar', google_sheets: 'Google Sheets',
  google_drive: 'Google Drive', google_docs: 'Google Docs',
  airtable: 'Airtable', linear: 'Linear',
  folder_access: 'Folder Access', folder_source: 'Folder Source',
  url: 'URL Import', webhook: 'Webhook',
};

const DIRECTION_LABELS: Record<string, string> = {
  inbound: 'Syncing to PuppyOne',
  outbound: 'Syncing from PuppyOne',
  bidirectional: 'Bidirectional sync',
};

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
// SyncDetailView
// ============================================================

export function SyncDetailView({ syncId, projectId }: SyncDetailViewProps) {
  const { closeSidebar } = useAgent();
  const [refreshing, setRefreshing] = useState(false);

  const { data: syncData, mutate } = useSWR<{ syncs: SyncDetail[] }>(
    projectId ? ['sync-status', projectId] : null,
    () => get<{ syncs: SyncDetail[] }>(`/api/v1/sync/status?project_id=${projectId}`),
    { revalidateOnFocus: true },
  );

  const sync = syncData?.syncs?.find(s => s.id === syncId);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await mutate();
    setTimeout(() => setRefreshing(false), 600);
  }, [mutate]);

  if (!sync) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <ViewHeader name="Sync" onClose={closeSidebar} />
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: '#525252', fontSize: 13 }}>
          Sync endpoint not found
        </div>
      </div>
    );
  }

  const providerLabel = PROVIDER_LABELS[sync.provider] || sync.provider;
  const dirLabel = DIRECTION_LABELS[sync.direction] || sync.direction;
  const isActive = sync.status === 'active' || sync.status === 'syncing';
  const isError = sync.status === 'error';
  const isPaused = sync.status === 'paused';

  const statusColor = isError ? '#ef4444' : isActive ? '#22c55e' : isPaused ? '#f59e0b' : '#525252';
  const statusLabel = isError ? 'Error' : sync.status === 'syncing' ? 'Syncing' : isActive ? 'Sync active' : isPaused ? 'Paused' : sync.status || 'Inactive';
  const statusTextColor = isError ? '#fca5a5' : isActive ? '#e5e5e5' : '#a3a3a3';

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <ViewHeader name={sync.node_name || providerLabel} icon={getProviderLogo(sync.provider, 18)} onClose={closeSidebar} />

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 40px', display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Sync visualization */}
          <div style={{
            background: '#141414', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 10, padding: '28px 24px 20px',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {/* Icons + connection */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {/* PuppyOne node (LEFT) — icon matches node type */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 80 }}>
                {sync.node_type === 'folder' || !sync.node_type
                  ? <img src="/icons/folder.svg" alt="Folder" width={36} height={36} style={{ display: 'block' }} />
                  : <MiniDocShell type={sync.node_type as 'json' | 'markdown' | 'file'} />
                }
                <div style={{ fontSize: 11, fontWeight: 500, color: '#a3a3a3', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>
                  {sync.node_name || 'Workspace'}
                </div>
              </div>

              {/* Connection line */}
              <ConnectionLine
                direction={sync.direction}
                color={isActive ? '#4ade80' : isError ? '#ef4444' : '#525252'}
                isActive={isActive}
                status={sync.status}
              />

              {/* External service (RIGHT) */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 80 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {getProviderLogo(sync.provider, 22)}
                </div>
                <div style={{ fontSize: 11, fontWeight: 500, color: '#a3a3a3', textAlign: 'center' }}>
                  {providerLabel}
                </div>
              </div>
            </div>

            {/* Status line */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0 0' }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', background: statusColor,
                display: 'inline-block', flexShrink: 0,
              }} />
              <span style={{ fontSize: 11, fontWeight: 500, color: statusTextColor }}>
                {statusLabel}
              </span>
              {sync.last_synced_at && (
                <span style={{ fontSize: 11, color: '#525252' }}>
                  · {relativeTime(sync.last_synced_at)}
                </span>
              )}
              <button
                onClick={handleRefresh}
                title="Refresh"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: '#525252', padding: 2, borderRadius: 4, display: 'flex',
                  marginLeft: 'auto', transition: 'color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#a3a3a3'}
                onMouseLeave={e => e.currentTarget.style.color = '#525252'}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ animation: refreshing ? 'spin 0.6s linear' : 'none' }}
                >
                  <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
            </div>
          </div>

          {/* Error banner */}
          {sync.error_message && (
            <div style={{
              padding: '8px 12px', borderRadius: 6,
              background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)',
            }}>
              <div style={{ fontSize: 11, color: '#f87171', lineHeight: 1.5 }}>{sync.error_message}</div>
            </div>
          )}

          {/* Actions — Linear style: 28px, minimal */}
          <div style={{ display: 'flex', gap: 6 }}>
            {isActive && (
              <ActionButton label="Pause" icon="pause" onClick={() => {}} />
            )}
            {isPaused && (
              <ActionButton label="Resume" icon="play" onClick={() => {}} />
            )}
            {isError && (
              <ActionButton label="Retry" icon="retry" onClick={handleRefresh} />
            )}
            <ActionButton label="Disconnect" icon="disconnect" variant="danger" onClick={() => {}} />
          </div>

          {/* OpenClaw: Access Key */}
          {sync.provider === 'openclaw' && sync.access_key && (
            <AccessKeyRow accessKey={sync.access_key} />
          )}

          {/* Details section */}
          <div style={{ padding: '0 4px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#737373', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.5px' }}>
              Details
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <DetailRow label="Provider" value={providerLabel} />
              <DetailRow label="Direction" value={dirLabel} />
              {sync.node_name && <DetailRow label="Folder" value={sync.node_name} />}
              <DetailRow label="Last synced" value={sync.last_synced_at ? relativeTime(sync.last_synced_at) : 'Never'} />
              <DetailRow label="Sync ID" value={sync.id} mono />
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

// ============================================================
// Sub-components
// ============================================================

function ViewHeader({ name, icon, onClose }: { name: string; icon?: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{
      height: 48, padding: '0 16px', borderBottom: '1px solid #222', background: '#0d0d0d',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && <span style={{ display: 'flex' }}>{icon}</span>}
        <span style={{ fontSize: 14, fontWeight: 500, color: '#ededed' }}>{name}</span>
      </div>
      <button
        onClick={onClose}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#666', display: 'flex', padding: 6, borderRadius: 4, transition: 'color 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#ededed'}
        onMouseLeave={e => e.currentTarget.style.color = '#666'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

function ActionButton({ label, icon, variant = 'default', onClick }: {
  label: string; icon: string; variant?: 'default' | 'danger'; onClick: () => void;
}) {
  const isDanger = variant === 'danger';
  const textColor = isDanger ? '#a3a3a3' : '#d4d4d4';
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        height: 28, padding: '0 10px', borderRadius: 6,
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.08)',
        color: textColor, fontSize: 12, fontWeight: 500, cursor: 'pointer',
        transition: 'all 0.12s',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = isDanger ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)';
        e.currentTarget.style.borderColor = isDanger ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.12)';
        if (isDanger) e.currentTarget.style.color = '#ef4444';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
        e.currentTarget.style.color = textColor;
      }}
    >
      {icon === 'pause' && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
      )}
      {icon === 'play' && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3L19 12L5 21V3Z"/></svg>
      )}
      {icon === 'retry' && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      )}
      {icon === 'disconnect' && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      )}
      {label}
    </button>
  );
}

function AccessKeyRow({ accessKey }: { accessKey: string }) {
  const [copied, setCopied] = React.useState(false);
  const masked = accessKey.slice(0, 8) + '...' + accessKey.slice(-4);
  const handleCopy = () => {
    navigator.clipboard.writeText(accessKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#737373', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.5px' }}>
        Credentials
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ fontSize: 11, color: '#525252', fontWeight: 500, width: 72 }}>Access Key</div>
        <code style={{ flex: 1, fontSize: 11, color: '#a3a3a3', fontFamily: "'JetBrains Mono', monospace" }}>{masked}</code>
        <button
          onClick={handleCopy}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: copied ? '#4ade80' : '#525252', padding: 4, display: 'flex' }}
        >
          {copied ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          )}
        </button>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 0',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    }}>
      <div style={{ fontSize: 11, color: '#525252', fontWeight: 500, flexShrink: 0, width: 72 }}>{label}</div>
      <div style={{
        flex: 1, fontSize: mono ? 11 : 12, color: '#a3a3a3',
        fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
    </div>
  );
}
