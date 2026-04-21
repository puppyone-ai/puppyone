'use client';

import { useId } from 'react';
import { T } from '../lib/tokens';

// History thumbnail beside the project title.  Visual language is shared
// with `APUsageSparkline` so every chart on Home reads as the same
// component:
//   ┌─ 1px frame on T.cardBg ───────────────┐
//   │  cyan area-fill (gradient, 28% → 0%)  │
//   │  cyan stroke on top                   │
//   │  cyan dot on the latest bucket        │
//   └────────────────────────────────────────┘
// "No data" still draws a faint cyan dashed baseline (not grey) so the
// chart stays a chart visually, just empty.  Borrowed from how Vercel /
// Linear / Stripe handle empty-state sparklines.

export function HeaderSparkline({
  buckets,
  hasHistory,
  onClick,
}: {
  buckets: { date: string; count: number }[];
  hasHistory: boolean;
  onClick: () => void;
}) {
  const id = useId();
  const W = 120, H = 28;
  const max = Math.max(...buckets.map(b => b.count), 1);
  const total = buckets.reduce((s, b) => s + b.count, 0);

  // 3px top + bottom padding inside the SVG so the line never touches the
  // frame; that lets the area gradient sit on a baseline 3px above the
  // bottom edge (matches APUsageSparkline).
  const pts = buckets.map((b, i) => ({
    x: buckets.length > 1 ? (i / (buckets.length - 1)) * W : W / 2,
    y: H - (b.count / max) * (H - 6) - 3,
  }));
  const linePath = pts.length
    ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    : '';
  // Area = line + drop straight down to baseline + close. Filled with the
  // gradient. Using `H - 0.5` instead of `H` keeps the bottom edge on the
  // pixel grid so the gradient doesn't bleed past the frame.
  const baselineY = H - 0.5;
  const areaPath = pts.length
    ? `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${baselineY.toFixed(1)} L${pts[0].x.toFixed(1)},${baselineY.toFixed(1)} Z`
    : '';
  const lastPt = pts[pts.length - 1];

  const title = hasHistory
    ? `${total} commit${total === 1 ? '' : 's'} in last ${buckets.length}d — view history`
    : 'No history yet — view history';

  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: T.cardBg,
        border: `1px solid ${T.cardBorder}`,
        borderRadius: 4,
        padding: 2,
        margin: 0,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        transition: `border-color 160ms ${T.ease}, background 160ms ${T.ease}`,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = T.cardBorderH;
        e.currentTarget.style.background = T.cardBgH;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = T.cardBorder;
        e.currentTarget.style.background = T.cardBg;
      }}
    >
      <svg width={W} height={H} style={{ display: 'block' }} aria-hidden="true">
        <defs>
          <linearGradient id={`hsg-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.live} stopOpacity={0.28} />
            <stop offset="100%" stopColor={T.live} stopOpacity={0} />
          </linearGradient>
        </defs>
        {hasHistory ? (
          <>
            <path d={areaPath} fill={`url(#hsg-${id})`} />
            <path
              d={linePath}
              fill="none"
              stroke={T.live}
              strokeWidth="1"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {lastPt && <circle cx={lastPt.x} cy={lastPt.y} r={1.6} fill={T.live} />}
          </>
        ) : (
          <line
            x1={2} y1={H - 3} x2={W - 2} y2={H - 3}
            stroke={T.live} strokeWidth="1" strokeOpacity={0.35} strokeDasharray="2 4"
          />
        )}
      </svg>
    </button>
  );
}
