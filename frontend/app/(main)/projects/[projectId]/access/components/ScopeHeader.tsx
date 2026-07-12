'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { StatusDot, StatusIndicator } from '@/components/ui/StatusDot';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { T } from '../lib/tokens';
import { STATUS_LABEL } from '../lib/constants';
import { CopyIcon } from './icons';
import { SectionLabel } from './ui-blocks';

// ─── ScopePageHeader ─────────────────────────────────────────────────
//
// h1 of the right pane. Displays the scope's *name* (first-class
// editable field independent of the scope path) and a tiny meta
// line summarizing aggregate health across the scope's connectors.
//
// The visual pattern mirrors `ConnectorCard`'s own header so the user
// can instantly tell that a scope is conceptually "the same kind of
// surface" as a connector — just one level up. Path information
// (where this scope lives on disk + its read/write mode + perm
// badges) lives in the compact strip below; we deliberately keep the
// title lean.
//
// Aggregate status:
//   - any errored             → 'Error'   (red dot)
//   - any syncing             → 'Syncing' (blue dot)
//   - all active              → 'Active'  (green dot)
//   - all paused              → 'Paused'  (amber dot)
//   - mixed (some on/off)     → 'Mixed'   (amber dot)
//   - empty                   → no meta line
//
interface ScopeAggregateStatus {
  readonly key: 'empty' | 'active' | 'syncing' | 'paused' | 'mixed' | 'error';
  readonly label: string;
}

function computeAggregate(connectors: readonly Connector[]): ScopeAggregateStatus {
  if (connectors.length === 0) {
    return { key: 'empty', label: 'No connectors' };
  }
  if (connectors.some((c) => c.status === 'error')) {
    return { key: 'error', label: STATUS_LABEL.error };
  }
  if (connectors.some((c) => c.status === 'syncing')) {
    return { key: 'syncing', label: STATUS_LABEL.syncing };
  }
  if (connectors.every((c) => c.status === 'active')) {
    return { key: 'active', label: STATUS_LABEL.active };
  }
  if (connectors.every((c) => c.status === 'paused')) {
    return { key: 'paused', label: STATUS_LABEL.paused };
  }
  return { key: 'mixed', label: 'Mixed' };
}

export function ScopePageHeader({
  scope,
  connectors,
  settingsOpen,
  settingsDirty,
  onToggleSettings,
  canManage,
}: {
  readonly scope: RepoScope | undefined;
  readonly connectors: readonly Connector[];
  readonly settingsOpen: boolean;
  readonly settingsDirty: boolean;
  readonly onToggleSettings: () => void;
  readonly canManage: boolean;
}) {
  const titleText = scope?.name?.trim() || 'Untitled scope';
  const aggregate = computeAggregate(connectors);
  const isWorkspaceWide = scope?.is_root || scope?.path === '' || scope?.path == null;
  const pathLabel = isWorkspaceWide ? '/' : `/${scope?.path ?? ''}`;
  const modeLabel = scope?.mode === 'rw' ? 'Read & write' : 'Read only';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        marginBottom: 28,
        minWidth: 0,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 20,
            lineHeight: 1.25,
            fontWeight: 600,
            letterSpacing: '-0.015em',
            color: T.text1,
            fontFamily: T.fontSans,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={titleText}
        >
          {titleText}
        </h1>
        {connectors.length > 0 && aggregate.key !== 'empty' ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: T.text2,
              fontFamily: T.fontSans,
              minWidth: 0,
            }}
          >
            <StatusIndicator status={aggregate.key} label={aggregate.label} style={{ flexShrink: 0 }} />
            <span style={{ color: T.text4, flexShrink: 0 }}>·</span>
            <span style={{ color: T.text2, flexShrink: 0, fontWeight: 400 }}>
              {connectors.length === 1 ? '1 connector' : `${connectors.length} connectors`}
            </span>
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            minWidth: 0,
            fontFamily: T.fontSans,
            fontSize: 12,
            lineHeight: '16px',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              flexShrink: 0,
              color: T.text2,
              fontWeight: 400,
            }}
          >
            Scope
          </span>
          <span
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: T.text2,
              fontFamily: T.fontMono,
            }}
            title={pathLabel}
          >
            {pathLabel}
          </span>
          <span aria-hidden style={{ color: T.text4, flexShrink: 0 }}>·</span>
          <span style={{ color: T.text2, flexShrink: 0 }}>
            {modeLabel}
          </span>
          {scope ? (
            <>
              <span aria-hidden style={{ color: T.text4, flexShrink: 0 }}>·</span>
              <ScopeAccessKeyInline accessKey={scope.access_key ?? ''} />
            </>
          ) : null}
        </div>
      </div>
      <div style={{ flexShrink: 0, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
        {canManage ? <SettingsHeaderButton
          active={settingsOpen}
          dirty={settingsDirty}
          onClick={onToggleSettings}
        /> : null}
      </div>
    </div>
  );
}

function ScopeAccessKeyInline({ accessKey }: { readonly accessKey: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!accessKey) return;
    try {
      await navigator.clipboard.writeText(accessKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }, [accessKey]);

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 6,
        minWidth: 0,
        color: T.text2,
      }}
    >
      <span style={{ flexShrink: 0 }}>Access key</span>
      <code
        title={accessKey ? maskAccessKey(accessKey) : undefined}
        style={{
          maxWidth: 136,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: accessKey ? T.text2 : T.text3,
          fontFamily: T.fontMono,
          fontSize: 12,
          lineHeight: '16px',
        }}
      >
        {accessKey ? maskAccessKey(accessKey) : 'Preparing'}
      </code>
      <button
        type='button'
        aria-label='Copy access key'
        title='Copy access key'
        disabled={!accessKey}
        onClick={handleCopy}
        style={{
          width: 18,
          height: 18,
          border: 'none',
          borderRadius: 5,
          background: 'transparent',
          color: copied ? 'var(--po-success)' : T.text2,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          opacity: accessKey ? 1 : 0.45,
          cursor: accessKey ? 'pointer' : 'default',
          transform: 'translateY(2px)',
        }}
      >
        <CopyIcon size={11} />
      </button>
    </span>
  );
}

function maskAccessKey(accessKey: string): string {
  if (!accessKey) return '';
  const [prefix, rest = ''] = accessKey.split('_', 2);
  const suffix = rest.slice(-4);
  if (!prefix || !suffix) return '••••';
  return `${prefix}_••••••••${suffix}`;
}

export function formatScopePath(scope: RepoScope): string {
  if (scope.is_root || !scope.path) return '/';
  return `/${scope.path}`;
}

function SettingsHeaderButton({
  active,
  dirty,
  onClick,
}: {
  readonly active: boolean;
  readonly dirty: boolean;
  readonly onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type='button'
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-pressed={active}
      aria-label={active ? 'Close scope settings' : 'Open scope settings'}
      title={active ? 'Close settings' : 'Open settings'}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: 6,
        border: `1px solid ${active ? 'var(--po-border-strong)' : T.border}`,
        background: active ? 'var(--po-hover)' : hovered ? 'var(--po-hover)' : 'transparent',
        color: active || hovered ? T.text1 : T.text2,
        cursor: 'pointer',
        transition: `background 0.15s ${T.ease}, color 0.15s ${T.ease}, border-color 0.15s ${T.ease}`,
      }}
    >
      <GearIcon size={13} />
      {dirty ? (
        <StatusDot
          status="warning"
          style={{
            position: 'absolute',
            top: 5,
            right: 5,
          }}
        />
      ) : null}
    </button>
  );
}

export function SettingsSection({
  open,
  children,
}: {
  readonly open: boolean;
  readonly children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      <SectionLabel>Settings</SectionLabel>
      <div
        id='puppyone-access-scope-settings-body'
        style={{
          padding: '14px 14px 12px',
          borderRadius: 10,
          background: 'var(--po-control)',
          border: `1px solid ${T.cardBorder}`,
          animation: `puppyone-access-settings-slide 180ms ${T.ease}`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export const GearIcon = ({ size = 13 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
    <circle cx='12' cy='12' r='3' />
    <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.92 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.3.22.63.22 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z' />
  </svg>
);
