'use client';

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { get } from '@/lib/apiClient';
import type { SavedAgent } from '@/components/AgentRail';
import { ActivityIconButton } from '@/components/ActivityIconButton';

interface FilesystemSetupViewProps {
  agent: SavedAgent;
  projectId?: number | string;
  onEdit: () => void;
  onDelete: () => void;
}

const CopyIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
);

const CheckIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const SettingsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

const ArrowRightIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="5" y1="12" x2="19" y2="12"></line>
    <polyline points="12 5 19 12 12 19"></polyline>
  </svg>
);

// ============================================================
// Setup Dialog
// ============================================================

export function SetupDialog({
  open,
  onClose,
  accessKey,
  apiUrl,
}: {
  open: boolean;
  onClose: () => void;
  accessKey: string;
  apiUrl: string;
}) {
  const DEFAULT_PATH = '~/.openclaw/workspace';
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [workspacePath, setWorkspacePath] = useState('');
  const pathIsPlaceholder = !workspacePath || workspacePath === DEFAULT_PATH;

  const handleCopy = useCallback(async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pathDisplay = pathIsPlaceholder ? '<your-folder-path>' : workspacePath;
  const upCmd = `puppyone openclaw up ${pathDisplay} --key ${accessKey} -u ${apiUrl}`;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      {/* Backdrop */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'var(--po-backdrop)', backdropFilter: 'blur(4px)',
      }} />

      {/* Panel */}
      <div
        style={{
          position: 'relative', width: 520, maxHeight: '80vh',
          background: 'var(--po-panel)', border: '1px solid var(--po-border)', borderRadius: 12,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Dialog header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--po-hover)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--po-text)' }}>
              Connect Machine Folder
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--po-text-disabled)' }}>
              Run these commands to sync a local folder with PuppyOne.
            </p>
          </div>
          <ActivityIconButton kind="close" title="Close" onClick={onClose} />
        </div>

        {/* Dialog body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <StepBlock
              step="1"
              label="Install PuppyOne CLI"
              command="npm install -g puppyone"
              copiedField={copiedField}
              onCopy={handleCopy}
              fieldKey="d-install"
            />

            {/* Step 2: Choose workspace path */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'var(--po-panel-raised)', border: '1px solid var(--po-border-strong)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: 'var(--po-text-subtle)', fontWeight: 600, flexShrink: 0,
                }}>
                  2
                </span>
                <span style={{ fontSize: 12, color: 'var(--po-text-muted)', fontWeight: 500 }}>Choose a local folder</span>
              </div>
              <div style={{ marginLeft: 28 }}>
                <p style={{ fontSize: 12, color: 'var(--po-text-muted)', margin: '0 0 12px', lineHeight: 1.7 }}>
                  Enter the absolute path to a local folder you want to sync.
                  The folder will be created automatically if it doesn't exist.
                </p>
                <input
                  type="text"
                  value={workspacePath}
                  onChange={e => setWorkspacePath(e.target.value)}
                  placeholder="e.g. ~/my-project or /Users/you/Documents/sync"
                  spellCheck={false}
                  style={{
                    width: '100%', boxSizing: 'border-box' as const,
                    fontSize: 12, color: 'var(--po-text)',
                    background: 'transparent',
                    border: 'none', borderBottom: '1px solid var(--po-border-strong)',
                    padding: '6px 0', outline: 'none',
                    fontFamily: 'inherit',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = 'var(--po-warning)'}
                  onBlur={e => e.currentTarget.style.borderColor = 'var(--po-border-strong)'}
                />
              </div>
            </div>

            {/* Step 3: Run command */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'var(--po-panel-raised)', border: '1px solid var(--po-border-strong)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: 'var(--po-text-subtle)', fontWeight: 600, flexShrink: 0,
                }}>
                  3
                </span>
                <span style={{ fontSize: 12, color: 'var(--po-text-muted)', fontWeight: 500 }}>Run in terminal</span>
              </div>
              {pathIsPlaceholder && (
                <p style={{ fontSize: 11, color: 'var(--po-warning)', margin: '0 0 6px 28px', lineHeight: 1.5 }}>
                  ↑ Fill in a folder path in Step 2 first.
                </p>
              )}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--po-inset)',
                border: `1px solid ${pathIsPlaceholder ? 'color-mix(in srgb, var(--po-warning) 30%, transparent)' : 'var(--po-border)'}`,
                borderRadius: 6, padding: '8px 12px', marginLeft: 28,
                opacity: pathIsPlaceholder ? 0.6 : 1,
                transition: 'opacity 0.15s, border-color 0.15s',
              }}>
                <code style={{
                  flex: 1, fontSize: 12, color: 'var(--po-text-muted)',
                  fontFamily: 'var(--po-font-sans)', wordBreak: 'break-all', lineHeight: 1.5,
                }}>
                  {upCmd}
                </code>
                <button
                  onClick={() => !pathIsPlaceholder && handleCopy(upCmd, 'd-up')}
                  disabled={pathIsPlaceholder}
                  title={pathIsPlaceholder ? 'Enter a folder path in Step 2 first' : 'Copy command'}
                  style={{
                    background: 'transparent', border: 'none',
                    cursor: pathIsPlaceholder ? 'not-allowed' : 'pointer',
                    color: copiedField === 'd-up' ? 'var(--po-success)' : 'var(--po-text-disabled)',
                    padding: 4, borderRadius: 4, display: 'flex',
                    alignItems: 'center', flexShrink: 0,
                  }}
                >
                  {copiedField === 'd-up' ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            </div>
          </div>

          {/* Footer hint */}
          <p style={{ fontSize: 11, color: 'var(--po-border-strong)', marginTop: 20, lineHeight: 1.5, textAlign: 'center' }}>
            The sync daemon runs in the background — you can close the terminal.
          </p>
        </div>
      </div>
    </div>
  );
}

export function FilesystemSetupView({ agent, projectId, onEdit, onDelete }: FilesystemSetupViewProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    connected: boolean;
    workspace_path?: string;
    last_seen_at?: string;
  }>({ connected: false });

  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const [refreshing, setRefreshing] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const resp = await get<{ connected: boolean; workspace_path?: string; last_seen_at?: string }>(`/api/v1/filesystem/${agent.id}/access-status`);
      if (resp) setConnectionStatus(resp);
    } catch {
      // Status polling is best-effort.
    }
  }, [agent.id]);

  useEffect(() => {
    checkStatus();
    const POLL_INTERVAL = 60_000;
    pollRef.current = setInterval(checkStatus, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [checkStatus]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await checkStatus();
    setTimeout(() => setRefreshing(false), 600);
  }, [checkStatus]);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090';
  const accessKey = agent.mcp_api_key || '<access-key>';
  const maskedKey = accessKey.length > 12
    ? `${accessKey.slice(0, 8)}...${accessKey.slice(-4)}`
    : accessKey;

  const handleCopy = useCallback(async (text: string, field: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  const resources = agent.resources ?? [];
  const isConnected = connectionStatus.connected;
  const hasEverConnected = !!connectionStatus.last_seen_at;

  const statusLabel = isConnected
    ? 'Sync active'
    : hasEverConnected
      ? 'Daemon offline'
      : 'Waiting for CLI';
  const statusColor = isConnected ? 'var(--po-success)' : hasEverConnected ? 'var(--po-danger)' : 'var(--po-warning)';
  const statusTextColor = isConnected ? 'var(--po-text)' : hasEverConnected ? 'var(--po-danger)' : 'var(--po-text-muted)';

  const lastSeenText = useMemo(() => {
    if (!connectionStatus.last_seen_at) return null;
    const ms = Date.now() - new Date(connectionStatus.last_seen_at).getTime();
    if (ms < 0) return 'just now';
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  }, [connectionStatus.last_seen_at]);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{
          height: 48,
          padding: '0 16px',
          borderBottom: '1px solid var(--po-hover)',
          background: 'var(--po-panel)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--po-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="2" /><line x1="2" y1="7" x2="22" y2="7" /><polyline points="8 13 11 16 8 19" /><line x1="14" y1="19" x2="18" y2="19" /></svg>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--po-text)' }}>
              {agent.name}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={onEdit}
              title="Edit settings"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--po-text-subtle)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 6, borderRadius: 4,
                transition: 'color 0.15s'
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--po-text)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--po-text-subtle)'}
            >
              <SettingsIcon />
            </button>
            <button
              onClick={onDelete}
              title="Delete"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--po-text-subtle)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 6, borderRadius: 4,
                transition: 'color 0.15s'
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--po-danger)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--po-text-subtle)'}
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* Sync visualization */}
          <div style={{
            borderRadius: 10, padding: '28px 24px 20px',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {/* Icons + connection */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {/* Machine Folder (LEFT) */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 80 }}>
                <img src="/icons/folder.svg" alt="Folder" width={36} height={36} style={{ display: 'block' }} />
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--po-text-muted)', textAlign: 'center' }}>Machine Folder</div>
                <div style={{
                  fontSize: 10, color: 'var(--po-text-disabled)', fontFamily: 'var(--po-font-sans)', textAlign: 'center',
                  wordBreak: 'break-all', lineHeight: 1.3, maxWidth: 80,
                }} title={connectionStatus.workspace_path}>
                  {isConnected && connectionStatus.workspace_path
                    ? connectionStatus.workspace_path.replace(/^\/Users\/[^/]+/, '~')
                    : '~/...'}
                </div>
              </div>

              {/* Connection arrows */}
              {(() => {
                if (!isConnected && !hasEverConnected) {
                  return (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 4px' }}>
                      <div style={{
                        fontSize: 9, color: 'var(--po-text-disabled)', fontWeight: 500, letterSpacing: '0.3px',
                        borderTop: '1px dashed var(--po-border-strong)', width: '100%', textAlign: 'center',
                        position: 'relative',
                      }}>
                        <span style={{
                          position: 'relative', top: -7, background: 'var(--po-canvas)',
                          padding: '0 6px', whiteSpace: 'nowrap',
                        }}>Waiting for CLI</span>
                      </div>
                    </div>
                  );
                }
                if (!isConnected && hasEverConnected) {
                  return (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 4px' }}>
                      <div style={{
                        fontSize: 9, color: 'var(--po-danger)', fontWeight: 500, letterSpacing: '0.3px',
                        borderTop: '1px dashed color-mix(in srgb, var(--po-danger) 30%, transparent)', width: '100%', textAlign: 'center',
                        position: 'relative',
                      }}>
                        <span style={{
                          position: 'relative', top: -7, background: 'var(--po-canvas)',
                          padding: '0 6px', whiteSpace: 'nowrap',
                        }}>Disconnected</span>
                      </div>
                    </div>
                  );
                }
                return (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 4px' }}>
                    <svg width="48" height="16" viewBox="0 0 48 16" fill="none" stroke="var(--po-success)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 5h44M6 2L2 5l4 3" />
                      <path d="M42 8l4 3-4 3M2 11h44" />
                    </svg>
                  </div>
                );
              })()}

              {/* PuppyOne (RIGHT) */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 80 }}>
                <img src="/icons/folder.svg" alt="Folder" width={36} height={36} style={{ display: 'block' }} />
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--po-text-muted)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>
                  {resources.length > 0 ? resources[0].nodeName : agent.name}
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
              {lastSeenText && (
                <span style={{ fontSize: 11, color: 'var(--po-text-disabled)' }}>· {lastSeenText}</span>
              )}
              <button
                onClick={handleRefresh}
                title="Refresh"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--po-text-disabled)', padding: 2, borderRadius: 4, display: 'flex',
                  marginLeft: 'auto', transition: 'color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--po-text-muted)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--po-text-disabled)'}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ animation: refreshing ? 'spin 0.6s linear' : 'none' }}
                >
                  <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
              <button
                onClick={() => setShowSetup(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  height: 28, padding: '0 12px', borderRadius: 6,
                  background: 'var(--po-text)', border: 'none',
                  fontSize: 12, fontWeight: 500, color: 'var(--po-text-inverse)',
                  cursor: 'pointer', transition: 'opacity 0.12s',
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                {isConnected ? 'Manage' : 'Connect'}
                <ArrowRightIcon />
              </button>
            </div>
          </div>

          {/* Access Key Section */}
          <div style={{ padding: '0 4px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--po-text-subtle)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.5px' }}>
              Credentials
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 0', borderBottom: '1px solid var(--po-hover)',
            }}>
              <div style={{ fontSize: 11, color: 'var(--po-text-disabled)', fontWeight: 500, width: 72 }}>Access Key</div>
              <code style={{
                flex: 1, fontSize: 12, color: 'var(--po-text-muted)', fontFamily: 'var(--po-font-sans)',
                background: 'transparent', border: 'none'
              }}>
                {maskedKey}
              </code>
              <button
                onClick={() => handleCopy(accessKey, 'key')}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: copiedField === 'key' ? 'var(--po-success)' : 'var(--po-text-disabled)',
                  padding: 4, display: 'flex', alignItems: 'center',
                }}
              >
                {copiedField === 'key' ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Setup dialog (portal-like, renders at top level) */}
      <SetupDialog
        open={showSetup}
        onClose={() => setShowSetup(false)}
        accessKey={accessKey}
        apiUrl={apiUrl}
      />
    </>
  );
}

// ============================================================
// Shared step block component
// ============================================================

function StepBlock({
  step, label, hint, command, copiedField, onCopy, fieldKey,
}: {
  step: string;
  label: string;
  hint?: string;
  command: string;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
  fieldKey: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{
          width: 20, height: 20, borderRadius: '50%',
          background: 'var(--po-panel-raised)', border: '1px solid var(--po-border-strong)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: 'var(--po-text-subtle)', fontWeight: 600, flexShrink: 0,
        }}>
          {step}
        </span>
        <span style={{ fontSize: 12, color: 'var(--po-text-muted)', fontWeight: 500 }}>{label}</span>
      </div>
      {hint && (
        <p style={{ fontSize: 11, color: 'var(--po-text-disabled)', margin: '0 0 6px 28px' }}>{hint}</p>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--po-inset)', border: '1px solid var(--po-border)',
        borderRadius: 6, padding: '8px 12px', marginLeft: 28,
      }}>
        <code style={{
          flex: 1, fontSize: 12, color: 'var(--po-text-muted)',
          fontFamily: 'var(--po-font-sans)', wordBreak: 'break-all', lineHeight: 1.5,
        }}>
          {command}
        </code>
        <button
          onClick={() => onCopy(command, fieldKey)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: copiedField === fieldKey ? 'var(--po-success)' : 'var(--po-text-disabled)',
            padding: 4, borderRadius: 4, display: 'flex',
            alignItems: 'center', flexShrink: 0,
          }}
        >
          {copiedField === fieldKey ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
    </div>
  );
}
