import type { Connector, RepoScope } from '@/lib/repoApi';
import type { SyncEndpointInfo } from '../explorer';

const PROVIDER_LABELS: Record<string, string> = {
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

export function providerLabel(provider: string): string {
  return (
    PROVIDER_LABELS[provider] ||
    provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

export function directionLabel(direction: string): string {
  if (direction === 'bidirectional') return 'Two-way';
  if (direction === 'inbound') return 'Import';
  if (direction === 'outbound') return 'Export';
  return direction || '—';
}

/**
 * Compact header meta line: `path · mode · excludes`. Empty path gets the
 * canonical `/` so the user can see at a glance whether they're at the
 * root scope or a subtree.
 */
export function buildScopeMetaLine(scope: RepoScope): string {
  const parts: string[] = [];
  parts.push(scope.path === '' ? '/' : `/${scope.path}`);
  parts.push(scope.mode === 'rw' ? 'Read & Write' : 'Read-only');
  if (scope.exclude && scope.exclude.length > 0) {
    parts.push(
      `${scope.exclude.length} exclude${scope.exclude.length === 1 ? '' : 's'}`,
    );
  }
  if (scope.is_root) parts.push('root');
  return parts.join(' · ');
}

/**
 * Map redesign provider strings (cli/agent) to the legacy SyncEndpointInfo
 * shape consumed by AccessPointProviderIcon. Keeps icon logic centralised
 * in the existing component without forking it.
 */
export function connectorAsEndpointShape(c: Connector): SyncEndpointInfo {
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

export function getApiBase(): string {
  if (globalThis.window === undefined) return process.env.NEXT_PUBLIC_API_URL || '';
  return process.env.NEXT_PUBLIC_API_URL || globalThis.location.origin;
}
