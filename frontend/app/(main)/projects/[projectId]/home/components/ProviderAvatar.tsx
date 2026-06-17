'use client';

import { useConnectorSpecs } from '@/lib/hooks/useData';
import {
  getAccessProviderLabel,
  normalizeConnectorProvider,
} from '@/lib/accessProviderRegistry';
import { resolveProviderIconUrl } from '@/lib/providerIcons';
import { PROVIDER_COLORS } from '../lib/constants';
import { parseAgentIcon } from '../lib/format';

// Provider brand marks go through `resolveProviderIconUrl()`, which
// keeps known brands on local scalable assets and only uses backend
// `icon_url` for unknown providers.

export function ProviderAvatar({
  provider, size = 20, icon,
}: {
  provider: string;
  size?: number;
  icon?: string | null;
}) {
  const { specs } = useConnectorSpecs();

  if (provider === 'agent') {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: 'var(--po-border-subtle)',
        border: '1px solid var(--po-border-strong)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.6,
      }}>
        {parseAgentIcon(icon || null)}
      </div>
    );
  }

  const spec = specs.find(s => s.provider === provider);
  const iconUrl = resolveProviderIconUrl({
    provider,
    icon: spec?.icon,
    iconUrl: spec?.icon_url,
  });

  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={spec?.display_name || provider}
        width={size}
        height={size}
        style={{ display: 'block', objectFit: 'contain' }}
      />
    );
  }

  if (spec?.icon) {
    return (
      <span style={{
        fontSize: size * 0.75,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
      }}>
        {spec.icon}
      </span>
    );
  }

  // Last-resort letter chip — only hit for unknown providers that the
  // backend hasn't surfaced via /connector_specs at all.
  const normalizedProvider = normalizeConnectorProvider(provider);
  const color = PROVIDER_COLORS[normalizedProvider] || 'var(--po-text-muted)';
  const label = getAccessProviderLabel(normalizedProvider).charAt(0).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--po-border-subtle)',
      border: '1px solid var(--po-border-strong)',
      color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.55, fontWeight: 600,
    }}>
      {label}
    </div>
  );
}
