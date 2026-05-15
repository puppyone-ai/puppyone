'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import type { AccessResource } from '@/contexts/AgentContext';
import { openOAuthPopup, type SaasType } from '@/lib/oauthApi';
import { isWithinScope } from '@/lib/repoApi';
import { SyncPreview, type AcceptedNodeType } from './SyncPreview';
import { ScheduleTriggerSection } from './ScheduleAgentConfig';
import { ActivityIconButton } from '@/components/ActivityIconButton';
import { FolderIcon, JsonIcon, MarkdownIcon, getNodeIcon } from '../_icons';
import { getSyncTriggerPolicy, SYNC_MODE_META, type SyncModeType } from '@/lib/syncTriggerPolicy';
import { useConnectorSpecs } from '@/lib/hooks/useData';
import { Dots } from '@/components/loading';

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
  /** Canonical scope path. When set, drop targets reject folders outside
   *  the scope — see `isWithinScope`. Pass `undefined` to disable. */
  scopeBoundary?: string;
  scopeBoundaryLabel?: string;
}

type OAuthStatus = { connected: boolean; email?: string } | null;

const TYPE_ARTICLE: Record<AcceptedNodeType, string> = {
  folder: 'a folder', json: 'a JSON file', markdown: 'a Markdown file', file: 'a file',
};

export function SaaSyncConfig({
  provider, providerLabel, oauthType, requiresAuth = true, icon, description,
  configFields, accept, direction, configValues, onConfigChange,
  scopeBoundary, scopeBoundaryLabel,
}: SaaSyncConfigProps) {
  const { draftResources, addDraftResource, removeDraftResource } = useAgent();
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>(null);
  const [checking, setChecking] = useState(requiresAuth);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

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
      const nodePath: string = node.nodeId || node.id;
      // Scope-aware guard: when this config is opened from a scope
      // context, only nodes inside that scope's boundary can be the
      // sync target. Out-of-scope drops surface an inline error.
      if (scopeBoundary !== undefined && !isWithinScope(nodePath, scopeBoundary)) {
        const boundary = scopeBoundaryLabel || (scopeBoundary === '' ? 'root' : `/${scopeBoundary}`);
        setDropError(
          `${node.name || nodePath} is outside this scope (${boundary}). Configure integrations for it from its own scope.`,
        );
        setTimeout(() => setDropError(null), 5000);
        return;
      }
      setDropError(null);
      addDraftResource({ path: nodePath, nodeName: node.name, nodeType, readonly: true } as AccessResource);
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
        {/* CSS Triangle pointing up to the Workspace logo (right side) */}
        <div style={{
          position: 'absolute',
          top: '-8px',
          left: 'calc(50% + 68px)',
          width: '16px',
          height: '16px',
          background: 'var(--po-hover)',
          borderLeft: '1px solid var(--po-border)',
          borderTop: '1px solid var(--po-border)',
          transform: 'rotate(45deg)',
          zIndex: 3,
        }} />

        <div style={{
          position: 'relative',
          background: 'var(--po-hover)',
          border: '1px solid var(--po-border)',
          borderRadius: '8px',
          padding: '16px',
          zIndex: 2
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--po-text)', paddingLeft: 2 }}>Workspace Sync Target</label>
            <span style={{ width: 5, height: 5, background: 'var(--po-danger)', borderRadius: '50%' }} title="Required" />
          </div>
          <div style={{ color: 'var(--po-text-muted)', fontSize: 13, marginBottom: 12, lineHeight: 1.4, paddingLeft: 2 }}>
            Drag and drop a folder or database here to set it as the destination for this integration.
          </div>

          {scopeBoundary !== undefined && (
            <div style={{ fontSize: 11, color: 'var(--po-text-subtle)', paddingLeft: 2, marginBottom: 8, lineHeight: 1.5 }}>
              Only nodes inside{' '}
              <code style={{ color: 'var(--po-text-muted)' }}>
                {scopeBoundary === '' ? '/ (root)' : `/${scopeBoundary}`}
              </code>{' '}
              can be attached.
            </div>
          )}

          {dropError && (
            <div
              style={{
                fontSize: 12, color: 'var(--po-danger)',
                background: 'color-mix(in srgb, var(--po-danger) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--po-danger) 25%, transparent)',
                borderRadius: 6, padding: '6px 10px',
                marginBottom: 8, lineHeight: 1.5,
              }}
              role="alert"
            >
              {dropError}
            </div>
          )}

          <div
            style={{
              minHeight: 72,
              background: isDragging ? 'var(--po-hover)' : 'var(--po-panel)',
              border: isDragging ? '1px dashed var(--po-text-subtle)' : targetRes ? '1px solid var(--po-border-strong)' : '1px dashed var(--po-border-strong)',
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
                      padding: '0 10px', borderRadius: 4, background: 'var(--po-panel-raised)', border: '1px solid var(--po-border-strong)', transition: 'all 0.1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--po-hover)'; e.currentTarget.style.borderColor = 'var(--po-border-strong)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--po-panel-raised)'; e.currentTarget.style.borderColor = 'var(--po-border-strong)'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1, minWidth: 0 }}>
                      <div style={{ color, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{nodeIcon}</div>
                      <span style={{ fontSize: 12, color: 'var(--po-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {targetRes.nodeName}
                      </span>
                    </div>
                    <ActivityIconButton
                      kind="close"
                      title="Remove resource"
                      size="sm"
                      onClick={() => removeDraftResource(targetRes.path)}
                    />
                  </div>
                );
              })()}
            </div>
          )}

          {!targetRes && (
            <div style={{
              minHeight: 72, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 6,
              color: isDragging ? 'var(--po-text-muted)' : 'var(--po-text-subtle)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {accept.includes('folder') && <div style={{ color: isDragging ? 'var(--po-text)' : 'var(--po-text-muted)' }}><FolderIcon /></div>}
                {accept.includes('json') && <div style={{ color: isDragging ? 'var(--po-success)' : 'var(--po-success)' }}><JsonIcon /></div>}
                {accept.includes('markdown') && <div style={{ color: isDragging ? 'var(--po-accent-text)' : 'var(--po-accent)' }}><MarkdownIcon /></div>}
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
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--po-text)' }}>{providerLabel} account</span>
              {!oauthStatus?.connected && <span style={{ width: 5, height: 5, background: 'var(--po-danger)', borderRadius: '50%' }} title="Required" />}
            </div>

            {oauthUnsupported ? (
              <div style={{
                padding: '12px 14px', borderRadius: 8,
                background: 'color-mix(in srgb, var(--po-danger) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--po-danger) 20%, transparent)',
                color: 'var(--po-danger)', fontSize: 12, lineHeight: 1.5,
              }}>
                OAuth is not available for this connector yet.
              </div>
            ) : checking ? (
              <div style={{ textAlign: 'center', color: 'var(--po-text-muted)', fontSize: 13, padding: '8px 0' }}>
                Checking account...
              </div>
            ) : oauthStatus?.connected ? (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: 6,
                background: 'var(--po-panel)', border: '1px solid var(--po-border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--po-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span style={{ fontSize: 13, color: 'var(--po-text)', fontWeight: 400 }}>
                    {oauthStatus?.email || 'Signed in'}
                  </span>
                </div>
                <button
                  onClick={handleConnect}
                  style={{ background: 'transparent', border: 'none', color: 'var(--po-text-subtle)', fontSize: 12, cursor: 'pointer', padding: '2px 0' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--po-text)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--po-text-subtle)'}
                >
                  Switch
                </button>
              </div>
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 8,
                background: 'var(--po-panel)', border: '1px solid var(--po-border)',
              }}>
                <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--po-text)' }}>Sign in to {providerLabel}</div>
                  <div style={{ fontSize: 12, color: 'var(--po-text-muted)', marginTop: 2 }}>{description}</div>
                </div>
                <button
                  onClick={handleConnect} disabled={connecting}
                  style={{
                    height: 28, padding: '0 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                    background: 'transparent', border: '1px solid var(--po-border-strong)',
                    color: connecting ? 'var(--po-text-disabled)' : 'var(--po-text)', cursor: connecting ? 'not-allowed' : 'pointer',
                    transition: 'all 0.12s', flexShrink: 0, whiteSpace: 'nowrap',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                  onMouseEnter={e => { if (!connecting) e.currentTarget.style.background = 'var(--po-hover)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {connecting && <Dots size='xs' />}
                  {connecting ? 'Signing in…' : 'Sign in'}
                </button>
              </div>
            )}

            {error && <div style={{ fontSize: 12, color: 'var(--po-danger)', padding: '0 2px' }}>{error}</div>}
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
                    <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--po-text)' }}>{field.label}</label>
                    {field.required ? (
                      <span style={{ width: 5, height: 5, background: 'var(--po-danger)', borderRadius: '50%', flexShrink: 0 }} title="Required" />
                    ) : !field.defaultValue ? (
                      <span style={{ fontSize: 11, color: 'var(--po-text-disabled)', fontWeight: 400 }}>optional</span>
                    ) : null}
                  </div>
                  {field.hint && (
                    <span style={{ fontSize: 12, color: 'var(--po-text-subtle)', marginTop: -2, lineHeight: 1.4 }}>{field.hint}</span>
                  )}
                  {field.type === 'select' && field.options ? (
                    <div style={{ position: 'relative' }}>
                      <select
                        id={`sync-cfg-${provider}-${field.key}`}
                        {...(isControlled ? { value: currentValue } : { defaultValue: field.defaultValue })}
                        onChange={e => onConfigChange?.(field.key, e.target.value)}
                        style={{
                          width: '100%', height: 36, padding: '0 12px', fontSize: 13,
                          background: 'var(--po-panel)', border: '1px solid var(--po-border)',
                          borderRadius: 6, color: 'var(--po-text)', outline: 'none', appearance: 'none',
                          cursor: 'pointer', transition: 'border-color 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--po-text) 22%, transparent)'}
                        onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--po-border)'}
                      >
                        <option value="">Select...</option>
                        {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ position: 'absolute', right: 12, top: 15, pointerEvents: 'none' }}>
                        <path d="M1 1L5 5L9 1" stroke="var(--po-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
                        background: 'var(--po-panel)', border: '1px solid var(--po-border)',
                        borderRadius: 6, color: 'var(--po-text)', outline: 'none',
                        transition: 'border-color 0.2s',
                      }}
                      onFocus={e => e.currentTarget.style.borderColor = 'var(--po-focus-ring)'}
                      onBlur={e => e.currentTarget.style.borderColor = 'var(--po-border)'}
                      onMouseEnter={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--po-text) 22%, transparent)' }}
                      onMouseLeave={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = 'var(--po-border)' }}
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
  const { specs } = useConnectorSpecs();
  const policy = getSyncTriggerPolicy(provider, specs);
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
        <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--po-text)' }}>Sync frequency</label>
        <span style={{ width: 5, height: 5, background: 'var(--po-danger)', borderRadius: '50%', flexShrink: 0 }} title="Required" />
      </div>

      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          style={{
            width: '100%', height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'var(--po-panel)', border: `1px solid ${isOpen ? 'color-mix(in srgb, var(--po-text) 22%, transparent)' : 'var(--po-border)'}`, borderRadius: 6,
            padding: '0 12px', color: 'var(--po-text)', cursor: 'pointer', fontSize: 13, textAlign: 'left',
            transition: 'border-color 0.2s',
          }}
        >
          <span>{selected.label}</span>
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none"
            style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
            <path d="M1 1L5 5L9 1" stroke="var(--po-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {isOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
            background: 'var(--po-panel-raised)', border: '1px solid var(--po-active)', borderRadius: 6,
            overflow: 'hidden', boxShadow: '0 4px 16px var(--po-shadow)',
          }}>
            {options.map((opt, idx) => (
              <button
                key={opt.value}
                onClick={() => handleSelect(opt.value)}
                style={{
                  width: '100%', display: 'flex', flexDirection: 'column', gap: 2,
                  padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                  background: draftSyncMode === opt.value ? 'var(--po-border-subtle)' : 'transparent',
                  border: 'none',
                  borderBottom: idx !== options.length - 1 ? '1px solid var(--po-hover)' : 'none',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { if (draftSyncMode !== opt.value) e.currentTarget.style.background = 'var(--po-hover)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = draftSyncMode === opt.value ? 'var(--po-border-subtle)' : 'transparent'; }}
              >
                <span style={{
                  fontSize: 13, fontWeight: 500,
                  color: draftSyncMode === opt.value ? 'var(--po-text)' : 'var(--po-text-muted)',
                }}>{opt.label}</span>
                <span style={{ fontSize: 12, color: 'var(--po-text-subtle)' }}>{opt.desc}</span>
              </button>
            ))}

          </div>
        )}
      </div>

      {/* Schedule config — expand when Scheduled is selected */}
      {draftSyncMode === 'scheduled' && (
        <div style={{
          padding: '12px', marginTop: 4,
          background: 'var(--po-panel)', border: '1px solid var(--po-border)', borderRadius: 8,
        }}>
          <ScheduleTriggerSection
            draftTriggerConfig={draftTriggerConfig}
            setDraftTriggerConfig={setDraftTriggerConfig}
            setDraftTriggerType={setDraftTriggerType}
          />
        </div>
      )}

      {/* Mode description */}
      <div style={{ fontSize: 12, color: 'var(--po-text-muted)', padding: '0 2px', lineHeight: 1.5 }}>
        {draftSyncMode === 'import_once' && 'A sync binding will be created and imported once. To refresh later, change the mode to Manual or Scheduled.'}
        {draftSyncMode === 'manual' && 'A sync binding will be created. Click "Refresh" anytime to pull the latest data.'}
        {draftSyncMode === 'scheduled' && 'Data will be automatically refreshed on the schedule above.'}
      </div>
    </div>
  );
}
