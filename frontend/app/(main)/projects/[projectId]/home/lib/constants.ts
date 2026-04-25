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
  agent: '#a78bfa', mcp: '#60a5fa', sandbox: '#f59e0b', filesystem: '#4ade80',
  gmail: '#ef4444', github: '#e4e4e7', google_sheets: '#22c55e', google_docs: '#3b82f6',
  notion: '#e4e4e7', supabase: '#3ECF8E', url: '#71717a',
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
