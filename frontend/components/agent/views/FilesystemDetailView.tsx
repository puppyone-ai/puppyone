'use client';

import React, { useState, useCallback } from 'react';
import useSWR from 'swr';
import { get, del } from '@/lib/apiClient';
import { PanelShell } from '../../../app/(main)/projects/[projectId]/data/components/PanelShell';

interface SyncDetail {
  id: string;
  path: string;
  node_name: string | null;
  node_type: string | null;
  provider: string;
  direction: string;
  status: string;
  access_key: string | null;
  trigger: { type?: string; schedule?: string; timezone?: string } | null;
  last_synced_at: string | null;
  error_message: string | null;
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

function LaptopIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </svg>
  );
}

interface FilesystemDetailViewProps {
  syncId: string;
  projectId?: number | string;
  onClose?: () => void;
}

export function FilesystemDetailView({ syncId, projectId, onClose }: FilesystemDetailViewProps) {
  const { data: syncData, mutate } = useSWR<{ syncs: SyncDetail[] }>(
    projectId ? ['sync-status', projectId] : null,
    () => get<{ syncs: SyncDetail[] }>(`/api/v1/sync/status?project_id=${projectId}`),
    { revalidateOnFocus: true },
  );

  const sync = syncData?.syncs?.find(s => s.id === syncId);

  const [disconnecting, setDisconnecting] = useState(false);
  const handleDisconnect = useCallback(async () => {
    if (!syncId || disconnecting) return;
    setDisconnecting(true);
    try {
      await del(`/api/v1/sync/syncs/${syncId}`);
      await mutate();
      onClose?.();
    } catch (err) {
      console.error('Disconnect failed:', err);
    } finally {
      setDisconnecting(false);
    }
  }, [syncId, disconnecting, mutate, onClose]);

  if (!sync) {
    return (
      <PanelShell title="Local Folder" onClose={onClose || (() => {})}>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: '#525252', fontSize: 13, height: '100%' }}>
          Access point not found
        </div>
      </PanelShell>
    );
  }

  const isActive = sync.status === 'active' || sync.status === 'syncing';
  const isError = sync.status === 'error';
  const statusColor = isError ? '#ef4444' : isActive ? '#22c55e' : '#525252';
  const statusLabel = isError ? 'Error' : isActive ? 'Connected' : sync.status || 'Inactive';

  const accessKey = sync.access_key || '';
  const apiBase = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL || window.location.origin) : '';
  const cloneUrl = `${apiBase}/api/v1/mut/ap/${accessKey}`;

  return (
    <PanelShell
      title="Local Folder"
      subtitle={sync.node_name || undefined}
      icon={<LaptopIcon size={14} />}
      onClose={onClose || (() => {})}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* ── Flow visualization ── */}
        <div style={{
          padding: '16px 0 8px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {/* Source (LEFT) → Arrow → Workspace (RIGHT) */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 0 }}>
            {/* Local source (LEFT) */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 72, flexShrink: 0 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              }}>
                <LaptopIcon size={24} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#d4d4d4', textAlign: 'center' }}>
                Local Folder
              </div>
            </div>

            {/* Arrow area */}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              width: 80, flexShrink: 0, paddingTop: 16,
            }}>
              {isActive ? (
                <svg width="80" height="16" viewBox="0 0 80 16" fill="none" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 5h76M6 2L2 5l4 3M74 8l4 3-4 3M2 11h76" />
                </svg>
              ) : (
                <svg width="80" height="16" viewBox="0 0 80 16" fill="none" stroke={isError ? '#ef4444' : '#525252'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 4">
                  <path d="M2 8h76" />
                </svg>
              )}
            </div>

            {/* Workspace target (RIGHT) */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 72, flexShrink: 0 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              }}>
                {sync.node_type === 'folder' || !sync.node_type
                  ? <img src="/icons/folder.svg" alt="Folder" width={24} height={24} style={{ display: 'block' }} />
                  : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                }
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#d4d4d4', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 72 }}>
                {sync.node_name || 'Workspace'}
              </div>
            </div>
          </div>

          {/* Status line */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 2 }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%', background: statusColor,
              display: 'inline-block', flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, fontWeight: 500, color: isActive ? '#e5e5e5' : '#71717a' }}>
              {isError ? 'Sync error' : isActive ? 'Sync active' : statusLabel}
            </span>
            {sync.last_synced_at && (
              <span style={{ fontSize: 11, color: '#525252' }}>
                · {relativeTime(sync.last_synced_at)}
              </span>
            )}
          </div>
        </div>

        {/* ── Error banner ── */}
        {sync.error_message && (
          <div style={{
            margin: '12px 20px 0',
            padding: '10px 12px', borderRadius: 8,
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.12)',
          }}>
            <div style={{ fontSize: 12, color: '#f87171', lineHeight: 1.6 }}>{sync.error_message}</div>
          </div>
        )}

        {/* ── Setup (one-time) ── */}
        {accessKey && (
          <div style={{ padding: '20px 20px 0' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 14 }}>
              Setup
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <CommandBlock
                command="pip install mut"
                label="Install"
              />
              <CommandBlock
                command={`mut clone ${cloneUrl} \\\n  --credential ${accessKey}`}
                label="Clone"
              />
            </div>
            <div style={{ fontSize: 12, color: '#525252', marginTop: 8, lineHeight: 1.5 }}>
              Run once. Creates a local <code style={{ fontFamily: "'JetBrains Mono', 'SF Mono', monospace", color: '#71717a' }}>./{sync.node_name || 'project'}/</code> folder linked to this context.
            </div>
          </div>
        )}

        {/* ── Usage (ongoing) ── */}
        {accessKey && (
          <div style={{ padding: '20px 20px 0' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 14 }}>
              Usage
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <CommandBlock
                command={`mut commit -m "message" && mut push`}
                label="Push"
                hint="Send local changes to the cloud"
              />
              <CommandBlock
                command="mut pull"
                label="Pull"
                hint="Fetch changes from other agents or the web UI"
              />
            </div>
          </div>
        )}

        {/* ── Credentials ── */}
        {accessKey && (
          <div style={{ padding: '24px 20px 0' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
              Credentials
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <CredentialRow label="Access Key" value={accessKey} />
              <CredentialRow label="Clone URL" value={cloneUrl} />
            </div>
          </div>
        )}

        {/* ── Details ── */}
        <div style={{ padding: '24px 20px 0' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
            Details
          </div>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 0,
            background: 'rgba(255,255,255,0.02)', borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden',
          }}>
            <InfoRow label="Sync ID" value={sync.id} isLast={false} />
            <InfoRow label="Direction" value="Bidirectional" isLast={false} />
            <InfoRow label="Protocol" value="MUT" isLast />
          </div>
        </div>

        {/* ── Disconnect ── */}
        <div style={{ padding: '24px 20px 40px' }}>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            style={{
              width: '100%', height: 36, borderRadius: 8,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#a3a3a3', fontSize: 13, fontWeight: 500,
              cursor: disconnecting ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(239,68,68,0.06)';
              e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)';
              e.currentTarget.style.color = '#ef4444';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.color = '#a3a3a3';
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            {disconnecting ? 'Disconnecting...' : 'Disconnect'}
          </button>
        </div>

      </div>
    </PanelShell>
  );
}

/* ================================================================
   Sub-components
   ================================================================ */

function CommandBlock({ command, label, hint }: {
  command: string;
  label: string;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleCopy = () => {
    const flat = command.replace(/\\\n\s*/g, '');
    navigator.clipboard.writeText(flat);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'relative',
          background: '#0a0a0a',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 8, padding: '10px 12px',
          transition: 'border-color 0.15s',
          borderColor: hovered ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)',
        }}
      >
        <pre style={{
          margin: 0, fontSize: 12, lineHeight: 1.6,
          color: '#a3a3a3',
          fontFamily: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', monospace",
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          paddingRight: 28,
        }}>
          <span style={{ color: '#525252', userSelect: 'none' }}>$ </span>
          {command}
        </pre>
        <button
          onClick={handleCopy}
          title={`Copy ${label} command`}
          style={{
            position: 'absolute', top: 8, right: 8,
            background: 'transparent', border: 'none',
            cursor: 'pointer',
            color: copied ? '#34d399' : '#525252',
            padding: 4, borderRadius: 4, display: 'flex',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { if (!copied) e.currentTarget.style.color = '#a3a3a3'; }}
          onMouseLeave={e => { if (!copied) e.currentTarget.style.color = '#525252'; }}
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          )}
        </button>
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: '#525252', marginTop: 4, lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const masked = value.length > 16
    ? value.slice(0, 12) + '···' + value.slice(-6)
    : value;

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px',
      background: 'rgba(255,255,255,0.02)', borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <span style={{ fontSize: 12, color: '#525252', fontWeight: 500, flexShrink: 0, width: 76 }}>
        {label}
      </span>
      <code style={{
        flex: 1, fontSize: 11, color: '#a3a3a3',
        fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {masked}
      </code>
      <button
        onClick={handleCopy}
        title={`Copy ${label}`}
        style={{
          background: 'transparent', border: 'none',
          cursor: 'pointer',
          color: copied ? '#34d399' : '#525252',
          padding: 4, display: 'flex', flexShrink: 0,
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => { if (!copied) e.currentTarget.style.color = '#a3a3a3'; }}
        onMouseLeave={e => { if (!copied) e.currentTarget.style.color = '#525252'; }}
      >
        {copied ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        )}
      </button>
    </div>
  );
}

function InfoRow({ label, value, isLast }: { label: string; value: string; isLast: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '10px 12px',
      borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.04)',
    }}>
      <span style={{ fontSize: 12, color: '#525252', fontWeight: 500, flexShrink: 0, width: 76 }}>
        {label}
      </span>
      <span style={{
        flex: 1, fontSize: 12, color: '#a3a3a3',
        fontFamily: label === 'Sync ID' ? "'JetBrains Mono', 'SF Mono', monospace" : 'inherit',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  );
}
