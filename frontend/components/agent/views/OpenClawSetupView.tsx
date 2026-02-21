'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { get } from '@/lib/apiClient';
import type { SavedAgent } from '@/components/AgentRail';

interface OpenClawSetupViewProps {
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

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
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
  const [copiedField, setCopiedField] = useState<string | null>(null);

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

  const connectCmd = `puppyone connect --key ${accessKey} ~/openclaw-workspace -u ${apiUrl}`;
  const pullCmd = `puppyone pull --key ${accessKey}`;
  const watchCmd = `puppyone watch --key ${accessKey}`;

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
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      }} />

      {/* Panel */}
      <div
        style={{
          position: 'relative', width: 520, maxHeight: '80vh',
          background: '#111', border: '1px solid #2a2a2a', borderRadius: 12,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Dialog header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #222',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#e5e5e5' }}>
              Connect OpenClaw
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#525252' }}>
              Run these commands on the machine where OpenClaw is running.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: '#525252', padding: 4, borderRadius: 4, display: 'flex',
            }}
          >
            <CloseIcon />
          </button>
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

            <StepBlock
              step="2"
              label="Connect workspace to this access point"
              hint="Replace ~/openclaw-workspace with your actual path"
              command={connectCmd}
              copiedField={copiedField}
              onCopy={handleCopy}
              fieldKey="d-connect"
            />

            <StepBlock
              step="3"
              label="Pull latest data"
              command={pullCmd}
              copiedField={copiedField}
              onCopy={handleCopy}
              fieldKey="d-pull"
            />

            <StepBlock
              step="4"
              label="Start watching for changes"
              hint="Keep this running in background"
              command={watchCmd}
              copiedField={copiedField}
              onCopy={handleCopy}
              fieldKey="d-watch"
            />
          </div>

          {/* OpenClaw config hint */}
          <div style={{ marginTop: 24 }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: '#525252',
              textTransform: 'uppercase' as const, letterSpacing: '0.5px',
              marginBottom: 8,
            }}>
              OpenClaw Config (optional)
            </div>
            <div style={{
              background: '#0a0a0a', border: '1px solid #2a2a2a',
              borderRadius: 6, padding: '10px 12px', position: 'relative',
            }}>
              <pre style={{
                fontSize: 12, color: '#a3a3a3', fontFamily: 'monospace',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, lineHeight: 1.6,
              }}>
                {JSON.stringify({
                  agents: { defaults: { workspace: '~/openclaw-workspace' } },
                }, null, 2)}
              </pre>
              <button
                onClick={() => handleCopy(JSON.stringify({
                  agents: { defaults: { workspace: '~/openclaw-workspace' } },
                }, null, 2), 'd-occonfig')}
                style={{
                  position: 'absolute', top: 6, right: 6,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center',
                  color: copiedField === 'd-occonfig' ? '#4ade80' : '#666',
                }}
              >
                {copiedField === 'd-occonfig' ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
            <p style={{ fontSize: 11, color: '#525252', marginTop: 6 }}>
              Add to ~/.config/openclaw/config.json — use the same path as Step 2.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Main Sidebar View
// ============================================================

export function OpenClawSetupView({ agent, projectId, onEdit, onDelete }: OpenClawSetupViewProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    connected: boolean;
    workspace_path?: string;
  }>({ connected: false });

  const pollRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    let active = true;
    async function checkStatus() {
      try {
        const resp = await get(`/api/v1/agent-config/${agent.id}/openclaw-status`) as { data?: { connected: boolean; workspace_path?: string } };
        if (active && resp?.data) {
          setConnectionStatus(resp.data);
        }
      } catch {}
    }
    checkStatus();
    pollRef.current = setInterval(checkStatus, 10_000);
    return () => {
      active = false;
      clearInterval(pollRef.current);
    };
  }, [agent.id]);

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

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #222',
          background: '#0d0d0d',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>🦞</span>
            <span style={{ fontSize: 14, fontWeight: 500, color: '#666' }}>
              {agent.name}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={onEdit}
              title="Edit settings"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#666', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 4, borderRadius: 4,
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#aaa'}
              onMouseLeave={e => e.currentTarget.style.color = '#666'}
            >
              <SettingsIcon />
            </button>
            <button
              onClick={onDelete}
              title="Delete"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: '#666', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 4, borderRadius: 4,
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={e => e.currentTarget.style.color = '#666'}
            >
              <TrashIcon />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Status card */}
          <div style={{
            background: '#111',
            border: '1px solid #2a2a2a',
            borderRadius: 8,
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: '#737373' }}>Access Key</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <code style={{ fontSize: 11, color: '#a3a3a3', fontFamily: 'monospace' }}>
                  {maskedKey}
                </code>
                <button
                  onClick={() => handleCopy(accessKey, 'key')}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: copiedField === 'key' ? '#4ade80' : '#666',
                    padding: 2, display: 'flex', alignItems: 'center',
                  }}
                >
                  {copiedField === 'key' ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: '#737373' }}>Synced folders</span>
              <span style={{ fontSize: 12, color: '#e5e5e5' }}>{resources.length}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: '#737373' }}>Status</span>
              {connectionStatus.connected ? (
                <span style={{ fontSize: 12, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
                  Connected
                </span>
              ) : (
                <span style={{ fontSize: 12, color: '#f59e0b' }}>Waiting for CLI connection</span>
              )}
            </div>
            {connectionStatus.connected && connectionStatus.workspace_path && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: '#737373' }}>Workspace</span>
                <code style={{ fontSize: 11, color: '#a3a3a3', fontFamily: 'monospace', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {connectionStatus.workspace_path}
                </code>
              </div>
            )}

            {/* Folder list */}
            {resources.length > 0 && (
              <div style={{ borderTop: '1px solid #1f1f1f', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {resources.map((r) => (
                  <div key={r.nodeId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Folder icon */}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, color: '#a1a1aa' }}>
                      <path d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z"
                        fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    <span style={{ fontSize: 12, color: '#d4d4d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {r.nodeName}
                    </span>
                    {/* Sync direction badge */}
                    <span style={{ fontSize: 10, color: '#525252', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>
                      sync →
                    </span>
                  </div>
                ))}
              </div>
            )}

          {/* CTA inside status card, right below status row */}
            <button
              onClick={() => setShowSetup(true)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                width: '100%', padding: '8px 12px', marginTop: 4,
                background: '#1a1a1a', border: '1px solid #333',
                borderRadius: 6, cursor: 'pointer',
                fontSize: 12, fontWeight: 500, color: '#e5e5e5',
                transition: 'all 150ms',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = '#222';
                e.currentTarget.style.borderColor = '#444';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = '#1a1a1a';
                e.currentTarget.style.borderColor = '#333';
              }}
            >
              How to connect
              <ArrowRightIcon />
            </button>
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
          background: '#1a1a1a', border: '1px solid #333',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: '#737373', fontWeight: 600, flexShrink: 0,
        }}>
          {step}
        </span>
        <span style={{ fontSize: 13, color: '#a3a3a3', fontWeight: 500 }}>{label}</span>
      </div>
      {hint && (
        <p style={{ fontSize: 11, color: '#525252', margin: '0 0 6px 28px' }}>{hint}</p>
      )}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#0a0a0a', border: '1px solid #2a2a2a',
        borderRadius: 6, padding: '8px 12px', marginLeft: 28,
      }}>
        <code style={{
          flex: 1, fontSize: 12, color: '#a3a3a3',
          fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.5,
        }}>
          {command}
        </code>
        <button
          onClick={() => onCopy(command, fieldKey)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: copiedField === fieldKey ? '#4ade80' : '#525252',
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
