// Provider-related constants used across Home subcomponents.

import {
  ACCESS_PROVIDER_LABELS,
  isAgentProvider,
  isMcpProvider,
  isSandboxProvider,
} from '@/lib/accessProviderRegistry';
import type { ApDirection, DashboardConnection } from './types';

export const PROVIDER_LABELS = ACCESS_PROVIDER_LABELS;

export const PROVIDER_COLORS: Record<string, string> = {
  agent: 'var(--po-file-accent-audio)', mcp: 'var(--po-accent)', sandbox: 'var(--po-warning)',
  git_remote: 'var(--po-success)', cli: 'var(--po-accent)',
  gmail: 'var(--po-danger)', github: 'var(--po-text)', google_sheets: 'var(--po-success)', google_docs: 'var(--po-accent)',
  notion: 'var(--po-text)', supabase: 'var(--po-success)', url: 'var(--po-text-subtle)',
};

// Provider-based fallback for legacy rows where `connections.direction` is
// missing. Truth-of-record is the backend `direction` column; provider category
// comes from the shared Access provider registry.
export const isOutputProvider = (provider: string) =>
  isAgentProvider(provider) || isMcpProvider(provider) || isSandboxProvider(provider);
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
