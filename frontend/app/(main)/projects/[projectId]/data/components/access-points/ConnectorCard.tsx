'use client';

import { useMemo, useState } from 'react';
import type { Connector } from '@/lib/repoApi';
import { AccessPointProviderIcon, StatusDot } from './AccessPointProviderIcon';
import {
  connectorAsEndpointShape,
  directionLabel,
  providerLabel,
} from './labels';
import {
  COLOR_BG_CARD,
  COLOR_BG_HOVER,
  COLOR_BORDER,
  COLOR_BORDER_HOVER,
  COLOR_FG,
  COLOR_FG_DIM,
} from './tokens';
import type { ProviderIconLookup } from './types';

/**
 * ConnectorCard — third-party-only connector row.
 *
 * cli + agent built-ins are NOT rendered here; ConnectMethodsBlock owns
 * those. This card just shows the provider icon, name, direction, status,
 * and bubbles the click up to the parent for routing into the
 * sync_config detail panel.
 */
export function ConnectorCard({
  connector,
  providerIcons,
  onClick,
  onHoverEnter,
  onHoverLeave,
}: {
  readonly connector: Connector;
  readonly providerIcons: ProviderIconLookup;
  readonly onClick: () => void;
  readonly onHoverEnter?: () => void;
  readonly onHoverLeave?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const iconEp = useMemo(() => connectorAsEndpointShape(connector), [connector]);
  const displayName = connector.name || providerLabel(connector.provider);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => { setHovered(true); onHoverEnter?.(); }}
      onMouseLeave={() => { setHovered(false); onHoverLeave?.(); }}
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 8,
        border: `1px solid ${hovered ? COLOR_BORDER_HOVER : COLOR_BORDER}`,
        background: hovered ? COLOR_BG_HOVER : COLOR_BG_CARD,
        color: COLOR_FG,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <AccessPointProviderIcon ep={iconEp} providerIcons={providerIcons} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: COLOR_FG, lineHeight: 1.3 }}>
          {displayName}
        </div>
        <div style={{ fontSize: 11, color: COLOR_FG_DIM, lineHeight: 1.4, marginTop: 2 }}>
          {providerLabel(connector.provider)} · {directionLabel(connector.direction)}
        </div>
      </div>
      <StatusDot status={connector.status} />
    </button>
  );
}
