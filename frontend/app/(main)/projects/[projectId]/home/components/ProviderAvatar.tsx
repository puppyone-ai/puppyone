'use client';

import { useConnectorSpecs } from '@/lib/hooks/useData';
import { PROVIDER_LABELS, PROVIDER_COLORS } from '../lib/constants';
import { parseAgentIcon } from '../lib/format';

// Single source of truth for provider brand marks: `connector_specs` from
// the backend, fetched via `useConnectorSpecs()`.  This mirrors the
// access drawer (`data/components/SyncConfigPanel.tsx`):
//   - `filesystem` → local `FolderMini` SVG (green machine-folder mark)
//   - everything else → `<img src={spec.icon_url}>` painted directly
//   - `agent` → emoji-on-chip avatar
// Any local hardcoded logo map drifts from the access surface the moment
// the backend ships a new connector, so we deliberately do NOT keep one
// here.  If a provider has no `icon_url`, we degrade to spec.icon (emoji)
// then to a single-letter chip.

function FolderMini({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#34d399"
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
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.15)',
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
  const color = PROVIDER_COLORS[provider] || '#8b949e';
  const label = (PROVIDER_LABELS[provider] || provider).charAt(0).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.15)',
      color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.55, fontWeight: 600,
    }}>
      {label}
    </div>
  );
}
