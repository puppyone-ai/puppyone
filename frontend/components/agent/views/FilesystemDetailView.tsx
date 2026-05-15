'use client';

import React, { useState, useCallback } from 'react';
import useSWR from 'swr';
import { get, del, post } from '@/lib/apiClient';
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
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--po-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </svg>
  );
}

interface FilesystemDetailViewProps {
  syncId: string;
  projectId?: number | string;
  onClose?: () => void;
  onBack?: () => void;
}

export function FilesystemDetailView({ syncId, projectId, onClose, onBack }: FilesystemDetailViewProps) {
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

  const [togglingPause, setTogglingPause] = useState(false);
  const isPaused = sync?.status === 'paused';
  const handleTogglePause = useCallback(async () => {
    if (!syncId || togglingPause) return;
    setTogglingPause(true);
    try {
      const action = isPaused ? 'resume' : 'pause';
      await post(`/api/v1/sync/syncs/${syncId}/${action}`);
      await mutate();
    } catch (err) {
      console.error(`Toggle pause failed:`, err);
    } finally {
      setTogglingPause(false);
    }
  }, [syncId, isPaused, togglingPause, mutate]);

  if (!sync) {
    return (
      <PanelShell title="Machine Folder" onClose={onClose || (() => {})} onBack={onBack}>
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--po-text-disabled)', fontSize: 13, height: '100%' }}>
          Integration not found
        </div>
      </PanelShell>
    );
  }

  const isActive = sync.status === 'active' || sync.status === 'syncing';
  const isError = sync.status === 'error';
  const statusColor = isError ? 'var(--po-danger)' : isActive ? 'var(--po-success)' : 'var(--po-text-disabled)';
  const statusLabel = isError ? 'Error' : isActive ? 'Connected' : sync.status || 'Inactive';

  const accessKey = sync.access_key || '';
  const apiBase = typeof window !== 'undefined' ? (process.env.NEXT_PUBLIC_API_URL || window.location.origin) : '';
  const cloneUrl = `${apiBase}/mut/ap/${accessKey}`;

  return (
    <PanelShell
      title="Machine Folder"
      subtitle={sync.node_name || undefined}
      icon={<LaptopIcon size={14} />}
      onClose={onClose || (() => {})}
      onBack={onBack}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* ── Flow visualization ── */}
        <div style={{
          padding: '16px 0 8px',
          borderBottom: '1px solid var(--po-border-subtle)',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {/* Source (LEFT) → Arrow → Workspace (RIGHT) */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 0 }}>
            {/* Local source (LEFT) */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 72, flexShrink: 0 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: 'var(--po-panel-raised)', border: '1px solid var(--po-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px var(--po-shadow)',
              }}>
                <LaptopIcon size={24} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--po-text)', textAlign: 'center' }}>
                Machine Folder
              </div>
            </div>

            {/* Arrow area */}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              width: 80, flexShrink: 0, paddingTop: 16,
            }}>
              {isActive ? (
                <svg width="80" height="16" viewBox="0 0 80 16" fill="none" stroke="var(--po-success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 5h76M6 2L2 5l4 3M74 8l4 3-4 3M2 11h76" />
                </svg>
              ) : (
                <svg width="80" height="16" viewBox="0 0 80 16" fill="none" stroke={isError ? 'var(--po-danger)' : 'var(--po-text-disabled)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 4">
                  <path d="M2 8h76" />
                </svg>
              )}
            </div>

            {/* Workspace target (RIGHT) */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 72, flexShrink: 0 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: 'var(--po-panel-raised)', border: '1px solid var(--po-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 12px var(--po-shadow)',
              }}>
                {sync.node_type === 'folder' || !sync.node_type
                  ? <img src="/icons/folder.svg" alt="Folder" width={24} height={24} style={{ display: 'block' }} />
                  : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--po-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                }
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--po-text)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 72 }}>
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
            <span style={{ fontSize: 11, fontWeight: 500, color: isActive ? 'var(--po-text)' : 'var(--po-text-subtle)' }}>
              {isError ? 'Sync error' : isActive ? 'Sync active' : statusLabel}
            </span>
            {sync.last_synced_at && (
              <span style={{ fontSize: 11, color: 'var(--po-text-disabled)' }}>
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
            background: 'color-mix(in srgb, var(--po-danger) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--po-danger) 12%, transparent)',
          }}>
            <div style={{ fontSize: 12, color: 'var(--po-danger)', lineHeight: 1.6 }}>{sync.error_message}</div>
          </div>
        )}

        {/* ── Quick Actions ── */}
        <div style={{ padding: '16px 20px 0', display: 'flex', gap: 8 }}>
          <button
            onClick={handleTogglePause}
            disabled={togglingPause || isError}
            style={{
              flex: 1, height: 32, borderRadius: 6,
              background: 'transparent',
              border: '1px solid var(--po-border)',
              color: 'var(--po-text-muted)', fontSize: 13, fontWeight: 500,
              cursor: (togglingPause || isError) ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              opacity: isError ? 0.5 : 1,
            }}
            onMouseEnter={e => {
              if (togglingPause || isError) return;
              e.currentTarget.style.background = 'var(--po-hover)';
              e.currentTarget.style.color = 'var(--po-text)';
            }}
            onMouseLeave={e => {
              if (togglingPause || isError) return;
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--po-text-muted)';
            }}
          >
            {isPaused ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
              </svg>
            )}
            {togglingPause ? (isPaused ? 'Resuming...' : 'Pausing...') : (isPaused ? 'Resume' : 'Pause')}
          </button>

          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            style={{
              flex: 1, height: 32, borderRadius: 6,
              background: 'transparent',
              border: '1px solid var(--po-border)',
              color: 'var(--po-text-muted)', fontSize: 13, fontWeight: 500,
              cursor: disconnecting ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            onMouseEnter={e => {
              if (disconnecting) return;
              e.currentTarget.style.background = 'color-mix(in srgb, var(--po-danger) 6%, transparent)';
              e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--po-danger) 20%, transparent)';
              e.currentTarget.style.color = 'var(--po-danger)';
            }}
            onMouseLeave={e => {
              if (disconnecting) return;
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'var(--po-border)';
              e.currentTarget.style.color = 'var(--po-text-muted)';
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            {disconnecting ? 'Disconnecting...' : 'Disconnect'}
          </button>
        </div>

        {/* ── Credentials & Details (Combined) ── */}
        <CollapsibleSection title="Credentials & Details" defaultOpen={false}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {accessKey && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <CredentialRow label="Access Key" value={accessKey} />
                <CredentialRow label="Clone URL" value={cloneUrl} />
              </div>
            )}
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 0,
              background: 'var(--po-panel)', borderRadius: 8,
              border: '1px solid var(--po-border-subtle)', overflow: 'hidden',
            }}>
              <InfoRow label="Sync ID" value={sync.id} isLast={false} />
              <InfoRow label="Direction" value="Bidirectional" isLast={false} />
              <InfoRow label="Protocol" value="MUT" isLast />
            </div>
          </div>
        </CollapsibleSection>

        {/* ── AI Agent Prompt ── */}
        {accessKey && (
          <div style={{ padding: '24px 20px 0' }}>
            <AgentPromptBlock
              cloneUrl={cloneUrl}
              accessKey={accessKey}
              scopeName={sync.node_name || 'project'}
            />
          </div>
        )}

        {/* ── Setup (one-time) ── */}
        {accessKey && (
          <CollapsibleSection title="Manual Setup" defaultOpen={false}>
            <SetupTabs
              cloneUrl={cloneUrl}
              accessKey={accessKey}
              scopeName={sync.node_name || 'project'}
            />
          </CollapsibleSection>
        )}

        {/* ── Sync Commands ── */}
        {accessKey && (
          <CollapsibleSection title="Manual Sync Steps" defaultOpen={false}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <SyncStep step={1} command="mut pull" hint="Get the latest from cloud" />
              <SyncStep step={2} label="Edit files" />
              <SyncStep step={3} command={'mut commit -m "your message"'} hint="Snapshot your changes locally" />
              <SyncStep step={4} command="mut push" hint="Send your changes to cloud" isLast />
            </div>
          </CollapsibleSection>
        )}

      </div>
    </PanelShell>
  );
}

/* ================================================================
   Sub-components
   ================================================================ */

type SetupMode = 'clone' | 'connect';

function SetupTabs({ cloneUrl, accessKey, scopeName }: { cloneUrl: string; accessKey: string; scopeName: string }) {
  const [mode, setMode] = useState<SetupMode>('clone');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Path picker ── */}
      <div style={{
        display: 'flex', gap: 0,
        background: 'var(--po-inset)', border: '1px solid var(--po-hover)',
        borderRadius: 6, padding: 3,
      }}>
        <SetupModeTab
          active={mode === 'clone'}
          label="Clone fresh"
          hint="No local files"
          onClick={() => setMode('clone')}
        />
        <SetupModeTab
          active={mode === 'connect'}
          label="Connect existing"
          hint="Use my files"
          onClick={() => setMode('connect')}
        />
      </div>

      <CommandBlock command="pip install mutai" label="Install" />

      {mode === 'clone' ? (
        <>
          <CommandBlock
            command={`mut clone ${cloneUrl} \\\n  --credential ${accessKey}`}
            label="Clone"
          />
          <div style={{ fontSize: 12, color: 'var(--po-text-disabled)', marginTop: 4, lineHeight: 1.5 }}>
            Run once. Creates a local <code style={{ fontFamily: "var(--po-font-sans)", color: 'var(--po-text-subtle)' }}>./{scopeName}/</code> folder
            populated from this context.
          </div>
        </>
      ) : (
        <>
          <CommandBlock
            command={`cd /path/to/your/folder\nmut connect ${cloneUrl} \\\n  --credential ${accessKey}`}
            label="Connect"
          />
          <div style={{ fontSize: 12, color: 'var(--po-text-disabled)', marginTop: 4, lineHeight: 1.5 }}>
            Run inside an existing folder. Three-way merges your local files with cloud state and pushes
            the result. Files only on disk get uploaded; files only in cloud get downloaded.
            <span style={{ color: 'var(--po-warning)', fontWeight: 500 }}> No overwrite, no data loss.</span>
          </div>
        </>
      )}
    </div>
  );
}

function SetupModeTab({ active, label, hint, onClick }: { active: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, minHeight: 48, padding: '8px 12px', borderRadius: 4, border: 'none',
        background: active ? 'var(--po-border-subtle)' : 'transparent',
        color: active ? 'var(--po-text)' : 'var(--po-text-subtle)',
        cursor: 'pointer', textAlign: 'left',
        transition: 'all 0.15s',
        display: 'flex', flexDirection: 'column', gap: 2,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--po-text-muted)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--po-text-subtle)'; }}
    >
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 11, color: active ? 'var(--po-text-muted)' : 'var(--po-text-disabled)' }}>{hint}</span>
    </button>
  );
}

function AgentPromptBlock({ cloneUrl, accessKey, scopeName }: { cloneUrl: string; accessKey: string; scopeName: string }) {
  const [copied, setCopied] = useState(false);

  const prompt = [
    `Sync my local folder with PuppyOne cloud using the \`mut\` CLI.`,
    ``,
    `## Install (one-time)`,
    `\`\`\`bash`,
    `pip install mutai`,
    `\`\`\``,
    ``,
    `## Setup — choose one path`,
    ``,
    `**A. Clone to a new folder** (no local files yet):`,
    `\`\`\`bash`,
    `mut clone ${cloneUrl} --credential ${accessKey}`,
    `cd ${scopeName}`,
    `\`\`\``,
    ``,
    `**B. Connect an existing folder** (already have files locally):`,
    `\`\`\`bash`,
    `cd /path/to/your/existing/folder`,
    `mut connect ${cloneUrl} --credential ${accessKey}`,
    `\`\`\``,
    `Three-way merges with whatever is on disk — no overwrite, no data loss.`,
    ``,
    `## Sync workflow`,
    `\`\`\`bash`,
    `mut pull                          # get latest from cloud`,
    `# ... make your edits ...`,
    `mut commit -m "describe changes"  # snapshot locally`,
    `mut push                          # send to cloud`,
    `\`\`\``,
    ``,
    `Run \`mut status\` to check for uncommitted changes.`,
    `Run \`mut log\` to view commit history.`,
  ].join('\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--po-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
        Quick Start
      </div>
      <div style={{ fontSize: 12, color: 'var(--po-text-disabled)', lineHeight: 1.5, marginBottom: 12 }}>
        Copy the prompt below and paste it into Claude Code, Cursor, or any AI coding agent.
      </div>
      <div
        style={{
          position: 'relative',
          background: 'var(--po-inset)',
          border: `1px solid ${copied ? 'color-mix(in srgb, var(--po-success) 30%, transparent)' : 'var(--po-border-subtle)'}`,
          borderRadius: 8, padding: '12px 14px',
          transition: 'border-color 0.2s',
        }}
      >
        <pre style={{
          margin: 0, fontSize: 11, lineHeight: 1.65, color: 'var(--po-text-subtle)',
          fontFamily: "var(--po-font-sans)",
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          maxHeight: 160, overflow: 'hidden',
          WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
          maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
        }}>
          {prompt}
        </pre>
        <button
          onClick={handleCopy}
          style={{
            position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
            height: 30, padding: '0 16px', borderRadius: 6,
            background: copied ? 'color-mix(in srgb, var(--po-success) 10%, transparent)' : 'var(--po-border-subtle)',
            border: `1px solid ${copied ? 'color-mix(in srgb, var(--po-success) 25%, transparent)' : 'var(--po-active)'}`,
            color: copied ? 'var(--po-success)' : 'var(--po-text-muted)',
            fontSize: 12, fontWeight: 500, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            if (copied) return;
            e.currentTarget.style.background = 'var(--po-border)';
            e.currentTarget.style.color = 'var(--po-text)';
          }}
          onMouseLeave={e => {
            if (copied) return;
            e.currentTarget.style.background = 'var(--po-border-subtle)';
            e.currentTarget.style.color = 'var(--po-text-muted)';
          }}
        >
          {copied ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Copied
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              Copy Prompt
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function CollapsibleSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 24, padding: '0 20px' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'transparent', border: 'none', height: 30, padding: 0,
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 600, color: 'var(--po-text-subtle)',
          textTransform: 'uppercase', letterSpacing: '0.5px',
          cursor: 'pointer', width: '100%', textAlign: 'left',
          outline: 'none',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {title}
      </button>
      {isOpen && (
        <div style={{ marginTop: 12 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function SyncStep({ step, command, hint, label, isLast }: { step: number; command?: string; hint?: string; label?: string; isLast?: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!command) return;
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {/* Left column: Circle & Line */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{
          width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
          background: 'var(--po-hover)',
          border: '1px solid var(--po-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 600, color: 'var(--po-text-muted)',
        }}>
          {step}
        </div>
        {!isLast && (
          <div style={{
            width: 0, flex: 1, minHeight: 16,
            borderLeft: '2px dotted var(--po-border)',
            margin: '4px 0',
          }} />
        )}
      </div>

      {/* Right column: Content */}
      <div style={{ flex: 1, minWidth: 0, paddingTop: 1, paddingBottom: isLast ? 0 : 16 }}>
        {command ? (
          <div>
            <div
              style={{
                position: 'relative',
                background: 'var(--po-inset)',
                border: '1px solid var(--po-border-subtle)',
                borderRadius: 8, padding: '10px 12px',
              }}
            >
              <code style={{
                fontSize: 12, color: 'var(--po-text-muted)',
                fontFamily: "var(--po-font-sans)",
              }}>
                <span style={{ color: 'var(--po-text-disabled)', userSelect: 'none' }}>$ </span>{command}
              </code>
              <button
                onClick={handleCopy}
                style={{
                  position: 'absolute', top: 8, right: 8,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: copied ? 'var(--po-success)' : 'var(--po-text-disabled)', width: 30, height: 30, padding: 0, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                {copied ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                )}
              </button>
            </div>
            {hint && (
              <div style={{ fontSize: 11, color: 'var(--po-text-subtle)', marginTop: 6, lineHeight: 1.5, paddingLeft: 4 }}>{hint}</div>
            )}
          </div>
        ) : (
          <div style={{ padding: '2px 0', fontSize: 13, color: 'var(--po-text-muted)' }}>
            {label}
            {hint && <div style={{ fontSize: 12, color: 'var(--po-text-disabled)', marginTop: 4 }}>{hint}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

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
          background: 'var(--po-inset)',
          border: '1px solid var(--po-border-subtle)',
          borderRadius: 8, padding: '10px 12px',
          transition: 'border-color 0.15s',
          borderColor: hovered ? 'var(--po-active)' : 'var(--po-border-subtle)',
        }}
      >
        <pre style={{
          margin: 0, fontSize: 12, lineHeight: 1.6,
          color: 'var(--po-text-muted)',
          fontFamily: "var(--po-font-sans)",
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          paddingRight: 28,
        }}>
          <span style={{ color: 'var(--po-text-disabled)', userSelect: 'none' }}>$ </span>
          {command}
        </pre>
        <button
          onClick={handleCopy}
          title={`Copy ${label} command`}
          style={{
            position: 'absolute', top: 8, right: 8,
            background: 'transparent', border: 'none',
            cursor: 'pointer',
            color: copied ? 'var(--po-success)' : 'var(--po-text-disabled)',
            width: 30, height: 30, padding: 0, borderRadius: 4, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => { if (!copied) e.currentTarget.style.color = 'var(--po-text-muted)'; }}
          onMouseLeave={e => { if (!copied) e.currentTarget.style.color = 'var(--po-text-disabled)'; }}
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          )}
        </button>
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: 'var(--po-text-disabled)', marginTop: 4, lineHeight: 1.5 }}>
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
      background: 'var(--po-panel)', borderRadius: 8,
      border: '1px solid var(--po-border-subtle)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--po-text-disabled)', fontWeight: 500, flexShrink: 0, width: 76 }}>
        {label}
      </span>
      <code style={{
        flex: 1, fontSize: 11, color: 'var(--po-text-muted)',
        fontFamily: "var(--po-font-sans)",
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
          color: copied ? 'var(--po-success)' : 'var(--po-text-disabled)',
          width: 30, height: 30, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => { if (!copied) e.currentTarget.style.color = 'var(--po-text-muted)'; }}
        onMouseLeave={e => { if (!copied) e.currentTarget.style.color = 'var(--po-text-disabled)'; }}
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
      borderBottom: isLast ? 'none' : '1px solid var(--po-hover)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--po-text-disabled)', fontWeight: 500, flexShrink: 0, width: 76 }}>
        {label}
      </span>
      <span style={{
        flex: 1, fontSize: 12, color: 'var(--po-text-muted)',
        fontFamily: label === 'Sync ID' ? "var(--po-font-sans)" : 'inherit',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  );
}
