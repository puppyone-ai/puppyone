import { useRef, useState } from 'react';
import { T } from '../lib/tokens';
import { PROVIDER_LABELS } from '../lib/constants';
import { formatRelative } from '../lib/format';
import type { DashboardConnection } from '../lib/types';
import { ProviderAvatar } from './ProviderAvatar';
import { APUsageSparkline } from './APUsageSparkline';

// APCard mirrors the visual language of `ProviderRow` in the access drawer
// (`data/components/SyncConfigPanel.tsx`):
//   resting: bg rgba(255,255,255,0.02), border 1px rgba(.,0.06), radius 8
//   hover:   bg rgba(.,0.06),           border 1px rgba(.,0.12)
//   icon container: 32x32, radius 8, bg rgba(.,0.05)
//   label 13/500 (white on hover), description 12 #71717a
//   transition all 0.15s
// Keeping the two surfaces visually consistent matters because users see
// the same provider in both places (here on Home, there in the new-access
// drawer) and any drift reads as a bug. The home variant adds a small
// 14px-tall sparkline + a status dot, but everything else is 1:1.

export function APCard({
  conn,
  registerRef,
  onHoverChange,
  onClick,
}: {
  conn: DashboardConnection;
  registerRef: (el: HTMLDivElement | null) => void;
  onHoverChange: (hovered: boolean) => void;
  // Click handler — only fires for genuine clicks, NOT for the click event
  // synthesized at the end of a drag-reorder gesture.  We gate on
  // `pointerdown` coords vs `pointerup` coords (≤4px = click); this is
  // necessary because framer-motion's `Reorder.Item` does not swallow the
  // child's click for short drags, and we don't want a 3px nudge to
  // navigate away.
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const label = conn.name || PROVIDER_LABELS[conn.provider] || conn.provider;
  const scope = conn.path || '';
  const status = conn.status;
  const statusColor = status === 'error' ? T.err
    : status === 'paused' ? T.warn
    : T.live;
  const lastSyncedRel = conn.last_synced_at ? formatRelative(conn.last_synced_at) : null;

  return (
    <div
      ref={registerRef}
      data-ap-id={conn.id}
      onMouseEnter={() => { setHovered(true); onHoverChange(true); }}
      onMouseLeave={() => { setHovered(false); onHoverChange(false); }}
      onPointerDown={(e) => { downPosRef.current = { x: e.clientX, y: e.clientY }; }}
      onPointerUp={(e) => {
        const start = downPosRef.current;
        downPosRef.current = null;
        if (!onClick || !start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (dx * dx + dy * dy <= 16) onClick();
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px',
        background: hovered ? T.cardBgH : T.cardBg,
        border: `1px solid ${hovered ? T.cardBorderH : T.cardBorder}`,
        borderRadius: 8, cursor: 'pointer',
        width: '100%', textAlign: 'left',
        transition: 'all 0.15s',
        userSelect: 'none',
      }}
      title={`${label}${scope ? ` — /${scope}` : ''} (${status})`}
    >
      {/* Icon container — 32x32 with the provider avatar inside, mirroring
          ProviderRow. The avatar already carries the brand color; a faint
          inner bg keeps it sitting on a chip rather than floating. */}
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.05)', flexShrink: 0,
      }}>
        <ProviderAvatar provider={conn.provider} size={22} icon={(conn as any).icon} />
      </div>

      {/* Text block: name + status dot on top, scope path mid, "Updated"
          caption at the bottom.  Three rows because the user wants both
          the AP's location AND its freshness visible at a glance — the
          freshness line was previously only available in the access
          drawer, which was a costly click to find. */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 13, fontWeight: 500,
          color: hovered ? '#ffffff' : '#e4e4e7',
          lineHeight: 1.3,
          transition: 'color 0.15s',
        }}>
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{label}</span>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: statusColor,
            boxShadow: status === 'error' ? 'none' : `0 0 0 3px ${T.liveSoft}`,
            flexShrink: 0,
          }} />
        </div>
        {scope && (
          <div style={{
            fontSize: 12, color: '#71717a',
            fontFamily: T.fontMono,
            lineHeight: 1.3,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            /{scope}
          </div>
        )}
        <div style={{
          fontSize: 11, color: T.text3,
          lineHeight: 1.3, marginTop: 2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {lastSyncedRel ? `Updated ${lastSyncedRel}` : 'Never synced'}
        </div>
      </div>

      {/* Right slot: call-history sparkline.  Lives where ProviderRow puts
          its chevron, so the row's silhouette stays familiar. */}
      <div style={{ flexShrink: 0, opacity: hovered ? 1 : 0.85, transition: 'opacity 0.15s' }}>
        <APUsageSparkline buckets={conn.usage_buckets || []} />
      </div>
    </div>
  );
}
