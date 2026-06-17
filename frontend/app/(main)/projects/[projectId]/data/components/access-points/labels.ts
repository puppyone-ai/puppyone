import type { Connector, RepoScope } from '@/lib/repoApi';
import {
  getAccessProviderLabel,
  isAgentProvider,
  normalizeConnectorProvider,
} from '@/lib/accessProviderRegistry';
import type { SyncEndpointInfo } from '../explorer';

export function providerLabel(provider: string): string {
  return getAccessProviderLabel(provider);
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

/** Build the endpoint-shaped value consumed by AccessPointProviderIcon. */
export function connectorAsEndpointShape(c: Connector): SyncEndpointInfo {
  let iconProvider: string;
  if (isAgentProvider(c.provider)) iconProvider = 'agent:chat';
  else iconProvider = normalizeConnectorProvider(c.provider);
  return {
    syncId: c.id,
    provider: iconProvider,
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
