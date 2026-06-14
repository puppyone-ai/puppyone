'use client';

import { useConnectorSpecs } from '@/lib/hooks/useData';
import {
  getAccessProviderLabel,
  normalizeConnectorProvider,
} from '@/lib/accessProviderRegistry';
import { PROVIDER_COLORS } from '../lib/constants';
import { parseAgentIcon } from '../lib/format';

// Single source of truth for provider brand marks: `connector_specs` from
// the backend, fetched via `useConnectorSpecs()`.  This mirrors the
// access drawer (`data/components/SyncConfigPanel.tsx`):
//   - providers with `icon_url` render that asset directly
//   - `agent` renders an emoji-on-chip avatar
// Any local hardcoded logo map drifts from the access surface the moment
// the backend ships a new connector, so we deliberately do NOT keep one
// here.  If a provider has no `icon_url`, we degrade to spec.icon (emoji)
// then to a single-letter chip.

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

  if (spec?.icon_url) {
    return (
      <img
        src={spec.icon_url}
        alt={spec.display_name || provider}
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
