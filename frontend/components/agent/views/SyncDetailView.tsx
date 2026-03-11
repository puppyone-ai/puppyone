'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { get, post, patch, del } from '@/lib/apiClient';
import { SYNC_MODE_META, getProviderDisplayLabel, getSyncTriggerPolicy } from '@/lib/syncTriggerPolicy';
import type { SyncModeType } from '@/lib/syncTriggerPolicy';
import { useConnectorSpecs } from '@/lib/hooks/useData';
import { PanelShell } from '../../../app/(main)/projects/[projectId]/data/components/PanelShell';

interface SyncDetail {
  id: string;
  node_id: string;
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
  onClose?: () => void;
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
// ConnectionLine — directional arrows
// ============================================================

function ConnectionLine({ direction, isActive, status }: { direction: string; color?: string; isActive: boolean; status: string }) {
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
          <path d="M2 5h44M6 2L2 5l4 3" />
          <path d="M42 8l4 3-4 3M2 11h44" />
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

// ============================================================
// Constants
// ============================================================

const PROVIDER_LABELS: Record<string, string> = {
  filesystem: 'Desktop Folder',
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

export { getProviderLogo, PROVIDER_LABELS };

export function SyncDetailView({ syncId, projectId, onClose }: SyncDetailViewProps) {
  const [refreshing, setRefreshing] = useState(false);
  const { specs } = useConnectorSpecs();

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

  const handleSyncRefresh = useCallback(async () => {
    if (!syncId) return;
    setRefreshing(true);
    try {
      await post(`/api/v1/sync/syncs/${syncId}/refresh`);
      await mutate();
    } catch (err) {
      console.error('Sync refresh failed:', err);
    } finally {
      setTimeout(() => setRefreshing(false), 1000);
    }
  }, [syncId, mutate]);

  const handlePause = useCallback(async () => {
    if (!syncId) return;
    try {
      await post(`/api/v1/sync/syncs/${syncId}/pause`);
      await mutate();
    } catch (err) {
      console.error('Pause failed:', err);
    }
  }, [syncId, mutate]);

  const handleResume = useCallback(async () => {
    if (!syncId) return;
    try {
      await post(`/api/v1/sync/syncs/${syncId}/resume`);
      await mutate();
    } catch (err) {
      console.error('Resume failed:', err);
    }
  }, [syncId, mutate]);

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
      <PanelShell title="Connection" onClose={onClose || (() => {})}>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: '#525252', fontSize: 12, height: '100%' }}>
          Sync endpoint not found
        </div>
      </PanelShell>
    );
  }

  const providerLabel = getProviderDisplayLabel(sync.provider, specs) !== sync.provider
    ? getProviderDisplayLabel(sync.provider, specs)
    : (PROVIDER_LABELS[sync.provider] || sync.provider);
  const dirLabel = DIRECTION_LABELS[sync.direction] || sync.direction;
  const isActive = sync.status === 'active' || sync.status === 'syncing';
  const isError = sync.status === 'error';
  const isPaused = sync.status === 'paused';

  const statusColor = isError ? '#ef4444' : isActive ? '#22c55e' : isPaused ? '#f59e0b' : '#525252';
  const statusLabel = isError ? 'Error' : sync.status === 'syncing' ? 'Syncing' : isActive ? 'Sync active' : isPaused ? 'Paused' : sync.status || 'Inactive';
  const statusTextColor = isError ? '#fca5a5' : isActive ? '#e5e5e5' : '#a3a3a3';

  const normalizedMode = normalizeMode(sync.trigger?.type);

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
      <PanelShell
        title={sync.node_name || providerLabel}
        icon={getProviderLogo(sync.provider, 14)}
        onClose={onClose || (() => {})}
      >
        <div style={{ padding: '20px 24px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Sync visualization */}
          <div style={{
            borderRadius: 10, padding: '24px 24px 16px',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {/* Icons + connection */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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

              <ConnectionLine
                direction={sync.direction}
                isActive={isActive}
                status={sync.status}
              />

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 80 }}>
                {sync.node_type === 'folder' || !sync.node_type
                  ? <img src="/icons/folder.svg" alt="Folder" width={36} height={36} style={{ display: 'block' }} />
                  : <MiniDocShell type={sync.node_type as 'json' | 'markdown' | 'file'} />
                }
                <div style={{ fontSize: 11, fontWeight: 500, color: '#a3a3a3', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>
                  {sync.node_name || 'Workspace'}
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

          {/* Trigger mode selector */}
          <TriggerModeSelector
            syncId={sync.id}
            provider={sync.provider}
            currentMode={normalizedMode}
            currentTrigger={sync.trigger}
            onUpdated={mutate}
          />

          {/* Actions */}
          <div style={{ display: 'flex', gap: 6 }}>
            {normalizedMode === 'manual' && (
              <ActionButton label={refreshing ? 'Refreshing...' : 'Refresh now'} icon="retry" onClick={handleSyncRefresh} />
            )}
            {normalizedMode === 'scheduled' && (
              <ActionButton label={refreshing ? 'Syncing...' : 'Sync now'} icon="retry" onClick={handleSyncRefresh} />
            )}
            {isActive && (
              <ActionButton label="Pause" icon="pause" onClick={handlePause} />
            )}
            {isPaused && (
              <ActionButton label="Resume" icon="play" onClick={handleResume} />
            )}
            {isError && (
              <ActionButton label="Retry" icon="retry" onClick={handleSyncRefresh} />
            )}
            <ActionButton label={disconnecting ? 'Removing...' : 'Disconnect'} icon="disconnect" variant="danger" onClick={handleDisconnect} />
          </div>

          {/* OpenClaw: Access Key */}
          {sync.provider === 'filesystem' && sync.access_key && (
            <AccessKeyRow accessKey={sync.access_key} />
          )}

          {/* Details — minimal */}
          <div style={{ padding: '0 4px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#737373', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.5px' }}>
              Details
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <DetailRow label="Sync ID" value={sync.id} mono />
            </div>
          </div>

        </div>
      </PanelShell>
    </>
  );
}

// ============================================================
// PanelHeader — consistent with PanelShell
// ============================================================

function PanelHeader({ title, icon, onClose }: { title: string; icon?: React.ReactNode; onClose?: () => void }) {
  return (
    <div style={{
      height: 40, minHeight: 40, display: 'flex', alignItems: 'center', gap: 8,
      padding: '0 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0,
    }}>
      {icon && <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </span>
      {onClose && (
        <button
          onClick={onClose}
          title="Close panel"
          style={{
            background: 'none', border: 'none', color: '#71717a', cursor: 'pointer',
            padding: '4px 6px', fontSize: 16, lineHeight: 1, borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'color 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#e4e4e7'; }}
          onMouseLeave={e => { e.currentTarget.style.color = '#71717a'; }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// ============================================================
// normalizeMode — map backend values to canonical SyncModeType
// ============================================================

function normalizeMode(raw?: string): SyncModeType {
  if (!raw) return 'import_once';
  if (raw === 'cli_push' || raw === 'realtime') return 'realtime';
  if (raw === 'cron' || raw === 'scheduled') return 'scheduled';
  if (raw === 'manual') return 'manual';
  return 'import_once';
}

// ============================================================
// TriggerModeSelector
// ============================================================

function TriggerModeSelector({
  syncId,
  provider,
  currentMode,
  currentTrigger,
  onUpdated,
}: {
  syncId: string;
  provider: string;
  currentMode: SyncModeType;
  currentTrigger: SyncDetail['trigger'];
  onUpdated: () => void;
}) {
  const { specs } = useConnectorSpecs();
  const policy = getSyncTriggerPolicy(provider, specs);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [pendingMode, setPendingMode] = useState<SyncModeType>(currentMode);
  const [scheduleConfig, setScheduleConfig] = useState<{ schedule?: string; timezone?: string } | null>(
    currentTrigger?.schedule ? { schedule: currentTrigger.schedule, timezone: currentTrigger.timezone || 'Asia/Shanghai' } : null,
  );

  const isLocked = policy.supportedModes.length <= 1;

  useEffect(() => {
    setPendingMode(currentMode);
    setScheduleConfig(
      currentTrigger?.schedule ? { schedule: currentTrigger.schedule, timezone: currentTrigger.timezone || 'Asia/Shanghai' } : null,
    );
  }, [currentMode, currentTrigger]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const trigger: Record<string, string> = { type: pendingMode };
      if (pendingMode === 'scheduled' && scheduleConfig?.schedule) {
        trigger.schedule = scheduleConfig.schedule;
        trigger.timezone = scheduleConfig.timezone || 'Asia/Shanghai';
      }
      await patch(`/api/v1/sync/syncs/${syncId}/trigger`, {
        sync_mode: pendingMode,
        trigger,
      });
      onUpdated();
      setEditMode(false);
    } catch (err) {
      console.error('Failed to update trigger:', err);
    } finally {
      setSaving(false);
    }
  }, [syncId, pendingMode, scheduleConfig, onUpdated]);

  const handleCancel = useCallback(() => {
    setPendingMode(currentMode);
    setScheduleConfig(
      currentTrigger?.schedule ? { schedule: currentTrigger.schedule, timezone: currentTrigger.timezone || 'Asia/Shanghai' } : null,
    );
    setEditMode(false);
  }, [currentMode, currentTrigger]);

  const modeLabel = SYNC_MODE_META[currentMode]?.label || currentMode;

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#737373', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Sync Mode
        </div>
        {!isLocked && !editMode && (
          <button
            onClick={() => setEditMode(true)}
            style={{
              background: 'none', border: 'none', color: '#525252', cursor: 'pointer',
              fontSize: 11, padding: '2px 6px', borderRadius: 4, transition: 'color 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#a3a3a3'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#525252'; }}
          >
            Edit
          </button>
        )}
      </div>

      {!editMode ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6,
        }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#e4e4e7' }}>{modeLabel}</span>
          {currentMode === 'scheduled' && currentTrigger?.schedule && (
            <span style={{ fontSize: 11, color: '#525252' }}>· {describeCron(currentTrigger.schedule)}</span>
          )}
          {isLocked && (
            <span style={{ fontSize: 10, color: '#525252', marginLeft: 'auto' }}>Fixed</span>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Mode buttons */}
          <div style={{ display: 'flex', gap: 4 }}>
            {policy.supportedModes.map(mode => (
              <button
                key={mode}
                onClick={() => setPendingMode(mode)}
                style={{
                  flex: 1, height: 32, borderRadius: 6, fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', transition: 'all 0.12s',
                  background: pendingMode === mode ? 'rgba(59,130,246,0.12)' : 'transparent',
                  border: pendingMode === mode ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(255,255,255,0.08)',
                  color: pendingMode === mode ? '#60a5fa' : '#a3a3a3',
                }}
              >
                {SYNC_MODE_META[mode]?.label || mode}
              </button>
            ))}
          </div>

          {/* Description */}
          <div style={{ fontSize: 11, color: '#525252', padding: '0 2px' }}>
            {SYNC_MODE_META[pendingMode]?.desc}
          </div>

          {/* Schedule config when "scheduled" is selected */}
          {pendingMode === 'scheduled' && (
            <ScheduleEditor
              config={scheduleConfig}
              onChange={setScheduleConfig}
            />
          )}

          {/* Save / Cancel */}
          <div style={{ display: 'flex', gap: 6, paddingTop: 4 }}>
            <button
              onClick={handleSave}
              disabled={saving || (pendingMode === 'scheduled' && !scheduleConfig?.schedule)}
              style={{
                flex: 1, height: 28, borderRadius: 6, fontSize: 12, fontWeight: 500,
                background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)',
                color: '#60a5fa', cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving || (pendingMode === 'scheduled' && !scheduleConfig?.schedule) ? 0.5 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={handleCancel}
              style={{
                flex: 1, height: 28, borderRadius: 6, fontSize: 12, fontWeight: 500,
                background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
                color: '#a3a3a3', cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ScheduleEditor — lightweight inline cron builder
// ============================================================

function ScheduleEditor({
  config,
  onChange,
}: {
  config: { schedule?: string; timezone?: string } | null;
  onChange: (c: { schedule?: string; timezone?: string }) => void;
}) {
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [repeatType, setRepeatType] = useState<'daily' | 'weekly'>('daily');
  const [weekday, setWeekday] = useState(1);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (!config?.schedule) {
      onChange({ schedule: `0 9 * * *`, timezone: 'Asia/Shanghai' });
      return;
    }
    const parts = config.schedule.split(' ');
    if (parts.length < 5) return;
    const m = parseInt(parts[0], 10);
    const h = parseInt(parts[1], 10);
    if (!isNaN(m)) setMinute(m);
    if (!isNaN(h)) setHour(h);
    if (parts[4] !== '*' && parts[2] === '*') {
      setRepeatType('weekly');
      const d = parseInt(parts[4], 10);
      if (!isNaN(d)) setWeekday(d);
    } else {
      setRepeatType('daily');
    }
  }, [config, onChange]);

  const buildCron = useCallback((h: number, m: number, rpt: typeof repeatType, wd: number) => {
    const cron = rpt === 'weekly' ? `${m} ${h} * * ${wd}` : `${m} ${h} * * *`;
    onChange({ schedule: cron, timezone: 'Asia/Shanghai' });
  }, [onChange]);

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const selectStyle: React.CSSProperties = {
    height: 28, padding: '0 6px', borderRadius: 4, fontSize: 12,
    background: '#161616', border: '1px solid rgba(255,255,255,0.1)', color: '#e4e4e7',
    cursor: 'pointer', outline: 'none',
  };

  return (
    <div style={{
      padding: '10px 12px', borderRadius: 6,
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <select
          value={repeatType}
          onChange={e => {
            const v = e.target.value as typeof repeatType;
            setRepeatType(v);
            buildCron(hour, minute, v, weekday);
          }}
          style={selectStyle}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
        {repeatType === 'weekly' && (
          <select
            value={weekday}
            onChange={e => {
              const d = parseInt(e.target.value, 10);
              setWeekday(d);
              buildCron(hour, minute, repeatType, d);
            }}
            style={selectStyle}
          >
            {dayLabels.map((label, i) => (
              <option key={i} value={i}>{label}</option>
            ))}
          </select>
        )}
        <span style={{ fontSize: 12, color: '#525252' }}>at</span>
        <select
          value={hour}
          onChange={e => {
            const h = parseInt(e.target.value, 10);
            setHour(h);
            buildCron(h, minute, repeatType, weekday);
          }}
          style={{ ...selectStyle, width: 52 }}
        >
          {Array.from({ length: 24 }, (_, i) => (
            <option key={i} value={i}>{i.toString().padStart(2, '0')}</option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: '#525252' }}>:</span>
        <select
          value={minute}
          onChange={e => {
            const m = parseInt(e.target.value, 10);
            setMinute(m);
            buildCron(hour, m, repeatType, weekday);
          }}
          style={{ ...selectStyle, width: 52 }}
        >
          {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
            <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
          ))}
        </select>
      </div>
      <div style={{ fontSize: 11, color: '#525252' }}>
        {repeatType === 'daily' ? `Every day at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}` : `Every ${dayLabels[weekday]} at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`}
      </div>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function describeCron(schedule: string): string {
  const parts = schedule.split(' ');
  if (parts.length < 5) return schedule;
  const [min, hour, day, month, weekday] = parts;

  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

  if (weekday !== '*' && day === '*') return `Weekly at ${time}`;
  if (day === '*' && month === '*' && weekday === '*') return `Daily at ${time}`;
  return `At ${time}`;
}

// ============================================================
// Sub-components
// ============================================================

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
