import type { Connector } from '@/lib/repoApi';
import { getAccessProviderCardTitle, isCliProvider, isGitRemoteProvider } from '@/lib/accessProviderRegistry';
import { T } from '../lib/tokens';

export function getConnectorDisplayName(connector: Connector): string {
  return getAccessProviderCardTitle(connector.provider, connector.name);
}

export function getProviderTileStyle(provider: string, selected: boolean) {
  if (isCliProvider(provider)) {
    return {
      background: 'var(--po-accent)',
      border: 'var(--po-accent)',
      color: 'var(--po-text-inverse)',
      shadow: '0 1px 2px var(--po-shadow)',
    };
  }
  if (isGitRemoteProvider(provider)) {
    return {
      background: 'var(--po-text-inverse)',
      border: selected ? 'var(--po-border-strong)' : T.border,
      color: T.text2,
      shadow: selected ? '0 1px 2px var(--po-shadow)' : 'none',
    };
  }
  return {
    background: selected ? 'var(--po-panel)' : 'var(--po-hover)',
    border: selected ? 'var(--po-border-strong)' : T.border,
    color: T.text2,
    shadow: selected ? '0 1px 2px var(--po-shadow)' : 'none',
  };
}

export function getProviderTileSize(provider: string): number {
  return isGitRemoteProvider(provider) ? 34 : 30;
}

export function getProviderIconSize(provider: string): number {
  if (isGitRemoteProvider(provider)) return 34;
  if (isCliProvider(provider)) return 17;
  return 15;
}

