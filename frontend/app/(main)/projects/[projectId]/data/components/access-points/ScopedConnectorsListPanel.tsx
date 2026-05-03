'use client';

/**
 * ScopedConnectorsListPanel — per-scope connector list (redesign-2026-05-02).
 *
 * Replaces the project-wide AccessPointsListPanel. Renders the connectors
 * bound to the scope the user has navigated into. cli + agent are the
 * always-present defaults (DB trigger guarantees their existence per scope);
 * third-party providers (notion / gmail / github / url / ...) appear under
 * a separate section. The header carries an "+ Add Import/Export" button
 * that opens the provider picker.
 *
 * No parent-child inheritance: a folder shows ONLY connectors of its
 * exact-match scope (per Q1 decision 2026-05-03). Folders that aren't
 * scopes show an empty state.
 */

import { useMemo, useState } from 'react';
import { PanelShell } from '../PanelShell';
import { AccessPointProviderIcon, StatusDot } from './AccessPointProviderIcon';
import { sortConnectorsBuiltinFirst, type Connector, type RepoScope } from '@/lib/repoApi';
import type { ProviderIconLookup } from './types';
import type { SyncEndpointInfo } from '../explorer';

/**
 * Map redesign provider strings (cli/agent) to the legacy SyncEndpointInfo
 * shape consumed by AccessPointProviderIcon. Keeps icon logic centralised
 * in the existing component without forking it.
 */
function connectorAsEndpointShape(c: Connector): SyncEndpointInfo {
  // 'cli' maps to the legacy filesystem icon (folder); 'agent' to the
  // legacy agent:* icon. Other providers fall through to providerIcons lookup.
  let legacyProvider: string;
  if (c.provider === 'cli') legacyProvider = 'filesystem';
  else if (c.provider === 'agent') legacyProvider = 'agent:chat';
  else legacyProvider = c.provider;
  return {
    syncId: c.id,
    provider: legacyProvider,
    direction: c.direction,
    status: c.status,
    name: c.name,
    accessKey: null,
  };
}

interface Props {
  readonly scope: RepoScope | null;
  readonly connectors: readonly Connector[];
  readonly providerIcons: ProviderIconLookup;
  readonly onClose: () => void;
  readonly onAddRequested: () => void;
  readonly onConnectorClick: (c: Connector) => void;
}

const COLOR_FG = '#e4e4e7';
const COLOR_FG_MUTED = '#a1a1aa';
const COLOR_FG_DIM = '#71717a';
const COLOR_BORDER = 'rgba(255,255,255,0.06)';
const COLOR_BORDER_HOVER = 'rgba(255,255,255,0.12)';
const COLOR_BG_CARD = 'rgba(255,255,255,0.02)';
const COLOR_BG_HOVER = 'rgba(255,255,255,0.06)';

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    cli: 'Local CLI',
    agent: 'AI Agent',
    notion: 'Notion',
    gmail: 'Gmail',
    google_docs: 'Google Docs',
    google_sheets: 'Google Sheets',
    google_drive: 'Google Drive',
    google_calendar: 'Google Calendar',
    github: 'GitHub',
    linear: 'Linear',
    airtable: 'Airtable',
    url: 'Web Page',
    rss: 'RSS Feed',
    rest_api: 'REST API',
    supabase: 'Supabase',
    mcp: 'MCP Server',
    sandbox: 'Sandbox',
  };
  return labels[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
}

function directionLabel(direction: string): string {
  if (direction === 'bidirectional') return 'Two-way';
  if (direction === 'inbound') return 'Import';
  if (direction === 'outbound') return 'Export';
  return direction || '—';
}

function ConnectorCard({
  connector,
  providerIcons,
  onClick,
  builtin,
}: {
  readonly connector: Connector;
  readonly providerIcons: ProviderIconLookup;
  readonly onClick: () => void;
  readonly builtin: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const iconEp = useMemo(() => connectorAsEndpointShape(connector), [connector]);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 8,
        border: `1px solid ${hovered ? COLOR_BORDER_HOVER : COLOR_BORDER}`,
        background: hovered ? COLOR_BG_HOVER : COLOR_BG_CARD,
        color: COLOR_FG,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <AccessPointProviderIcon ep={iconEp} providerIcons={providerIcons} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: COLOR_FG, lineHeight: 1.3 }}>
            {connector.name || providerLabel(connector.provider)}
          </span>
          {builtin && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                color: COLOR_FG_MUTED,
                padding: '1px 6px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              Default
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: COLOR_FG_DIM, lineHeight: 1.4, marginTop: 2 }}>
          {providerLabel(connector.provider)} · {directionLabel(connector.direction)}
        </div>
      </div>
      <StatusDot status={connector.status} />
    </button>
  );
}

function EmptyScopeMessage({ onClose }: { readonly onClose: () => void }) {
  return (
    <div
      style={{
        padding: '32px 16px',
        textAlign: 'center',
        color: COLOR_FG_DIM,
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <div style={{ marginBottom: 8 }}>This folder isn&apos;t a scope.</div>
      <div style={{ fontSize: 12, color: COLOR_FG_DIM }}>
        Imports and exports are configured per scope. Navigate to a scope folder, or close this panel.
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: 16,
          padding: '6px 14px',
          fontSize: 12,
          background: '#242424',
          border: `1px solid ${COLOR_BORDER_HOVER}`,
          borderRadius: 6,
          color: COLOR_FG,
          cursor: 'pointer',
        }}
      >
        Close
      </button>
    </div>
  );
}

export function ScopedConnectorsListPanel({
  scope,
  connectors,
  providerIcons,
  onClose,
  onAddRequested,
  onConnectorClick,
}: Props) {
  const sorted = useMemo(() => sortConnectorsBuiltinFirst(connectors), [connectors]);
  const builtin = useMemo(
    () => sorted.filter((c) => c.provider === 'cli' || c.provider === 'agent'),
    [sorted],
  );
  const thirdParty = useMemo(
    () => sorted.filter((c) => c.provider !== 'cli' && c.provider !== 'agent'),
    [sorted],
  );

  const title = scope ? `${scope.name} · Imports & Exports` : 'Imports & Exports';

  return (
    <PanelShell
      title={title}
      onClose={onClose}
      headerRight={
        scope ? (
          <button
            type="button"
            onClick={onAddRequested}
            style={{
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 500,
              color: COLOR_FG,
              background: 'rgba(255,255,255,0.06)',
              border: `1px solid ${COLOR_BORDER_HOVER}`,
              borderRadius: 6,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            + Add
          </button>
        ) : null
      }
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: '#0e0e0e',
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '12px 12px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {scope ? (
            <>
              {/* Scope summary */}
              <div
                style={{
                  fontSize: 11,
                  color: COLOR_FG_DIM,
                  borderBottom: `1px solid ${COLOR_BORDER}`,
                  paddingBottom: 10,
                }}
              >
                <div style={{ color: COLOR_FG_MUTED }}>
                  Path: {scope.path === '' ? '/ (root)' : scope.path}
                </div>
                <div style={{ marginTop: 2 }}>
                  Mode: {scope.mode === 'rw' ? 'Read &amp; Write' : 'Read-only'}
                  {scope.is_root && ' · Root scope'}
                </div>
              </div>

              {/* Built-ins (cli + agent) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: COLOR_FG_MUTED,
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                    padding: '0 2px',
                  }}
                >
                  Defaults
                </div>
                {builtin.length === 0 ? (
                  <div style={{ fontSize: 12, color: COLOR_FG_DIM, padding: '8px 4px' }}>
                    No default connectors yet — they should auto-create on scope insert.
                  </div>
                ) : (
                  builtin.map((c) => (
                    <ConnectorCard
                      key={c.id}
                      connector={c}
                      providerIcons={providerIcons}
                      onClick={() => onConnectorClick(c)}
                      builtin
                    />
                  ))
                )}
              </div>

              {/* Third-party imports & exports */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: COLOR_FG_MUTED,
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                    padding: '0 2px',
                  }}
                >
                  Imports &amp; Exports
                </div>
                {thirdParty.length === 0 ? (
                  <div style={{ fontSize: 12, color: COLOR_FG_DIM, padding: '8px 4px' }}>
                    No imports or exports yet. Click &quot;+ Add&quot; to connect a source.
                  </div>
                ) : (
                  thirdParty.map((c) => (
                    <ConnectorCard
                      key={c.id}
                      connector={c}
                      providerIcons={providerIcons}
                      onClick={() => onConnectorClick(c)}
                      builtin={false}
                    />
                  ))
                )}
              </div>
            </>
          ) : (
            <EmptyScopeMessage onClose={onClose} />
          )}
        </div>
      </div>
    </PanelShell>
  );
}
