'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import type { AccessResource } from '@/contexts/AgentContext';
import { openOAuthPopup, type SaasType } from '@/lib/oauthApi';
import { SyncPreview, type AcceptedNodeType } from './SyncPreview';
import { ScheduleTriggerSection } from './ScheduleAgentConfig';
import { FolderIcon, JsonIcon, MarkdownIcon, CloseIcon, getNodeIcon } from '../_icons';
import { getSyncTriggerPolicy, SYNC_MODE_META, type SyncModeType } from '@/lib/syncTriggerPolicy';

export interface SaaSConfigField {
  key: string;
  label: string;
  type: 'select' | 'text' | 'number';
  placeholder?: string;
  options?: { value: string; label: string }[];
  defaultValue?: string;
  required?: boolean;
  hint?: string;
}

type SyncDirection = 'inbound' | 'outbound' | 'bidirectional';

export interface SaaSyncConfigProps {
  provider: string;
  providerLabel: string;
  oauthType?: SaasType;
  requiresAuth?: boolean;
  icon: React.ReactNode;
  description: string;
  configFields: SaaSConfigField[];
  accept: AcceptedNodeType[];
  direction: SyncDirection;
  configValues?: Record<string, string>;
  onConfigChange?: (key: string, value: string) => void;
}

type OAuthStatus = { connected: boolean; email?: string } | null;

const TYPE_ARTICLE: Record<AcceptedNodeType, string> = {
  folder: 'a folder', json: 'a JSON file', markdown: 'a Markdown file', file: 'a file',
};

export function SaaSyncConfig({
  provider, providerLabel, oauthType, requiresAuth = true, icon, description,
  configFields, accept, direction, configValues, onConfigChange,
}: SaaSyncConfigProps) {
  const { draftResources, addDraftResource, removeDraftResource } = useAgent();
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>(null);
  const [checking, setChecking] = useState(requiresAuth);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const primaryType = accept[0];
  const targetRes = draftResources[0] || null;
  const oauthUnsupported = requiresAuth && !oauthType;
  const isConnected = !requiresAuth || (!!oauthType && !!oauthStatus?.connected);

  // ── OAuth ──

  const checkStatus = useCallback(async () => {
    if (!requiresAuth || !oauthType) {
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      const { oauth } = await import('@/lib/oauthApi');
      const status = await oauth[oauthType].getStatus();
      setOauthStatus({
        connected: status.connected,
        email: status.email || status.workspace_name || status.username,
      });
    } catch {
      setOauthStatus({ connected: false });
    } finally {
      setChecking(false);
    }
  }, [oauthType, requiresAuth]);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const handleConnect = async () => {
    if (!oauthType) {
      setError('OAuth is not available for this connector yet.');
      return;
    }
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

      {/* ─── 2. Drag zone in styled callout bubble ─── */}
      <div style={{ position: 'relative', marginTop: 16 }}>
        {/* CSS Triangle pointing up to the Workspace logo */}
        <div style={{
          position: 'absolute',
          top: '-8px',
          left: 'calc(50% - 76px)', // Aligned to center of 72px left node in the new layout: 50% - (80/2 + 72/2) = 50% - 76
          width: '16px',
          height: '16px',
          background: '#18181b',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          transform: 'rotate(45deg)',
          zIndex: 3,
          marginLeft: '-8px'
        }} />

        <div style={{
          position: 'relative',
          background: '#18181b',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '8px',
          padding: '16px',
          zIndex: 2
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7', paddingLeft: 2 }}>Workspace Sync Target</label>
            <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
          </div>
          <div style={{ color: '#a1a1aa', fontSize: 13, marginBottom: 12, lineHeight: 1.4, paddingLeft: 2 }}>
            Drag and drop a folder or database here to set it as the destination for this connection.
          </div>

          <div
            style={{
              minHeight: 72,
              background: isDragging ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
              border: isDragging ? '1px dashed #71717a' : targetRes ? '1px solid rgba(255,255,255,0.15)' : '1px dashed rgba(255,255,255,0.15)',
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
                      <span style={{ fontSize: 12, color: '#e5e5e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
              color: isDragging ? '#a1a1aa' : '#71717a',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {accept.includes('folder') && <div style={{ color: isDragging ? '#d4d4d4' : '#a1a1aa' }}><FolderIcon /></div>}
                {accept.includes('json') && <div style={{ color: isDragging ? '#6ee7b7' : '#34d399' }}><JsonIcon /></div>}
                {accept.includes('markdown') && <div style={{ color: isDragging ? '#93c5fd' : '#60a5fa' }}><MarkdownIcon /></div>}
              </div>
              <span style={{ fontSize: 13 }}>
                {isDragging ? 'Drop here' : `Drag ${TYPE_ARTICLE[primaryType]} into this zone`}
              </span>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ─── 3. Account + config fields ─── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {requiresAuth && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: -2 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{providerLabel} account</span>
              {!oauthStatus?.connected && <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />}
            </div>

            {oauthUnsupported ? (
              <div style={{
                padding: '12px 14px', borderRadius: 8,
                background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
                color: '#fca5a5', fontSize: 12, lineHeight: 1.5,
              }}>
                OAuth is not available for this connector yet.
              </div>
            ) : checking ? (
              <div style={{ textAlign: 'center', color: '#a1a1aa', fontSize: 13, padding: '8px 0' }}>
                Checking account...
              </div>
            ) : oauthStatus?.connected ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: 6,
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span style={{ fontSize: 13, color: '#e4e4e7', fontWeight: 400 }}>
                    {oauthStatus?.email || 'Signed in'}
                  </span>
                </div>
                <button
                  onClick={handleConnect}
                  style={{ background: 'transparent', border: 'none', color: '#71717a', fontSize: 12, cursor: 'pointer', padding: '2px 0' }}
                  onMouseEnter={e => e.currentTarget.style.color = '#e4e4e7'}
                  onMouseLeave={e => e.currentTarget.style.color = '#71717a'}
                >
                  Switch
                </button>
              </div>
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 8,
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)',
              }}>
                <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>Sign in to {providerLabel}</div>
                  <div style={{ fontSize: 12, color: '#a1a1aa', marginTop: 2 }}>{description}</div>
                </div>
                <button
                  onClick={handleConnect} disabled={connecting}
                  style={{
                    height: 28, padding: '0 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
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

            {error && <div style={{ fontSize: 12, color: '#ef4444', padding: '0 2px' }}>{error}</div>}
          </>
        )}

        {/* Config fields — show when connected (or always for no-auth providers) */}
        {isConnected && configFields.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
            {configFields.map(field => {
              const isControlled = !!onConfigChange;
              const currentValue = isControlled ? (configValues?.[field.key] ?? '') : undefined;
              return (
                <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>{field.label}</label>
                    {field.required ? (
                      <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%', flexShrink: 0 }} title="Required" />
                    ) : !field.defaultValue ? (
                      <span style={{ fontSize: 11, color: '#52525b', fontWeight: 400 }}>optional</span>
                    ) : null}
                  </div>
                  {field.hint && (
                    <span style={{ fontSize: 12, color: '#71717a', marginTop: -2, lineHeight: 1.4 }}>{field.hint}</span>
                  )}
                  {field.type === 'select' && field.options ? (
                    <div style={{ position: 'relative' }}>
                      <select
                        id={`sync-cfg-${provider}-${field.key}`}
                        {...(isControlled ? { value: currentValue } : { defaultValue: field.defaultValue })}
                        onChange={e => onConfigChange?.(field.key, e.target.value)}
                        style={{
                          width: '100%', height: 36, padding: '0 12px', fontSize: 13,
                          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 6, color: '#e4e4e7', outline: 'none', appearance: 'none',
                          cursor: 'pointer', transition: 'border-color 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                      >
                        <option value="">Select...</option>
                        {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ position: 'absolute', right: 12, top: 15, pointerEvents: 'none' }}>
                        <path d="M1 1L5 5L9 1" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  ) : (
                    <input
                      id={`sync-cfg-${provider}-${field.key}`}
                      type={field.type === 'number' ? 'number' : 'text'}
                      placeholder={field.placeholder || field.label}
                      {...(isControlled ? { value: currentValue } : { defaultValue: field.defaultValue })}
                      onChange={e => onConfigChange?.(field.key, e.target.value)}
                      style={{
                        width: '100%', height: 36, padding: '0 12px', fontSize: 13,
                        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 6, color: '#e4e4e7', outline: 'none',
                        transition: 'border-color 0.2s',
                      }}
                      onFocus={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'}
                      onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                      onMouseEnter={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' }}
                      onMouseLeave={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── 4. Sync frequency ─── */}
      {isConnected && <SyncFrequencySelector provider={provider} />}
    </div>
  );
}

// ── Sync Frequency Selector ─────────────────────────────────────

const SELECTABLE_SYNC_MODES: SyncModeType[] = ['import_once', 'manual', 'scheduled', 'realtime'];

function SyncFrequencySelector({ provider }: { provider: string }) {
  const {
    draftSyncMode, setDraftSyncMode,
    draftTriggerConfig, setDraftTriggerConfig, setDraftTriggerType,
  } = useAgent();
  const [isOpen, setIsOpen] = useState(false);
  const policy = getSyncTriggerPolicy(provider);
  const options = SELECTABLE_SYNC_MODES
    .filter(mode => policy.supportedModes.includes(mode))
    .map(mode => ({ value: mode, label: SYNC_MODE_META[mode].label, desc: SYNC_MODE_META[mode].desc }));

  useEffect(() => {
    const preferred = policy.defaultMode;
    const normalized = preferred === 'realtime' ? 'manual' : preferred;
    setDraftSyncMode(normalized as 'import_once' | 'manual' | 'scheduled');
  }, [policy.defaultMode, setDraftSyncMode]);

  const selected = options.find(o => o.value === draftSyncMode)
    || options[0]
    || { value: 'manual' as const, label: SYNC_MODE_META.manual.label, desc: SYNC_MODE_META.manual.desc };

  const handleSelect = (mode: 'import_once' | 'manual' | 'scheduled' | 'realtime') => {
    if (mode === 'realtime') return;
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>Sync frequency</label>
        <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%', flexShrink: 0 }} title="Required" />
      </div>

      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            width: '100%', height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'rgba(255,255,255,0.02)', border: `1px solid ${isOpen ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 6,
            padding: '0 12px', color: '#e4e4e7', cursor: 'pointer', fontSize: 13, textAlign: 'left',
            transition: 'border-color 0.2s',
          }}
        >
          <span>{selected.label}</span>
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none"
            style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
            <path d="M1 1L5 5L9 1" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {isOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
            background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
            overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
          }}>
            {options.map((opt, idx) => (
              <button
                key={opt.value}
                onClick={() => handleSelect(opt.value)}
                style={{
                  width: '100%', display: 'flex', flexDirection: 'column', gap: 2,
                  padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                  background: draftSyncMode === opt.value ? 'rgba(255,255,255,0.06)' : 'transparent',
                  border: 'none',
                  borderBottom: idx !== options.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (draftSyncMode !== opt.value) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = draftSyncMode === opt.value ? 'rgba(255,255,255,0.06)' : 'transparent'; }}
              >
                <span style={{
                  fontSize: 13, fontWeight: 500,
                  color: draftSyncMode === opt.value ? '#e4e4e7' : '#a1a1aa',
                }}>{opt.label}</span>
                <span style={{ fontSize: 12, color: '#71717a' }}>{opt.desc}</span>
              </button>
            ))}

          </div>
        )}
      </div>

      {/* Schedule config — expand when Scheduled is selected */}
      {draftSyncMode === 'scheduled' && (
        <div style={{
          padding: '12px', marginTop: 4,
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
        }}>
          <ScheduleTriggerSection
            draftTriggerConfig={draftTriggerConfig}
            setDraftTriggerConfig={setDraftTriggerConfig}
            setDraftTriggerType={setDraftTriggerType}
          />
        </div>
      )}

      {/* Mode description */}
      <div style={{ fontSize: 12, color: '#a1a1aa', padding: '0 2px', lineHeight: 1.5 }}>
        {draftSyncMode === 'import_once' && 'A sync binding will be created and imported once. To refresh later, change the mode to Manual or Scheduled.'}
        {draftSyncMode === 'manual' && 'A sync binding will be created. Click "Refresh" anytime to pull the latest data.'}
        {draftSyncMode === 'scheduled' && 'Data will be automatically refreshed on the schedule above.'}
      </div>
    </div>
  );
}
