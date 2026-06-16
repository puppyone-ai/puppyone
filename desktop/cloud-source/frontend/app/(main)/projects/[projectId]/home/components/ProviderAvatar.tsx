'use client';

import { useConnectorSpecs } from '@/lib/hooks/useData';
import { resolveProviderIconUrl } from '@/lib/providerIcons';
import { PROVIDER_LABELS, PROVIDER_COLORS } from '../lib/constants';
import { parseAgentIcon } from '../lib/format';

// Provider brand marks go through `resolveProviderIconUrl()`, which
// keeps known brands on local scalable assets and only uses backend
// `icon_url` for unknown providers. `filesystem` stays a local folder
// glyph because it is a built-in access surface, not a third-party brand.

function FolderMini({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--po-success)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block' }}
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

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

  if (provider === 'filesystem') {
    return <FolderMini size={size} />;
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
  const color = PROVIDER_COLORS[provider] || 'var(--po-text-muted)';
  const label = (PROVIDER_LABELS[provider] || provider).charAt(0).toUpperCase();
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
