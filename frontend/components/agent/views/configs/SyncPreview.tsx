'use client';

import React from 'react';

export type AcceptedNodeType = 'folder' | 'json' | 'markdown' | 'file';
type SyncDirection = 'inbound' | 'outbound' | 'bidirectional';

export interface SyncPreviewProps {
  provider: string;
  providerLabel: string;
  direction: SyncDirection;
  targetName: string | null;
  targetType: AcceptedNodeType;
  isActive?: boolean;
}

// ── MiniDocShell ──

function MiniDocShell({ type }: { type: 'json' | 'markdown' | 'file' }) {
  const accentColor = type === 'json' ? '#4ade80' : type === 'markdown' ? '#60a5fa' : '#a3a3a3';
  const label = type === 'json' ? '{ }' : type === 'markdown' ? 'MD' : 'FILE';
  return (
    <svg width="36" height="40" viewBox="0 0 36 40" fill="none">
      <path d="M4 2C4 1.44772 4.44772 1 5 1H23L32 10V38C32 38.5523 31.5523 39 31 39H5C4.44772 39 4 38.5523 4 38V2Z"
        fill="#222225" stroke="#3a3a3d" strokeWidth="0.75" />
      <path d="M23 1V10H32" stroke="#3a3a3d" strokeWidth="0.75" strokeLinejoin="round" />
      <path d="M23 1V10H32L23 1Z" fill="#2a2a2d" />
      <text x="18" y="28" textAnchor="middle" fontSize="7" fontWeight="600" fill={accentColor}
        fontFamily="'SF Mono', 'JetBrains Mono', monospace">{label}</text>
    </svg>
  );
}

// ── ConnectionLine ──

function ConnectionLine({ direction, isActive }: { direction: string; isActive: boolean }) {
  const color = isActive ? '#4ade80' : '#737373';

  if (direction === 'bidirectional') {
    return (
      <svg width="36" height="16" viewBox="0 0 36 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 5h32M6 2L2 5l4 3M30 8l4 3-4 3M2 11h32" />
      </svg>
    );
  }

  if (direction === 'outbound') {
    return (
      <svg width="36" height="16" viewBox="0 0 36 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M34 8H2M6 4L2 8l4 4" />
      </svg>
    );
  }

  return (
    <svg width="36" height="16" viewBox="0 0 36 16" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 8h32M30 4l4 4-4 4" />
    </svg>
  );
}

// ── Provider logos ──

function ProviderImg({ src, alt, size }: { src: string; alt: string; size: number }) {
  return <img src={src} alt={alt} width={size} height={size} style={{ display: 'block' }} />;
}

function getProviderLogo(provider: string, size: number) {
  switch (provider) {
    case 'gmail': return <ProviderImg src="/icons/gmail.svg" alt="Gmail" size={size} />;
    case 'google_calendar': return <ProviderImg src="/icons/google_calendar.svg" alt="Google Calendar" size={size} />;
    case 'google_sheets': return <ProviderImg src="/icons/google_sheet.svg" alt="Google Sheets" size={size} />;
    case 'google_drive': return <ProviderImg src="/icons/google_doc.svg" alt="Google Drive" size={size} />;
    case 'google_docs': return <ProviderImg src="/icons/google_doc.svg" alt="Google Docs" size={size} />;
    case 'github': return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff">
        <path fillRule="evenodd" clipRule="evenodd" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
      </svg>
    );
    case 'notion': return <ProviderImg src="/icons/notion.svg" alt="Notion" size={size} />;
    case 'linear': return <ProviderImg src="/icons/linear.svg" alt="Linear" size={size} />;
    case 'supabase': return (
      <svg width={size} height={size} viewBox="0 0 109 113" fill="none">
        <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#sp0s)"/>
        <path d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z" fill="#3ECF8E"/>
        <defs><linearGradient id="sp0s" x1="53.9738" y1="54.974" x2="94.1635" y2="71.8295" gradientUnits="userSpaceOnUse"><stop stopColor="#249361"/><stop offset="1" stopColor="#3ECF8E"/></linearGradient></defs>
      </svg>
    );
    case 'filesystem': case 'openclaw':
      return <span style={{ fontSize: size * 0.65 }}>🦞</span>;
    default: return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <rect x="2" y="2" width="20" height="20" rx="4" fill="#333"/>
        <text x="12" y="16" textAnchor="middle" fontSize="12" fontWeight="700" fill="#aaa" fontFamily="sans-serif">
          {provider.charAt(0).toUpperCase()}
        </text>
      </svg>
    );
  }
}

const DIR_LABELS: Record<SyncDirection, string> = {
  inbound: 'Syncing to PuppyOne',
  outbound: 'Syncing from PuppyOne',
  bidirectional: 'Bidirectional sync',
};

// ============================================================
// SyncPreview — pure display hero card (no interaction)
// ============================================================

export function SyncPreview({ provider, providerLabel, direction, targetName, targetType, isActive }: SyncPreviewProps) {
  const hasTarget = !!targetName;
  const ready = isActive ?? false;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 14, position: 'relative',
      paddingBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.06)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        {/* External source (LEFT) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 80 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
          }}>
            {getProviderLogo(provider, 24)}
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#d4d4d4', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
            {providerLabel}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 100, marginBottom: 12 }}>
          <ConnectionLine direction={direction} isActive={ready} />
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: ready ? '#4ade80' : '#525252',
              display: 'inline-block', flexShrink: 0,
            }} />
            <span style={{ fontSize: 11, fontWeight: 500, color: ready ? '#e5e5e5' : '#737373' }}>
              {ready ? DIR_LABELS[direction] : !hasTarget ? 'Waiting for sync target' : 'Waiting for account'}
            </span>
          </div>
        </div>

        {/* PuppyOne target node (RIGHT) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 80 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
          }}>
            {targetType === 'folder'
              ? <img src="/icons/folder.svg" alt="Folder" width={24} height={24} style={{ display: 'block' }} />
              : <div style={{ transform: 'scale(0.8)' }}><MiniDocShell type={targetType as 'json' | 'markdown' | 'file'} /></div>
            }
          </div>
          <div style={{
            fontSize: 12, fontWeight: 500, color: hasTarget ? '#d4d4d4' : '#525252',
            textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', maxWidth: 90,
          }}>
            {targetName || 'Workspace'}
          </div>
        </div>
      </div>
    </div>
  );
}
