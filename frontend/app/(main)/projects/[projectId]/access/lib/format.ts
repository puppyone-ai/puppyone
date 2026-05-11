/**
 * Pure helpers + page-local types for the access page.
 *
 * Anything in this file is React-free: helpers can be unit-tested
 * in isolation, types describe shapes the UI components consume.
 *
 * Originally inlined at the top of `page.tsx` (lines 116-180,
 * 1498-1505, 1622-1653, 1671-1694, 1994-2000 in the legacy file).
 */

import type { Connector } from '@/lib/repoApi';
import type { NodeInfo } from '@/lib/contentTreeApi';
import { accessPointProfileSlug } from '@/lib/accessPointCliPrompt';
import {
  PROVIDER_LABELS,
  type ConnectorGroupKey,
} from './constants';
import { SCOPE_ROWS_LIMIT } from './tokens';

// ─── Types ───────────────────────────────────────────────────────────

export interface ConfigRow {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}

export type ScopePreviewRow =
  | { kind: 'folder'; name: string; count: number | null }
  | { kind: 'file'; name: string }
  | { kind: 'empty' };

export interface ScopePreview {
  rows: ScopePreviewRow[];
  hiddenCount: number;
  totalChildren: number;
  isWorkspaceWide: boolean;
}

// ─── Time / URL helpers ──────────────────────────────────────────────

export function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function getApiBase(): string {
  if (globalThis.window === undefined) return process.env.NEXT_PUBLIC_API_URL || '';
  return process.env.NEXT_PUBLIC_API_URL || globalThis.location.origin;
}

export function scopePathToDataUrl(projectId: string, scopePath: string): string {
  const segments = scopePath.split('/').filter(Boolean);
  if (segments.length === 0) return `/projects/${projectId}/data`;
  return `/projects/${projectId}/data/${segments.map(encodeURIComponent).join('/')}`;
}

// `getAccentColor` previously sprayed a per-provider accent (cli=green,
// agent=purple, mcp=blue, sandbox=orange, …) onto IdentityRow's avatar
// box, the Scope card's top highlight, and the read/write badges. The
// page already speaks "what kind of connector is this" through the
// ProviderIcon glyph and the type-line below the title — re-encoding it
// in three more places turned the surface into a noisy mood-board with
// no clear hierarchy. We've removed that helper and pinned everything
// neutral; the only colored signal that survives is the status dot
// (active/syncing/error/paused), which carries actionable meaning.

// ─── Connector descriptors ───────────────────────────────────────────

export function getTypeLine(c: Connector): string {
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

export function getPrimaryAction(status: string): { label: string; icon: 'pause' | 'play' | 'retry'; tone: 'neutral' | 'warn' } {
  if (status === 'active' || status === 'syncing') return { label: 'Pause', icon: 'pause', tone: 'neutral' };
  if (status === 'paused' || status === 'pending') return { label: 'Resume', icon: 'play', tone: 'neutral' };
  if (status === 'error') return { label: 'Retry', icon: 'retry', tone: 'warn' };
  return { label: 'Resume', icon: 'play', tone: 'neutral' };
}

// `buildConnectPrompt` used to be a per-provider switch returning a
// single "connect prompt" string. That sounded right but produced a
// terrible UX: pasting "Sync my puppyone scope using mut CLI" into
// ChatGPT for an *AI Agent* connector makes no sense — agents are
// PuppyOne's own in-app chat, they aren't driven by external prompts.
// We deleted the helper and now render a per-provider body component
// (`ConnectorAccessPanel`) instead, mirroring `ConnectMethods` in the
// data view: cli + filesystem render a prompt + install steps; agent
// renders an Activate / Open chat card; mcp/sandbox/3p render the
// minimal config they actually need.

// ─── Slug ────────────────────────────────────────────────────────────

export function profileSlug(name: string): string {
  return accessPointProfileSlug(name);
}

// ─── Connector configuration table ───────────────────────────────────

export function buildConfigRows(c: Connector): ConfigRow[] {
  const direction =
    c.direction === 'bidirectional' ? 'Two-way (read & write)'
    : c.direction === 'inbound' ? 'Inbound (import to workspace)'
    : c.direction === 'outbound' ? 'Outbound (export from workspace)' : '—';

  const triggerSummary = (() => {
    const t = c.trigger ?? {};
    if (Object.keys(t).length === 0) return null;
    const cronOrInterval =
      typeof t.cron === 'string' ? `cron: ${t.cron}` :
      typeof t.interval === 'string' ? `every ${t.interval}` :
      typeof t.mode === 'string' ? `mode: ${t.mode}` : null;
    return cronOrInterval ?? 'Custom';
  })();

  const rows: ConfigRow[] = [
    { label: 'Provider', value: PROVIDER_LABELS[c.provider] ?? c.provider, mono: false },
    { label: 'Direction', value: direction },
    { label: 'Trigger', value: triggerSummary ?? 'Manual', muted: !triggerSummary },
    { label: 'OAuth', value: c.oauth_connection_id != null ? `connected · #${c.oauth_connection_id}` : 'Not used', muted: c.oauth_connection_id == null, mono: c.oauth_connection_id != null },
    { label: 'Last run', value: c.last_run_at ? `${timeAgo(c.last_run_at)} (${c.last_run_id ? c.last_run_id.slice(0, 8) : '—'})` : 'Never', muted: !c.last_run_at, mono: !!c.last_run_at },
    { label: 'Connector ID', value: c.id, mono: true },
    { label: 'Created', value: c.created_at ? new Date(c.created_at).toLocaleString() : '—', muted: !c.created_at },
  ];

  if (c.error_message) {
    rows.push({ label: 'Error', value: c.error_message });
  }

  return rows;
}

// ─── File-tree preview for a scope ───────────────────────────────────

export function nodesToPreview(nodes: NodeInfo[], scopePath: string): ScopePreview {
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

// ─── Connector group bucket ──────────────────────────────────────────

export function getConnectorGroup(provider: string): ConnectorGroupKey {
  if (provider === 'cli') return 'cli';
  if (provider === 'agent') return 'agent';
  if (provider === 'filesystem') return 'filesystem';
  if (provider === 'mcp') return 'mcp';
  if (provider === 'sandbox') return 'sandbox';
  return 'integration';
}
