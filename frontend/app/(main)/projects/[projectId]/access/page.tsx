'use client';

/**
 * Third Party Integrations Page
 *
 * Project-wide overview of every user-configured connector, grouped by the
 * scope it's bound to. Built-in defaults (cli, agent) are auto-created per
 * scope by a DB trigger and aren't user-configured — they're excluded
 * here. cli + agent live in the data-view right-side panel
 * (`ScopedConnectorsListPanel`), which is the canonical surface for
 * per-connector configuration.
 *
 * Click a connector row → navigate to its scope's folder under /data and
 * append `?ap=<id>` so the data view can deep-link the right-panel state
 * for that connector. Click "+ Add" on a scope → same navigation, no
 * deep-link, lets the user pick a provider via the right panel's
 * existing third-party flow.
 */

import { use, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  listConnectors,
  listScopes,
  type Connector,
  type RepoScope,
} from '@/lib/repoApi';

// Auto-created default connectors. Excluded from this view because the
// data-view right panel is the right place to operate on them (they're
// always present, one per scope, and you can't add/remove them — only
// inspect their copy-prompt template).
const BUILTIN_PROVIDERS = new Set(['cli', 'agent']);

const PROVIDER_LABELS: Record<string, string> = {
  filesystem: 'Local Folder',
  gmail: 'Gmail',
  google_sheets: 'Google Sheets',
  google_calendar: 'Google Calendar',
  google_docs: 'Google Docs',
  google_drive: 'Google Drive',
  github: 'GitHub',
  notion: 'Notion',
  linear: 'Linear',
  airtable: 'Airtable',
  url: 'Web Page',
  rss: 'RSS Feed',
  rest_api: 'REST API',
  supabase: 'Supabase',
  mcp: 'MCP Server',
  sandbox: 'Sandbox',
  hackernews: 'Hacker News',
  posthog: 'PostHog',
  google_search_console: 'Google Search Console',
  script: 'Custom Script',
};

const STATUS_COLORS: Record<string, string> = {
  active: '#4ade80',
  syncing: '#60a5fa',
  error: '#ef4444',
  paused: '#f59e0b',
  pending: '#71717a',
};

const DIRECTION_LABELS: Record<string, string> = {
  inbound: 'Inbound',
  outbound: 'Outbound',
  bidirectional: 'Two-way',
};

function ProviderIcon({ provider, size = 16 }: { readonly provider: string; readonly size?: number }) {
  const logos: Record<string, string> = {
    gmail: 'https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png',
    google_sheets: 'https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png',
    google_calendar: 'https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_32dp.png',
    google_docs: 'https://www.gstatic.com/images/branding/product/1x/docs_2020q4_32dp.png',
    github: 'https://github.githubassets.com/favicons/favicon-dark.svg',
    notion: 'https://www.notion.so/images/favicon.ico',
  };
  if (logos[provider]) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logos[provider]} alt={provider} width={size} height={size} style={{ display: 'block', borderRadius: 2 }} />;
  }
  if (provider === 'mcp') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    );
  }
  if (provider === 'sandbox') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }
  if (provider === 'url') return <span style={{ fontSize: size * 0.85 }}>🌐</span>;
  if (provider === 'hackernews') return <span style={{ fontSize: size * 0.85 }}>🟠</span>;
  if (provider === 'posthog') return <span style={{ fontSize: size * 0.85 }}>🦔</span>;
  if (provider === 'google_search_console') return <span style={{ fontSize: size * 0.85 }}>📊</span>;
  if (provider === 'script') return <span style={{ fontSize: size * 0.85 }}>📜</span>;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr);
  const now = new Date();
  const secs = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (secs < 60) return 'Just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function scopePathToDataUrl(projectId: string, scopePath: string): string {
  const segments = scopePath.split('/').filter(Boolean);
  if (segments.length === 0) return `/projects/${projectId}/data`;
  return `/projects/${projectId}/data/${segments.map(encodeURIComponent).join('/')}`;
}

function ConnectorRow({
  connector,
  onClick,
}: {
  readonly connector: Connector;
  readonly onClick: () => void;
}) {
  const label = PROVIDER_LABELS[connector.provider] || connector.provider;
  const name = connector.name || label;
  const statusColor = STATUS_COLORS[connector.status] || '#71717a';
  const directionLabel = DIRECTION_LABELS[connector.direction] || connector.direction;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.02)',
        color: '#e4e4e7',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.12s, border-color 0.12s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <ProviderIcon provider={connector.provider} size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </div>
        <div style={{ fontSize: 11, color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label} · {directionLabel} · last run {timeAgo(connector.last_run_at)}
        </div>
      </div>
      <div
        title={connector.status}
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: statusColor,
          boxShadow: `0 0 8px ${statusColor}40`,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 11, color: '#a1a1aa', flexShrink: 0 }}>Open →</span>
    </button>
  );
}

function ScopeSection({
  scope,
  connectors,
  onItemClick,
  onAddClick,
}: {
  readonly scope: RepoScope;
  readonly connectors: readonly Connector[];
  readonly onItemClick: (c: Connector) => void;
  readonly onAddClick: () => void;
}) {
  const pathLabel = scope.path === '' ? '/ (root)' : `/${scope.path}`;
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px 16px',
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.015)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e4e4e7' }}>
            {scope.name}
          </span>
          <code
            style={{
              fontSize: 11,
              color: '#a1a1aa',
              padding: '2px 7px',
              borderRadius: 4,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {pathLabel}
          </code>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 4,
              color: scope.mode === 'rw' ? '#86efac' : '#a1a1aa',
              background: scope.mode === 'rw' ? 'rgba(134,239,172,0.08)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${scope.mode === 'rw' ? 'rgba(134,239,172,0.18)' : 'rgba(255,255,255,0.06)'}`,
            }}
          >
            {scope.mode === 'rw' ? 'RW' : 'R'}
          </span>
          {scope.is_root && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                color: '#a1a1aa',
                padding: '1px 6px',
                borderRadius: 4,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              Root
            </span>
          )}
          <span style={{ fontSize: 11, color: '#71717a' }}>
            · {connectors.length} integration{connectors.length === 1 ? '' : 's'}
          </span>
        </div>
        <button
          type="button"
          onClick={onAddClick}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 500,
            color: '#e4e4e7',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          + Add
        </button>
      </header>

      {connectors.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: '#71717a',
            padding: '10px 4px',
            fontStyle: 'italic',
          }}
        >
          No third party integrations in this scope yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {connectors.map((c) => (
            <ConnectorRow key={c.id} connector={c} onClick={() => onItemClick(c)} />
          ))}
        </div>
      )}
    </section>
  );
}

function LoadingState() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#525252',
        fontSize: 13,
      }}
    >
      Loading…
    </div>
  );
}

function NoScopesState({ onCreateScope }: { readonly onCreateScope: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 12,
        color: '#71717a',
        textAlign: 'center',
        padding: '0 32px',
      }}
    >
      <div style={{ fontSize: 14, color: '#a1a1aa' }}>No scopes yet.</div>
      <div style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 420 }}>
        Integrations are bound to scopes. Open the Data view, navigate to a
        folder, and turn it into a scope to start adding third-party
        integrations.
      </div>
      <button
        type="button"
        onClick={onCreateScope}
        style={{
          marginTop: 8,
          padding: '6px 14px',
          fontSize: 12,
          color: '#e4e4e7',
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        Open Data view
      </button>
    </div>
  );
}

export default function ThirdPartyIntegrationsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();

  const { data: scopes } = useSWR(
    projectId ? ['repo-scopes', projectId] : null,
    () => listScopes(projectId),
    { refreshInterval: 30000, revalidateOnFocus: false, dedupingInterval: 60000 },
  );
  const { data: connectors } = useSWR(
    projectId ? ['repo-connectors', projectId] : null,
    () => listConnectors(projectId),
    { refreshInterval: 30000, revalidateOnFocus: false, dedupingInterval: 60000 },
  );

  const scopeGroups = useMemo(() => {
    if (!scopes) return [];
    const thirdParty = (connectors || []).filter(
      (c) => !BUILTIN_PROVIDERS.has(c.provider),
    );
    return scopes.map((scope) => ({
      scope,
      items: thirdParty.filter((c) => c.scope_id === scope.id),
    }));
  }, [scopes, connectors]);

  const total = scopeGroups.reduce((n, g) => n + g.items.length, 0);
  const loading = scopes === undefined || connectors === undefined;
  const noScopes = !loading && scopeGroups.length === 0;

  return (
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
          height: 40,
          minHeight: 40,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          background: '#0e0e0e',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>
            Third Party Integrations
          </span>
          {!loading && (
            <span
              style={{
                fontSize: 11,
                padding: '1px 7px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.06)',
                color: '#a1a1aa',
              }}
            >
              {total}
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: '#71717a' }}>
          Add &amp; configure integrations from the Data view&apos;s right-side panel.
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 32px' }}>
        {loading ? (
          <LoadingState />
        ) : noScopes ? (
          <NoScopesState
            onCreateScope={() => router.push(`/projects/${projectId}/data`)}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              maxWidth: 880,
              margin: '0 auto',
            }}
          >
            {scopeGroups.map(({ scope, items }) => (
              <ScopeSection
                key={scope.id}
                scope={scope}
                connectors={items}
                onItemClick={(c) =>
                  router.push(
                    `${scopePathToDataUrl(projectId, scope.path)}?ap=${c.id}`,
                  )
                }
                onAddClick={() =>
                  router.push(scopePathToDataUrl(projectId, scope.path))
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
