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
      background: selected
        ? 'color-mix(in srgb, #ef4a37 16%, var(--po-panel) 84%)'
        : 'color-mix(in srgb, #ef4a37 9%, var(--po-panel) 91%)',
      border: selected ? 'color-mix(in srgb, #ef4a37 34%, var(--po-border-strong) 66%)' : 'color-mix(in srgb, #ef4a37 22%, var(--po-border-subtle) 78%)',
      color: '#d94939',
      shadow: selected ? '0 1px 2px color-mix(in srgb, #ef4a37 18%, transparent)' : 'none',
    };
  }
  return {
    background: selected ? 'var(--po-panel)' : 'var(--po-hover)',
    border: selected ? 'var(--po-border-strong)' : T.border,
    color: T.text2,
    shadow: selected ? '0 1px 2px var(--po-shadow)' : 'none',
  };
}

export function getConnectorCardChrome(provider: string, selected: boolean) {
  if (isCliProvider(provider)) {
    return {
      accent: 'var(--po-accent)',
      border: selected ? 'color-mix(in srgb, var(--po-accent) 34%, var(--po-border-strong) 66%)' : T.cardBorder,
      background: selected
        ? 'color-mix(in srgb, var(--po-accent) 5%, var(--po-panel) 95%)'
        : 'var(--po-panel)',
    };
  }
  if (isGitRemoteProvider(provider)) {
    return {
      accent: '#ef4a37',
      border: selected ? 'color-mix(in srgb, #ef4a37 30%, var(--po-border-strong) 70%)' : T.cardBorder,
      background: selected
        ? 'color-mix(in srgb, #ef4a37 4%, var(--po-panel) 96%)'
        : 'var(--po-panel)',
    };
  }
  return {
    accent: 'var(--po-border-strong)',
    border: selected ? 'var(--po-border-strong)' : T.cardBorder,
    background: 'var(--po-panel)',
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
