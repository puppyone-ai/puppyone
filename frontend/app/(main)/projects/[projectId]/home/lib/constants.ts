// Provider-related constants used across Home subcomponents.

import type { ApDirection, DashboardConnection } from './types';

export const PROVIDER_LABELS: Record<string, string> = {
  filesystem: 'Desktop Sync', gmail: 'Gmail', google_sheets: 'Google Sheets',
  google_calendar: 'Google Calendar', google_docs: 'Google Docs', github: 'GitHub',
  supabase: 'Supabase', notion: 'Notion', linear: 'Linear',
  hackernews: 'Hacker News', posthog: 'PostHog',
  google_search_console: 'GSC', script: 'Script',
  agent: 'Agent', mcp: 'MCP Server', sandbox: 'Sandbox', url: 'Web Page',
};

export const PROVIDER_COLORS: Record<string, string> = {
  agent: 'var(--po-file-accent-audio)', mcp: 'var(--po-accent)', sandbox: 'var(--po-warning)', filesystem: 'var(--po-success)',
  gmail: 'var(--po-danger)', github: 'var(--po-text)', google_sheets: 'var(--po-success)', google_docs: 'var(--po-accent)',
  notion: 'var(--po-text)', supabase: 'var(--po-success)', url: 'var(--po-text-subtle)',
};

// Provider-based fallback for legacy rows where `connections.direction` is
// missing.  Truth-of-record is the backend `direction` column — see
// `getApDirection()` below.
export const OUTPUT_PROVIDERS = new Set(['agent', 'mcp', 'sandbox']);

export const isOutputProvider = (provider: string) => OUTPUT_PROVIDERS.has(provider);
export const isInputProvider = (provider: string) => !isOutputProvider(provider);

/** Normalize the wire `direction` (loose `string | null`) into a strict
 *  `ApDirection`.  Backend is the truth — only fall back to provider-based
 *  guessing if `direction` is missing/garbage (legacy rows). */
export function getApDirection(
  conn: Pick<DashboardConnection, 'direction' | 'provider'>
): ApDirection {
  const d = conn.direction?.toLowerCase();
  if (d === 'inbound' || d === 'outbound' || d === 'bidirectional') return d;
  return isOutputProvider(conn.provider) ? 'outbound' : 'inbound';
}

// Numeric agent icons get mapped to one of these emoji at render time so
// the avatar never shows a bare number. Index = `parseInt(icon) % len`.
export const AGENT_ICONS = [
  '🐗', '🐙', '🐷', '🦄', '🐧', '🦉', '🐼', '🐝', '🐸', '🐱',
];
