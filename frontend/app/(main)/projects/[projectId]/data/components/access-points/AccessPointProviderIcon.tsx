'use client';

import type { SyncEndpointInfo } from '../explorer';
import type { ProviderIconLookup } from './types';

export function StatusDot({ status, borderColor = '#171717' }: { status: string; borderColor?: string }) {
  const color = status === 'error' ? '#ef4444' : status === 'stopped' ? '#71717a' : '#10b981';
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        right: -1,
        bottom: -1,
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        border: `2px solid ${borderColor}`,
        boxSizing: 'border-box',
      }}
    />
  );
}

function FolderMiniIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function McpMiniIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function SandboxMiniIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

export function DefaultProviderIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M8 12h8" />
    </svg>
  );
}

function AgentMiniIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function AccessPointProviderIcon({
  ep,
  providerIcons,
}: {
  ep: SyncEndpointInfo;
  providerIcons: ProviderIconLookup;
}) {
  if (ep.provider.startsWith('agent:')) return <AgentMiniIcon />;
  if (ep.provider === 'mcp') return <McpMiniIcon />;
  if (ep.provider === 'sandbox') return <SandboxMiniIcon />;
  if (ep.provider === 'filesystem') return <FolderMiniIcon />;

  const providerIcon = providerIcons[ep.provider];
  if (providerIcon?.iconUrl) {
    return <img src={providerIcon.iconUrl} alt="" width={16} height={16} style={{ display: 'block', borderRadius: 2 }} />;
  }

  return providerIcon?.icon ? <span style={{ fontSize: 14, lineHeight: 1 }}>{providerIcon.icon}</span> : <DefaultProviderIcon />;
}
