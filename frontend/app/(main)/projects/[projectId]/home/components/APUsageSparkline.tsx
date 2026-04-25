'use client';

import { useId } from 'react';
import { T } from '../lib/tokens';

// Daily call-volume thumbnail next to each AP card.  Visual language is
// shared with `HeaderSparkline` (1px frame + cyan area + cyan line) so
// every chart on Home reads as the same component — using the AP's
// provider color here would theme the card nicely but break the page-wide
// "one chart language" rhythm and make the history glance ambiguous.
//
// Data source: `DashboardConnection.usage_buckets` — daily invocation
// counts from `sync_runs` (last 14 days, oldest → newest).

export function APUsageSparkline({ buckets }: { buckets: number[] }) {
  const id = useId();
  const W = 56, H = 22;
  const safe = buckets.length > 0 ? buckets : [0];
  const max = Math.max(...safe, 1);
  const total = safe.reduce((s, b) => s + b, 0);

  const pts = safe.map((c, i) => ({
    x: safe.length > 1 ? (i / (safe.length - 1)) * W : W / 2,
    y: H - (c / max) * (H - 6) - 3,
  }));
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const baselineY = H - 0.5;
  const areaPath = pts.length
    ? `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${baselineY.toFixed(1)} L${pts[0].x.toFixed(1)},${baselineY.toFixed(1)} Z`
    : '';
  const lastPt = pts[pts.length - 1];

  return (
    <div
      style={{
        background: T.cardBg,
        border: `1px solid ${T.cardBorder}`,
        borderRadius: 4,
        padding: 2,
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
      }}
      title={`${total} call${total === 1 ? '' : 's'} in last ${safe.length}d`}
    >
      <svg
        width={W} height={H}
        style={{ display: 'block' }}
        aria-label={`${total} calls in last ${safe.length}d`}
      >
        <defs>
          <linearGradient id={`apg-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.live} stopOpacity={0.28} />
            <stop offset="100%" stopColor={T.live} stopOpacity={0} />
          </linearGradient>
        </defs>
        {total > 0 ? (
          <>
            <path d={areaPath} fill={`url(#apg-${id})`} />
            <path
              d={linePath}
              fill="none"
              stroke={T.live}
              strokeWidth="1"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {lastPt && <circle cx={lastPt.x} cy={lastPt.y} r={1.4} fill={T.live} />}
          </>
        ) : (
          <line
            x1={2} y1={H - 3} x2={W - 2} y2={H - 3}
            stroke={T.live} strokeWidth="1" strokeOpacity={0.35} strokeDasharray="2 4"
          />
        )}
      </svg>
    </div>
  );
}
