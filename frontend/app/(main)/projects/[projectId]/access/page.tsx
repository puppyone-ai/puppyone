'use client';

/**
 * Access Points page — pixel-faithful migration of the puppyone-web
 * showcase's AccessView.
 *
 * Surface contract:
 *   - Master-detail layout: 280px sidebar (filter tabs + AP list) +
 *     a right detail pane (Identity, Scope, Quick Connect, Activity).
 *   - Single unified AP list — cli + agent + third-party integrations
 *     all live in the same sidebar, grouped by category. The earlier
 *     surface excluded built-ins (cli/agent) on the theory that the
 *     /data right panel was the canonical surface for them; review
 *     concluded that asymmetry was confusing — every actor that has a
 *     *connection* belongs here.
 *   - Pause / Resume wired to the dedicated backend endpoints
 *     (`/connectors/:id/pause` and `/resume`), revalidating the SWR
 *     cache afterwards so the status pill flips immediately.
 *   - The "Quick Connect" prompt is provider-aware: for cli/agent we
 *     reuse the `mut clone` prompt template (canonical, functional);
 *     for third-party connectors the panel surfaces a connection
 *     summary and links the user to the data view's right panel,
 *     which owns the actual auth/trigger config.
 *   - Recent activity is rendered as an empty state for now — the
 *     audit-log endpoint isn't AP-scoped yet. Wiring it up is on the
 *     follow-up backend pass (deliberately out of scope here per the
 *     "front-end first, back-end after" directive).
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  listConnectors,
  listScopes,
  pauseConnector,
  resumeConnector,
  type Connector,
  type RepoScope,
} from '@/lib/repoApi';
import { listDir, type NodeInfo } from '@/lib/contentTreeApi';

// ─── Tokens (inline so this page has no cross-file dependency) ──────

const T = {
  bg: '#0e0e0e',
  border: 'rgba(255,255,255,0.08)',
  cardBg: 'rgba(255,255,255,0.02)',
  cardBorder: 'rgba(255,255,255,0.06)',

  text1: '#fafafa',
  text2: '#a1a1aa',
  text3: '#52525b',
  text4: '#27272a',

  fontSans: 'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, sans-serif',
  fontMono: 'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

// ─── Domain constants ────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  cli: 'mut CLI',
  agent: 'AI Agent',
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

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  syncing: 'Syncing',
  error: 'Error',
  paused: 'Paused',
  pending: 'Pending',
};

// AP grouping. Maps each provider to a category that drives the
// sidebar's filter tabs and the type-line under each AP name.
//
// Order is the order tabs appear left-to-right.
type APGroupKey = 'cli' | 'agent' | 'mcp' | 'sandbox' | 'integration';
const AP_GROUP_ORDER: ReadonlyArray<{ key: APGroupKey; label: string }> = [
  { key: 'cli', label: 'CLI' },
  { key: 'agent', label: 'Agent' },
  { key: 'mcp', label: 'MCP' },
  { key: 'sandbox', label: 'Sandbox' },
  { key: 'integration', label: 'Third-party' },
] as const;

function getGroup(provider: string): APGroupKey {
  if (provider === 'cli') return 'cli';
  if (provider === 'agent') return 'agent';
  if (provider === 'mcp') return 'mcp';
  if (provider === 'sandbox') return 'sandbox';
  return 'integration';
}

// ─── Helpers ─────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function getApiBase(): string {
  if (globalThis.window === undefined) return process.env.NEXT_PUBLIC_API_URL || '';
  return process.env.NEXT_PUBLIC_API_URL || globalThis.location.origin;
}

function scopePathToDataUrl(projectId: string, scopePath: string): string {
  const segments = scopePath.split('/').filter(Boolean);
  if (segments.length === 0) return `/projects/${projectId}/data`;
  return `/projects/${projectId}/data/${segments.map(encodeURIComponent).join('/')}`;
}

function getAccentColor(c: Connector): string {
  // Accent driven by provider. Built-ins get neutral / functional
  // colors; third-party providers borrow the showcase's palette.
  switch (c.provider) {
    case 'agent': return '#a78bfa';
    case 'cli': return '#34d399';
    case 'filesystem': return '#34d399';
    case 'mcp': return '#60a5fa';
    case 'sandbox': return '#f59e0b';
    case 'github': return '#94a3b8';
    case 'notion': return '#e4e4e7';
    case 'gmail': return '#fb7185';
    default: return '#a1a1aa';
  }
}

function getTypeLine(c: Connector): string {
  const direction =
    c.direction === 'bidirectional' ? 'Two-way'
    : c.direction === 'inbound' ? 'Import'
    : c.direction === 'outbound' ? 'Export' : '';
  switch (c.provider) {
    case 'cli': return ['CLI agent', direction].filter(Boolean).join(' · ');
    case 'agent': return ['AI agent', direction].filter(Boolean).join(' · ');
    case 'mcp': return ['MCP server', direction].filter(Boolean).join(' · ');
    case 'sandbox': return ['Compute sandbox', direction].filter(Boolean).join(' · ');
    case 'filesystem': return 'Local filesystem';
    default: return [`Third-party · ${PROVIDER_LABELS[c.provider] ?? c.provider}`, direction].filter(Boolean).join(' · ');
  }
}

function getPrimaryAction(status: string): { label: string; icon: 'pause' | 'play' | 'retry'; tone: 'neutral' | 'warn' } {
  if (status === 'active' || status === 'syncing') return { label: 'Pause', icon: 'pause', tone: 'neutral' };
  if (status === 'paused' || status === 'pending') return { label: 'Resume', icon: 'play', tone: 'neutral' };
  if (status === 'error') return { label: 'Retry', icon: 'retry', tone: 'warn' };
  return { label: 'Resume', icon: 'play', tone: 'neutral' };
}

/**
 * Provider-aware connect prompt. For cli/agent we render the canonical
 * `mut clone` template; for everything else we surface a short summary
 * with a hint that auth/trigger config lives in the data view's right
 * panel (the canonical surface for third-party setup).
 */
function buildConnectPrompt(c: Connector, scope: RepoScope | undefined): string {
  const apiBase = getApiBase();
  const accessKey = scope?.access_key || '';
  const cloneUrl = `${apiBase}/mut/ap/${accessKey}`;
  const scopePath = scope?.path === '' ? '/' : `/${scope?.path ?? ''}`;
  const scopeName = scope?.name || (scope?.path === '' ? 'root' : (scope?.path ?? 'workspace'));
  const accessLabel = scope?.mode === 'rw' ? 'read and write' : 'read-only';

  if (c.provider === 'cli' || c.provider === 'agent' || c.provider === 'filesystem') {
    if (!accessKey) {
      return [
        `Sync my puppyone scope "${scopeName}" using the \`mut\` CLI.`,
        ``,
        `⚠ This scope has no access_key issued. Regenerate it from the data view's`,
        `   scope settings to enable CLI access. Once you have the key, the prompt`,
        `   below will fill in automatically.`,
      ].join('\n');
    }
    return [
      `Sync my puppyone scope "${scopeName}" using the \`mut\` CLI.`,
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
    ].join('\n');
  }

  if (c.provider === 'mcp') {
    return [
      `Register my puppyone MCP server in your toolset.`,
      ``,
      `Endpoint:    wss://mcp.puppyone.dev/v1`,
      `Workspace:   ${c.project_id}`,
      `Scope:       ${scopePath}  (${accessLabel})`,
      ``,
      `Initialize the connection over WebSocket; each tool call should`,
      `include the workspace id above. The full tool schema is published at`,
      `docs.puppyone.dev/mcp/v1. Confirm registration and list available`,
      `tools.`,
    ].join('\n');
  }

  if (c.provider === 'sandbox') {
    return [
      `Provision a puppyone sandbox tied to my workspace.`,
      ``,
      `Image:       puppyone-sandbox:python3.11`,
      `Region:      us-east-1`,
      `Workspace:   ${c.project_id}`,
      `Mount:       ${scopePath} → /workspace inside the container`,
      ``,
      `Run \`pup sandbox start --workspace ${c.project_id} --image python3.11\`.`,
      `The drive at ${scopePath} will be bind-mounted at /workspace; outputs`,
      `persist back to the drive as versioned commits attributed to "${c.name}".`,
    ].join('\n');
  }

  // Third-party fallback — informational, points to the configuration
  // surface in the data view rather than pretending to issue tokens.
  const providerLabel = PROVIDER_LABELS[c.provider] ?? c.provider;
  return [
    `Connect my ${providerLabel} as a puppyone source.`,
    ``,
    `Source:      ${c.name} (${providerLabel})`,
    `Scope:       ${scopePath}  (${accessLabel})`,
    `Direction:   ${c.direction}`,
    ``,
    `OAuth and trigger configuration for this connector live in the`,
    `data view's right-side panel — open ${scopePath || '/'} and click`,
    `into "${c.name}" to authorize, set sync triggers, and edit field`,
    `mappings. Once configured, ${providerLabel} content syncs into`,
    `${scopePath || '/'} as versioned commits.`,
  ].join('\n');
}

// ─── Icons ───────────────────────────────────────────────────────────

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
  if (provider === 'cli' || provider === 'filesystem') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }
  if (provider === 'agent') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v6m0 10v6m11-11h-6m-10 0H1m17.07-7.07l-4.24 4.24m-5.66 5.66l-4.24 4.24m12.73 0l-4.24-4.24m-5.66-5.66L1.93 4.93" />
      </svg>
    );
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
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 9l2 2-2 2M13 15h2" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

const PauseIcon = ({ size = 11 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
);
const PlayIcon = ({ size = 11 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
);
const RetryIcon = ({ size = 11 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);
const EditIcon = ({ size = 10 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" /></svg>
);
const ChevronRightIcon = ({ size = 10 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);
const MoreVerticalIcon = ({ size = 12 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
);
const FolderGlyph = ({ size = 11, color = T.text2 }: { readonly size?: number; readonly color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);
const FileGlyph = ({ size = 11, color = T.text3 }: { readonly size?: number; readonly color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
const CopyIcon = ({ size = 12 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

// ─── Chip system ─────────────────────────────────────────────────────

const CHIP_HEIGHT = 22;
const CHIP_RADIUS = 5;
const CHIP_FONT_SIZE = 11;
const CHIP_BUTTON_PADDING = '0 10px';
const CHIP_BADGE_PADDING = '0 8px';

function InlineActionButton({
  icon,
  children,
  onClick,
}: {
  readonly icon?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        height: CHIP_HEIGHT,
        padding: CHIP_BUTTON_PADDING,
        background: 'transparent',
        border: `1px solid ${T.border}`,
        borderRadius: CHIP_RADIUS,
        color: T.text3,
        fontSize: CHIP_FONT_SIZE,
        fontWeight: 500,
        fontFamily: T.fontSans,
        cursor: 'pointer',
        transition: `background 0.15s ${T.ease}, color 0.15s ${T.ease}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        e.currentTarget.style.color = T.text1;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = T.text3;
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function PermBadge({ label, active, accent }: { readonly label: string; readonly active: boolean; readonly accent: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: CHIP_HEIGHT,
        padding: CHIP_BADGE_PADDING,
        borderRadius: CHIP_RADIUS,
        background: active ? `${accent}26` : 'transparent',
        border: `1px solid ${active ? `${accent}55` : T.border}`,
        color: active ? accent : T.text4,
        fontSize: CHIP_FONT_SIZE,
        fontWeight: 500,
        fontFamily: T.fontSans,
        letterSpacing: '0.02em',
      }}
    >
      {label}
    </span>
  );
}

// ─── Layout primitives ───────────────────────────────────────────────

function SectionLabel({ children, right }: { readonly children: React.ReactNode; readonly right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingLeft: 2 }}>
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          color: T.text3,
          fontFamily: T.fontSans,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {children}
      </span>
      {right}
    </div>
  );
}

// ─── Header ──────────────────────────────────────────────────────────

function AccessHeader({ count }: { readonly count: number }) {
  return (
    <div
      style={{
        height: 46,
        minHeight: 46,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        background: '#0e0e0e',
        flexShrink: 0,
        fontFamily: T.fontSans,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#e4e4e7' }}>Access</span>
        <span
          style={{
            fontSize: 11,
            padding: '1px 7px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.06)',
            color: '#a1a1aa',
          }}
        >
          {count}
        </span>
      </div>
    </div>
  );
}

// ─── Filter tabs ─────────────────────────────────────────────────────

function FilterTabs({
  active,
  groupCounts,
  onChange,
}: {
  readonly active: APGroupKey | null;
  readonly groupCounts: Map<APGroupKey, number>;
  readonly onChange: (g: APGroupKey | null) => void;
}) {
  const total = Array.from(groupCounts.values()).reduce((n, v) => n + v, 0);
  const tabBase: React.CSSProperties = {
    flexShrink: 0,
    padding: '4px 10px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    fontFamily: T.fontSans,
    transition: 'background 0.15s, color 0.15s',
    cursor: 'pointer',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  };

  return (
    <div
      style={{
        height: 40,
        minHeight: 40,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: '#0e0e0e',
        overflowX: 'auto',
        scrollbarWidth: 'none',
      }}
      className="puppyone-access-filter-tabs"
    >
      <button
        onClick={() => onChange(null)}
        style={{
          ...tabBase,
          background: active === null ? '#1a1a1a' : 'transparent',
          color: active === null ? '#eee' : '#71717a',
        }}
      >
        All
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1,
            padding: '2px 5px',
            borderRadius: 3,
            background: active === null ? '#222' : '#111',
            color: active === null ? '#888' : '#666',
            border: `1px solid ${active === null ? '#333' : '#222'}`,
          }}
        >
          {total}
        </span>
      </button>
      {AP_GROUP_ORDER.map((g) => {
        const count = groupCounts.get(g.key) ?? 0;
        if (count === 0) return null;
        const isSelected = active === g.key;
        return (
          <button
            key={g.key}
            onClick={() => onChange(g.key)}
            style={{
              ...tabBase,
              background: isSelected ? '#1a1a1a' : 'transparent',
              color: isSelected ? '#eee' : '#71717a',
            }}
          >
            {g.label}
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1,
                padding: '2px 5px',
                borderRadius: 3,
                background: isSelected ? '#222' : '#111',
                color: isSelected ? '#888' : '#666',
                border: `1px solid ${isSelected ? '#333' : '#222'}`,
              }}
            >
              {count}
            </span>
          </button>
        );
      })}
      <style>{`
        .puppyone-access-filter-tabs::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

// ─── Sidebar row ─────────────────────────────────────────────────────

function SidebarRow({
  connector,
  isSelected,
  onClick,
}: {
  readonly connector: Connector;
  readonly isSelected: boolean;
  readonly onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const statusColor = STATUS_COLORS[connector.status] ?? '#71717a';
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        margin: '0 6px',
        height: 30,
        padding: '0 10px',
        gap: 8,
        cursor: 'pointer',
        userSelect: 'none',
        borderRadius: 6,
        background: isSelected ? '#2a2a2a' : hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
        color: isSelected ? '#fff' : hovered ? '#d4d4d4' : '#a1a1aa',
        transition: 'background 0.1s, color 0.1s',
      }}
    >
      <div style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <ProviderIcon provider={connector.provider} size={14} />
      </div>
      <span
        style={{
          flex: 1,
          fontSize: 13,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontFamily: T.fontSans,
        }}
      >
        {connector.name || PROVIDER_LABELS[connector.provider] || connector.provider}
      </span>
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: statusColor,
          boxShadow: `0 0 8px ${statusColor}66`,
          flexShrink: 0,
        }}
        title={connector.status}
      />
    </div>
  );
}

// ─── Identity row ────────────────────────────────────────────────────

function IdentityRow({
  connector,
  onPauseResume,
  pending,
}: {
  readonly connector: Connector;
  readonly onPauseResume: () => void;
  readonly pending: boolean;
}) {
  const accent = getAccentColor(connector);
  const statusColor = STATUS_COLORS[connector.status] ?? T.text3;
  const action = getPrimaryAction(connector.status);
  const name = connector.name || PROVIDER_LABELS[connector.provider] || connector.provider;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 7,
          background: `${accent}1c`,
          border: `1px solid ${accent}33`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <ProviderIcon provider={connector.provider} size={16} />
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: T.text1,
              fontFamily: T.fontSans,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {name}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            color: T.text3,
            fontFamily: T.fontSans,
            minWidth: 0,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {getTypeLine(connector)}
          </span>
          <span style={{ color: T.text4 }}>·</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: statusColor,
                boxShadow: `0 0 6px ${statusColor}88`,
              }}
            />
            <span style={{ color: statusColor, fontWeight: 500 }}>{STATUS_LABEL[connector.status] ?? connector.status}</span>
          </div>
          <span style={{ color: T.text4 }}>·</span>
          <span style={{ color: T.text4, flexShrink: 0 }}>{timeAgo(connector.last_run_at)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onPauseResume}
          disabled={pending}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            height: 26,
            padding: '0 10px',
            background: action.tone === 'warn' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${action.tone === 'warn' ? 'rgba(239,68,68,0.3)' : T.border}`,
            borderRadius: 5,
            color: action.tone === 'warn' ? '#fca5a5' : T.text2,
            fontSize: 11,
            fontWeight: 500,
            fontFamily: T.fontSans,
            cursor: pending ? 'wait' : 'pointer',
            opacity: pending ? 0.6 : 1,
            transition: `background 0.15s ${T.ease}, color 0.15s ${T.ease}`,
          }}
          onMouseEnter={(e) => {
            if (pending) return;
            e.currentTarget.style.background = action.tone === 'warn' ? 'rgba(239,68,68,0.14)' : 'rgba(255,255,255,0.09)';
            e.currentTarget.style.color = action.tone === 'warn' ? '#fecaca' : T.text1;
          }}
          onMouseLeave={(e) => {
            if (pending) return;
            e.currentTarget.style.background = action.tone === 'warn' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.05)';
            e.currentTarget.style.color = action.tone === 'warn' ? '#fca5a5' : T.text2;
          }}
        >
          {action.icon === 'pause' && <PauseIcon size={10} />}
          {action.icon === 'play' && <PlayIcon size={10} />}
          {action.icon === 'retry' && <RetryIcon size={10} />}
          {action.label}
        </button>

        <button
          type="button"
          aria-label="More"
          style={{
            width: 26,
            height: 26,
            background: 'transparent',
            border: `1px solid ${T.border}`,
            borderRadius: 5,
            color: T.text3,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: `background 0.15s ${T.ease}, color 0.15s ${T.ease}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
            e.currentTarget.style.color = T.text1;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = T.text3;
          }}
        >
          <MoreVerticalIcon size={12} />
        </button>
      </div>
    </div>
  );
}

// ─── Scope card with file-tree preview ───────────────────────────────

const SCOPE_ROWS_LIMIT = 4;

type ScopePreviewRow =
  | { kind: 'folder'; name: string; count: number | null }
  | { kind: 'file'; name: string }
  | { kind: 'empty' };

interface ScopePreview {
  rows: ScopePreviewRow[];
  hiddenCount: number;
  totalChildren: number;
  isWorkspaceWide: boolean;
}

function nodesToPreview(nodes: NodeInfo[], scopePath: string): ScopePreview {
  const isWorkspaceWide = scopePath === '' || scopePath === '/';
  if (nodes.length === 0) {
    return { rows: [{ kind: 'empty' }], hiddenCount: 0, totalChildren: 0, isWorkspaceWide };
  }
  const sorted = [...nodes].sort((a, b) => {
    const af = a.type === 'folder' ? 0 : 1;
    const bf = b.type === 'folder' ? 0 : 1;
    if (af !== bf) return af - bf;
    return a.name.localeCompare(b.name);
  });
  const slice = sorted.slice(0, SCOPE_ROWS_LIMIT);
  const rows: ScopePreviewRow[] = slice.map((n) =>
    n.type === 'folder'
      ? { kind: 'folder', name: n.name, count: n.children_count }
      : { kind: 'file', name: n.name }
  );
  return {
    rows,
    hiddenCount: Math.max(0, sorted.length - SCOPE_ROWS_LIMIT),
    totalChildren: sorted.length,
    isWorkspaceWide,
  };
}

// L-shape elbow connector. Same geometry as the showcase: 1px crisp
// SVG rects so the rows read as branches under the path header.
const ELBOW_STEM_X = 20;
const ELBOW_HOOK_END = 28;
const ELBOW_COLOR = '#27272a';
const ELBOW_ROW_HEIGHT = 22;
const ELBOW_HOOK_Y = 11;

function ScopeRowElbow({ isLast }: { readonly isLast: boolean }) {
  return (
    <svg
      width={ELBOW_HOOK_END}
      height={ELBOW_ROW_HEIGHT}
      viewBox={`0 0 ${ELBOW_HOOK_END} ${ELBOW_ROW_HEIGHT}`}
      shapeRendering="crispEdges"
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 0 }}
      aria-hidden
    >
      <rect x={ELBOW_STEM_X} y={0} width={1} height={isLast ? ELBOW_HOOK_Y : ELBOW_ROW_HEIGHT} fill={ELBOW_COLOR} />
      <rect x={ELBOW_STEM_X} y={ELBOW_HOOK_Y} width={ELBOW_HOOK_END - ELBOW_STEM_X} height={1} fill={ELBOW_COLOR} />
    </svg>
  );
}

function ScopePreviewRowView({ row, isLast }: { readonly row: ScopePreviewRow; readonly isLast: boolean }) {
  if (row.kind === 'empty') {
    return (
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: ELBOW_ROW_HEIGHT,
          padding: '0 14px 0 30px',
          color: T.text4,
          fontSize: 11.5,
          fontFamily: T.fontSans,
          fontStyle: 'italic',
        }}
      >
        <ScopeRowElbow isLast />
        empty
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: ELBOW_ROW_HEIGHT,
        padding: '0 14px 0 30px',
        color: T.text3,
        fontSize: 11.5,
        fontFamily: T.fontSans,
      }}
    >
      <ScopeRowElbow isLast={isLast} />
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, flexShrink: 0 }}>
        {row.kind === 'folder' ? <FolderGlyph size={12} /> : <FileGlyph size={12} />}
      </span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.name}
      </span>
      {row.kind === 'folder' && row.count !== null && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 10.5,
            color: T.text4,
            fontFamily: T.fontMono,
            letterSpacing: '0.02em',
          }}
        >
          {row.count} items
        </span>
      )}
    </div>
  );
}

function ScopeSection({
  connector,
  scope,
  projectId,
  onEdit,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope | undefined;
  readonly projectId: string;
  readonly onEdit: () => void;
}) {
  const accent = getAccentColor(connector);
  const isReadWrite = scope?.mode === 'rw';
  const path = scope?.path === '' ? '/' : `/${scope?.path ?? ''}`;

  // Fetch the scope folder's listing for the file-tree preview. Cap
  // by the row limit; if the folder is huge we still get a footer
  // "+N more" hint via totalChildren.
  const { data: dirResp } = useSWR(
    scope && projectId ? ['repo-scope-listing', projectId, scope.path] : null,
    () => listDir(projectId, scope!.path || ''),
    { refreshInterval: 0, revalidateOnFocus: false, dedupingInterval: 60000 },
  );

  const preview = useMemo<ScopePreview>(() => {
    if (!scope) {
      return { rows: [], hiddenCount: 0, totalChildren: 0, isWorkspaceWide: false };
    }
    if (!dirResp) {
      return { rows: [], hiddenCount: 0, totalChildren: 0, isWorkspaceWide: scope.path === '' };
    }
    return nodesToPreview(dirResp.nodes, scope.path);
  }, [dirResp, scope]);

  let footer: string | null = null;
  if (preview.hiddenCount > 0) footer = `… and ${preview.hiddenCount} more`;
  else if (preview.isWorkspaceWide && preview.totalChildren > 0) footer = `${preview.totalChildren} top-level entries · workspace-wide`;

  return (
    <div style={{ marginBottom: 16 }}>
      <SectionLabel
        right={
          <InlineActionButton icon={<EditIcon size={9} />} onClick={onEdit}>
            Edit
          </InlineActionButton>
        }
      >
        Scope
      </SectionLabel>

      <div
        style={{
          background: T.cardBg,
          border: `1px solid ${T.cardBorder}`,
          borderRadius: 8,
          boxShadow: `inset 0 1px 0 ${accent}1c`,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', height: 36, padding: '0 14px', gap: 10 }}>
          <FolderGlyph size={13} color={T.text2} />
          <span style={{ flex: 1, fontSize: 12.5, color: T.text1, fontFamily: T.fontSans, fontWeight: 500 }}>
            {path}
          </span>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <PermBadge label="read" active={!!scope} accent={accent} />
            <PermBadge label="write" active={!!isReadWrite} accent={accent} />
          </div>
        </div>

        {preview.rows.length > 0 && (
          <>
            <div style={{ height: 1, background: T.cardBorder, margin: '0 14px' }} />
            <div style={{ padding: '4px 0 6px' }}>
              {preview.rows.map((row, i) => (
                <ScopePreviewRowView key={i} row={row} isLast={i === preview.rows.length - 1} />
              ))}
            </div>
          </>
        )}

        {footer && (
          <div
            style={{
              padding: '6px 14px 9px',
              fontSize: 10.5,
              color: T.text4,
              fontFamily: T.fontSans,
              letterSpacing: '0.02em',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Quick connect ───────────────────────────────────────────────────

function QuickConnectSection({
  connector,
  scope,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const prompt = useMemo(() => buildConnectPrompt(connector, scope), [connector, scope]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — silent */
    }
  }, [prompt]);

  return (
    <div style={{ marginBottom: 14 }}>
      <SectionLabel>Quick Connect</SectionLabel>

      <div
        style={{
          position: 'relative',
          background: '#08080a',
          border: `1px solid ${T.cardBorder}`,
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: 'inset 0 1px 0 rgba(0,0,0,0.4)',
        }}
      >
        <pre
          style={{
            margin: 0,
            padding: '12px 14px',
            fontSize: 11,
            lineHeight: 1.55,
            color: T.text2,
            fontFamily: T.fontMono,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            height: 138,
            overflow: 'hidden',
            background: 'transparent',
            letterSpacing: '0.01em',
          }}
        >
          {prompt}
        </pre>

        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 86,
            background: 'linear-gradient(180deg, rgba(8,8,10,0) 0%, #08080a 55%)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            paddingBottom: 12,
          }}
        >
          <button
            type="button"
            onClick={handleCopy}
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 26,
              padding: '0 12px',
              background: copied ? 'rgba(74,222,128,0.16)' : 'rgba(255,255,255,0.10)',
              border: `1px solid ${copied ? 'rgba(74,222,128,0.32)' : 'rgba(255,255,255,0.22)'}`,
              borderRadius: 6,
              color: copied ? '#86efac' : T.text1,
              fontSize: 11.5,
              fontWeight: 600,
              fontFamily: T.fontSans,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.2)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              transition: `background 0.15s ${T.ease}, transform 0.15s ${T.ease}, border-color 0.15s ${T.ease}`,
            }}
            onMouseEnter={(e) => {
              if (copied) return;
              e.currentTarget.style.background = 'rgba(255,255,255,0.16)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.32)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              if (copied) return;
              e.currentTarget.style.background = 'rgba(255,255,255,0.10)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <CopyIcon size={12} />
            {copied ? 'Copied' : 'Copy connect prompt'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Activity ────────────────────────────────────────────────────────

function ActivitySection({ connector }: { readonly connector: Connector }) {
  // Backend doesn't yet expose AP-scoped activity. Empty state is the
  // honest surface; flipping to a real feed is a follow-up wiring pass.
  // The InlineActionButton "View all" jumps to /monitor — once activity
  // is wired in line, we can deep-link to a filtered Monitor view.
  void connector;
  return (
    <div>
      <SectionLabel
        right={
          <InlineActionButton icon={<ChevronRightIcon size={9} />}>
            View all
          </InlineActionButton>
        }
      >
        Recent activity
      </SectionLabel>

      <div
        style={{
          padding: '8px 2px',
          fontSize: 11.5,
          color: T.text4,
          fontFamily: T.fontSans,
          fontStyle: 'italic',
        }}
      >
        No activity tracked for this access point yet.
      </div>
    </div>
  );
}

// ─── Detail pane root ────────────────────────────────────────────────

function APDetailPanel({
  connector,
  scope,
  projectId,
  onPauseResume,
  pendingPauseResume,
  onEditScope,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope | undefined;
  readonly projectId: string;
  readonly onPauseResume: () => void;
  readonly pendingPauseResume: boolean;
  readonly onEditScope: () => void;
}) {
  return (
    <div
      key={connector.id}
      style={{
        flex: 1,
        minWidth: 0,
        overflow: 'auto',
        background: T.bg,
        padding: '16px 20px',
        animation: `puppyone-access-fade-in 200ms ${T.ease}`,
      }}
    >
      <IdentityRow connector={connector} onPauseResume={onPauseResume} pending={pendingPauseResume} />
      <div style={{ height: 1, background: T.border, marginBottom: 14 }} />
      <ScopeSection connector={connector} scope={scope} projectId={projectId} onEdit={onEditScope} />
      <QuickConnectSection connector={connector} scope={scope} />
      <ActivitySection connector={connector} />

      <style>{`
        @keyframes puppyone-access-fade-in {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Empty / loading states ──────────────────────────────────────────

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

function NoConnectorsState({ onCreateScope }: { readonly onCreateScope: () => void }) {
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
      <div style={{ fontSize: 14, color: '#a1a1aa' }}>No access points yet.</div>
      <div style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 420 }}>
        Access points let agents, CLIs, and third-party services read or write
        your workspace. Open the Data view to bind a folder as a scope and add
        your first integration.
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

// ─── Page root ───────────────────────────────────────────────────────

export default function AccessPointsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();

  const { data: scopes, mutate: mutateScopes } = useSWR(
    projectId ? ['repo-scopes', projectId] : null,
    () => listScopes(projectId),
    { refreshInterval: 30000, revalidateOnFocus: false, dedupingInterval: 60000 },
  );
  const { data: connectors, mutate: mutateConnectors } = useSWR(
    projectId ? ['repo-connectors', projectId] : null,
    () => listConnectors(projectId),
    { refreshInterval: 30000, revalidateOnFocus: false, dedupingInterval: 60000 },
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<APGroupKey | null>(null);
  const [pausePending, setPausePending] = useState(false);

  // Sort: built-ins (cli, agent) first, then by created_at. Mirrors
  // sortConnectorsBuiltinFirst but applied at view layer so we can
  // inject the filter cleanly afterwards.
  const sortedConnectors = useMemo(() => {
    if (!connectors) return [];
    return [...connectors].sort((a, b) => {
      const order = (c: Connector) => (c.provider === 'cli' ? 0 : c.provider === 'agent' ? 1 : 2);
      return order(a) - order(b) || a.created_at.localeCompare(b.created_at);
    });
  }, [connectors]);

  const groupCounts = useMemo(() => {
    const m = new Map<APGroupKey, number>();
    sortedConnectors.forEach((c) => {
      const g = getGroup(c.provider);
      m.set(g, (m.get(g) ?? 0) + 1);
    });
    return m;
  }, [sortedConnectors]);

  const filtered = useMemo(() => {
    return filter ? sortedConnectors.filter((c) => getGroup(c.provider) === filter) : sortedConnectors;
  }, [sortedConnectors, filter]);

  // Auto-pick a default selection on first load. Effect (rather than
  // initial state) so when /access is mounted and connectors arrive
  // asynchronously we still anchor to a real id.
  useEffect(() => {
    if (selectedId) return;
    const first = filtered[0] ?? sortedConnectors[0];
    if (first) setSelectedId(first.id);
  }, [filtered, sortedConnectors, selectedId]);

  const effectiveSelected = useMemo(() => {
    if (!selectedId) return filtered[0] ?? sortedConnectors[0];
    const inFiltered = filtered.find((c) => c.id === selectedId);
    if (inFiltered) return inFiltered;
    return filtered[0] ?? sortedConnectors.find((c) => c.id === selectedId) ?? sortedConnectors[0];
  }, [filtered, sortedConnectors, selectedId]);

  const selectedScope = useMemo(
    () => scopes?.find((s) => s.id === effectiveSelected?.scope_id),
    [scopes, effectiveSelected],
  );

  const handlePauseResume = useCallback(async () => {
    if (!effectiveSelected || pausePending) return;
    setPausePending(true);
    try {
      const isActive = effectiveSelected.status === 'active' || effectiveSelected.status === 'syncing';
      if (isActive) {
        await pauseConnector(projectId, effectiveSelected.id);
      } else {
        await resumeConnector(projectId, effectiveSelected.id);
      }
      await mutateConnectors();
    } catch (err) {
      console.error('Failed to toggle connector status:', err);
    } finally {
      setPausePending(false);
    }
  }, [effectiveSelected, pausePending, projectId, mutateConnectors]);

  const handleEditScope = useCallback(() => {
    if (!selectedScope) return;
    router.push(scopePathToDataUrl(projectId, selectedScope.path));
  }, [router, projectId, selectedScope]);

  const loading = scopes === undefined || connectors === undefined;
  const noConnectors = !loading && sortedConnectors.length === 0;

  // Suppress unused-var warning for mutateScopes — kept for future
  // wiring when scope edit returns inline.
  void mutateScopes;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0e0e0e' }}>
      <AccessHeader count={loading ? 0 : sortedConnectors.length} />

      {loading ? (
        <LoadingState />
      ) : noConnectors ? (
        <NoConnectorsState onCreateScope={() => router.push(`/projects/${projectId}/data`)} />
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left sidebar */}
          <div
            style={{
              width: 280,
              flexShrink: 0,
              borderRight: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              flexDirection: 'column',
              background: '#0e0e0e',
            }}
          >
            <FilterTabs active={filter} groupCounts={groupCounts} onChange={setFilter} />
            <div style={{ flex: 1, overflow: 'auto', paddingTop: 8 }}>
              {filtered.map((c) => (
                <SidebarRow
                  key={c.id}
                  connector={c}
                  isSelected={c.id === effectiveSelected?.id}
                  onClick={() => setSelectedId(c.id)}
                />
              ))}
            </div>
          </div>

          {/* Right detail pane */}
          {effectiveSelected ? (
            <APDetailPanel
              connector={effectiveSelected}
              scope={selectedScope}
              projectId={projectId}
              onPauseResume={handlePauseResume}
              pendingPauseResume={pausePending}
              onEditScope={handleEditScope}
            />
          ) : (
            <div style={{ flex: 1, background: T.bg }} />
          )}
        </div>
      )}
    </div>
  );
}
