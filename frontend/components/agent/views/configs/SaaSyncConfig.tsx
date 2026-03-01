'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import type { AccessResource } from '@/contexts/AgentContext';
import { openOAuthPopup, type SaasType } from '@/lib/oauthApi';
import { SyncPreview, type AcceptedNodeType } from './SyncPreview';
import { ScheduleTriggerSection } from './ScheduleAgentConfig';
import { FolderIcon, JsonIcon, MarkdownIcon, CloseIcon, getNodeIcon } from '../_icons';

export interface SaaSConfigField {
  key: string;
  label: string;
  type: 'select' | 'text';
  placeholder?: string;
  options?: { value: string; label: string }[];
  defaultValue?: string;
}

type SyncDirection = 'inbound' | 'outbound' | 'bidirectional';

export interface SaaSyncConfigProps {
  provider: string;
  providerLabel: string;
  oauthType: SaasType;
  icon: React.ReactNode;
  description: string;
  configFields: SaaSConfigField[];
  accept: AcceptedNodeType[];
  direction: SyncDirection;
}

type OAuthStatus = { connected: boolean; email?: string } | null;

const TYPE_ARTICLE: Record<AcceptedNodeType, string> = {
  folder: 'a folder', json: 'a JSON file', markdown: 'a Markdown file', file: 'a file',
};

export function SaaSyncConfig({
  provider, providerLabel, oauthType, icon, description,
  configFields, accept, direction,
}: SaaSyncConfigProps) {
  const { draftResources, addDraftResource, removeDraftResource } = useAgent();
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>(null);
  const [checking, setChecking] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const primaryType = accept[0];
  const targetRes = draftResources[0] || null;
  const isConnected = !!oauthStatus?.connected;

  // ── OAuth ──

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const checkers: Record<string, () => Promise<OAuthStatus>> = {
        gmail: async () => { const { getGmailStatus } = await import('@/lib/oauthApi'); return getGmailStatus(); },
        calendar: async () => { const { getGoogleCalendarStatus } = await import('@/lib/oauthApi'); return getGoogleCalendarStatus(); },
        sheets: async () => { const { getGoogleSheetsStatus } = await import('@/lib/oauthApi'); const s = await getGoogleSheetsStatus(); return { connected: s.connected, email: s.workspace_name }; },
        docs: async () => { const { getGoogleDocsStatus } = await import('@/lib/oauthApi'); return getGoogleDocsStatus(); },
        github: async () => { const { getGithubStatus } = await import('@/lib/oauthApi'); const s = await getGithubStatus(); return { connected: s.connected, email: s.username }; },
      };
      const checker = checkers[oauthType];
      setOauthStatus(checker ? await checker() : { connected: false });
    } catch {
      setOauthStatus({ connected: false });
    } finally {
      setChecking(false);
    }
  }, [oauthType]);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const handleConnect = async () => {
    setConnecting(true); setError(null);
    try { await openOAuthPopup(oauthType); await checkStatus(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Authorization failed'); }
    finally { setConnecting(false); }
  };

  // ── Drag & drop (same pattern as ChatAgentConfig) ──

  const handleDragOver = (e: React.DragEvent) => {
    if (targetRes) return;
    if (e.dataTransfer.types.includes('application/x-puppyone-node')) {
      e.preventDefault(); e.stopPropagation(); setIsDragging(true);
    }
  };
  const handleDragLeave = (e: React.DragEvent) => { e.stopPropagation(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    if (targetRes) return;
    const data = e.dataTransfer.getData('application/x-puppyone-node');
    if (!data) return;
    try {
      const node = JSON.parse(data);
      const nodeType: AcceptedNodeType = node.type === 'folder' ? 'folder' : node.type === 'json' ? 'json' : node.type === 'markdown' ? 'markdown' : 'file';
      if (!accept.includes(nodeType)) return;
      addDraftResource({ nodeId: node.nodeId || node.id, nodeName: node.name, nodeType, readonly: true, jsonPath: node.jsonPath || '' } as AccessResource);
    } catch { /* ignore */ }
  };

  // ── Render ──

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ─── 1. Hero card: sync visualization ─── */}
      <SyncPreview
        provider={provider} providerLabel={providerLabel} direction={direction}
        targetName={targetRes?.nodeName || null} targetType={targetRes?.nodeType as AcceptedNodeType || primaryType}
        isActive={!!targetRes && isConnected}
      />

      {/* ─── 2. Drag zone (ChatAgentConfig style) ─── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: '#666' }}>Sync target</label>
          <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
        </div>

        <div
          style={{
            minHeight: 72,
            background: isDragging ? 'rgba(255,255,255,0.03)' : 'transparent',
            border: isDragging ? '1px dashed #525252' : targetRes ? '1px solid #2a2a2a' : '1px dashed #2a2a2a',
            borderRadius: 6, transition: 'all 0.15s',
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {targetRes && (
            <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(() => {
                const { icon: nodeIcon, color } = getNodeIcon(targetRes.nodeType);
                return (
                  <div
                    style={{
                      height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0 10px', borderRadius: 4, background: '#1a1a1a', border: '1px solid #252525', transition: 'all 0.1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#222'; e.currentTarget.style.borderColor = '#333'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.borderColor = '#252525'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1, minWidth: 0 }}>
                      <div style={{ color, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{nodeIcon}</div>
                      <span style={{ fontSize: 13, color: '#e5e5e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {targetRes.nodeName}
                      </span>
                    </div>
                    <button
                      onClick={() => removeDraftResource(targetRes.nodeId)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 20, height: 20, borderRadius: 4, background: 'transparent',
                        border: 'none', color: '#505050', cursor: 'pointer', transition: 'all 0.1s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#262626'; e.currentTarget.style.color = '#ef4444'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#505050'; }}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                );
              })()}
            </div>
          )}

          {!targetRes && (
            <div style={{
              minHeight: 72, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 6,
              color: isDragging ? '#a1a1aa' : '#525252',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {accept.includes('folder') && <div style={{ color: isDragging ? '#d4d4d4' : '#a1a1aa' }}><FolderIcon /></div>}
                {accept.includes('json') && <div style={{ color: isDragging ? '#6ee7b7' : '#34d399' }}><JsonIcon /></div>}
                {accept.includes('markdown') && <div style={{ color: isDragging ? '#93c5fd' : '#60a5fa' }}><MarkdownIcon /></div>}
              </div>
              <span style={{ fontSize: 12 }}>
                {isDragging ? 'Drop here' : `Drag ${TYPE_ARTICLE[primaryType]} into this`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ─── 3. Account + config fields ─── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: -2 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#666' }}>{providerLabel} account</span>
          {!isConnected && <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />}
        </div>

        {checking ? (
          <div style={{ textAlign: 'center', color: '#525252', fontSize: 12, padding: '8px 0' }}>
            Checking account...
          </div>
        ) : isConnected ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px', borderRadius: 6,
            background: 'transparent', border: '1px solid #2a2a2a',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#525252" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span style={{ fontSize: 11, color: '#666', fontWeight: 400 }}>
                {oauthStatus?.email || 'Signed in'}
              </span>
            </div>
            <button
              onClick={handleConnect}
              style={{ background: 'transparent', border: 'none', color: '#3a3a3a', fontSize: 10, cursor: 'pointer', padding: '2px 0' }}
              onMouseEnter={e => e.currentTarget.style.color = '#a3a3a3'}
              onMouseLeave={e => e.currentTarget.style.color = '#3a3a3a'}
            >
              Switch
            </button>
          </div>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', borderRadius: 8,
            background: '#161616', border: '1px solid #252525',
          }}>
            <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#a3a3a3' }}>Sign in to {providerLabel}</div>
              <div style={{ fontSize: 11, color: '#525252', marginTop: 2 }}>{description}</div>
            </div>
            <button
              onClick={handleConnect} disabled={connecting}
              style={{
                height: 28, padding: '0 12px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
                color: connecting ? '#525252' : '#e5e5e5', cursor: connecting ? 'not-allowed' : 'pointer',
                transition: 'all 0.12s', flexShrink: 0, whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { if (!connecting) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              {connecting ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        )}

        {error && <div style={{ fontSize: 11, color: '#ef4444', padding: '0 2px' }}>{error}</div>}

        {/* Config fields — only when account is connected */}
        {isConnected && configFields.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {configFields.map(field => (
              <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 12, color: '#525252', minWidth: 80, flexShrink: 0 }}>{field.label}</label>
                {field.type === 'select' && field.options && (
                  <select
                    id={`sync-cfg-${provider}-${field.key}`}
                    defaultValue={field.defaultValue}
                    style={{
                      flex: 1, height: 28, padding: '0 8px',
                      background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6,
                      color: '#e5e5e5', fontSize: 12, outline: 'none',
                      appearance: 'none',
                      backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1L5 5L9 1\' stroke=\'%23525252\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 8px center',
                      paddingRight: 24,
                    }}
                  >
                    {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {field.type === 'text' && (
                  <input
                    id={`sync-cfg-${provider}-${field.key}`}
                    type="text" placeholder={field.placeholder || field.label} defaultValue={field.defaultValue}
                    style={{
                      flex: 1, height: 28, padding: '0 8px',
                      background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6,
                      color: '#e5e5e5', fontSize: 12, outline: 'none',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── 4. Sync frequency ─── */}
      {isConnected && <SyncFrequencySelector provider={provider} />}
    </div>
  );
}

// ── Sync Frequency Selector ─────────────────────────────────────

const SYNC_MODE_OPTIONS = [
  { value: 'import_once' as const, label: 'Import once', desc: 'One-time import, no ongoing sync' },
  { value: 'manual' as const, label: 'Manual refresh', desc: 'Refresh data when you click the button' },
  { value: 'scheduled' as const, label: 'Scheduled', desc: 'Automatically sync on a schedule' },
] as const;

const DEFAULT_SYNC_MODES: Record<string, 'import_once' | 'manual' | 'scheduled'> = {
  gmail: 'import_once',
  notion: 'manual',
  github: 'import_once',
  google_drive: 'import_once',
  google_docs: 'manual',
  google_sheets: 'manual',
  google_calendar: 'scheduled',
  linear: 'manual',
  airtable: 'manual',
  url: 'import_once',
};

function SyncFrequencySelector({ provider }: { provider: string }) {
  const {
    draftSyncMode, setDraftSyncMode,
    draftTriggerConfig, setDraftTriggerConfig, setDraftTriggerType,
  } = useAgent();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setDraftSyncMode(DEFAULT_SYNC_MODES[provider] || 'import_once');
  }, [provider, setDraftSyncMode]);

  const selected = SYNC_MODE_OPTIONS.find(o => o.value === draftSyncMode) || SYNC_MODE_OPTIONS[0];

  const handleSelect = (mode: 'import_once' | 'manual' | 'scheduled') => {
    setDraftSyncMode(mode);
    setIsOpen(false);
    if (mode === 'scheduled') {
      setDraftTriggerType('cron');
      if (!draftTriggerConfig?.schedule) {
        setDraftTriggerConfig({ schedule: '0 9 * * *', timezone: 'Asia/Shanghai' });
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: '#666' }}>Sync frequency</label>
      </div>

      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            width: '100%', height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: '#161616', border: `1px solid ${isOpen ? '#525252' : '#2a2a2a'}`, borderRadius: 6,
            padding: '0 10px', color: '#e5e5e5', cursor: 'pointer', fontSize: 13, textAlign: 'left',
          }}
        >
          <span>{selected.label}</span>
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none"
            style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
            <path d="M1 1L5 5L9 1" stroke="#525252" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {isOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
            background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6,
            overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}>
            {SYNC_MODE_OPTIONS.map((opt, idx) => (
              <button
                key={opt.value}
                onClick={() => handleSelect(opt.value)}
                style={{
                  width: '100%', display: 'flex', flexDirection: 'column', gap: 1,
                  padding: '8px 10px', textAlign: 'left', cursor: 'pointer',
                  background: draftSyncMode === opt.value ? 'rgba(255,255,255,0.06)' : 'transparent',
                  border: 'none',
                  borderBottom: idx !== SYNC_MODE_OPTIONS.length - 1 ? '1px solid #1f1f1f' : 'none',
                }}
                onMouseEnter={e => { if (draftSyncMode !== opt.value) e.currentTarget.style.background = '#1f1f1f'; }}
                onMouseLeave={e => { e.currentTarget.style.background = draftSyncMode === opt.value ? 'rgba(255,255,255,0.06)' : 'transparent'; }}
              >
                <span style={{
                  fontSize: 13, fontWeight: draftSyncMode === opt.value ? 500 : 400,
                  color: draftSyncMode === opt.value ? '#e5e5e5' : '#a3a3a3',
                }}>{opt.label}</span>
                <span style={{ fontSize: 11, color: '#525252' }}>{opt.desc}</span>
              </button>
            ))}

            {/* Real-time placeholder */}
            <div style={{
              padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 1,
              borderTop: '1px solid #1f1f1f', opacity: 0.4, cursor: 'not-allowed',
            }}>
              <span style={{ fontSize: 13, color: '#525252' }}>Real-time ⚡</span>
              <span style={{ fontSize: 11, color: '#3a3a3a' }}>Coming soon</span>
            </div>
          </div>
        )}
      </div>

      {/* Schedule config — expand when Scheduled is selected */}
      {draftSyncMode === 'scheduled' && (
        <div style={{
          padding: '12px', marginTop: 4,
          background: '#141414', border: '1px solid #2a2a2a', borderRadius: 8,
        }}>
          <ScheduleTriggerSection
            draftTriggerConfig={draftTriggerConfig}
            setDraftTriggerConfig={setDraftTriggerConfig}
            setDraftTriggerType={setDraftTriggerType}
          />
        </div>
      )}

      {/* Mode description */}
      <div style={{ fontSize: 11, color: '#3a3a3a', padding: '0 2px', lineHeight: 1.5 }}>
        {draftSyncMode === 'import_once' && 'Data will be imported once. No sync binding will be created.'}
        {draftSyncMode === 'manual' && 'A sync binding will be created. Click "Refresh" anytime to pull the latest data.'}
        {draftSyncMode === 'scheduled' && 'Data will be automatically refreshed on the schedule above.'}
      </div>
    </div>
  );
}
