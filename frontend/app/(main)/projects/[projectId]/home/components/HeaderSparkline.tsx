'use client';

import { useId } from 'react';
import { T } from '../lib/tokens';

// History thumbnail beside the project title.  Visual language is shared
// with `APUsageSparkline` so every chart on Home reads as the same
// component:
//   ┌─ 1px frame on T.cardBg ───────────────────┐
//   │  cyan area-fill (gradient, 22% → 0%)      │
//   │  cyan smoothed line on top (catmull-rom)  │
//   │  cyan dot on the latest bucket            │
//   └────────────────────────────────────────────┘
// Why the smoothing: when usage is sparse (e.g. 12 days of zeros + one
// spike), straight-line interpolation paints near-vertical edges that
// fill the area gradient into bar-like wedges — readers mistake it for a
// column chart.  Catmull-rom rounds those wedges into hills, which makes
// the chart unambiguously read as a line/area graph.
// "No data" still draws a faint cyan dashed baseline (not grey) so the
// chart stays a chart visually, just empty.  Borrowed from how Vercel /
// Linear / Stripe handle empty-state sparklines.

// catmull-rom → cubic bezier.  Tension factor 1/6 matches the standard
// Catmull-Rom-to-Bezier conversion (alpha=0).  Endpoints duplicate the
// first / last point so the curve doesn't "snap" at the boundary.
function smoothLinePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) {
    return `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  }
  const segs: string[] = [`M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || pts[i + 1];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    segs.push(
      `C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`,
    );
  }
  return segs.join(' ');
}

export function HeaderSparkline({
  buckets,
  hasHistory,
  onClick,
  unit = 'event',
  emptyHint = 'No history yet',
  actionHint = 'view',
  framed = true,
}: {
  buckets: { date: string; count: number }[];
  hasHistory: boolean;
  onClick: () => void;
  // Singular noun for the data point ("commit", "invocation", "event"…).
  // Plural is `${unit}s` — naive but sufficient for our wordlist.
  unit?: string;
  // Tooltip when there's no data, e.g. "No usage in last 14d".
  emptyHint?: string;
  // Trailing hint that follows the count, e.g. "view monitor".
  actionHint?: string;
  // When false, drop the 1px frame + cardBg so the sparkline floats on
  // whatever surface it's placed on.  Used in the "activity" row where
  // the sparkline is paired with text and a frame would over-segment the
  // composition.
  framed?: boolean;
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
  const linePath = smoothLinePath(pts);
  // Area = line + drop straight down to baseline + close. Filled with the
  // gradient. Using `H - 0.5` instead of `H` keeps the bottom edge on the
  // pixel grid so the gradient doesn't bleed past the frame.
  const baselineY = H - 0.5;
  const areaPath = pts.length
    ? `${linePath} L${pts[pts.length - 1].x.toFixed(2)},${baselineY.toFixed(2)} L${pts[0].x.toFixed(2)},${baselineY.toFixed(2)} Z`
    : '';
  const lastPt = pts[pts.length - 1];

  const title = hasHistory
    ? `${total} ${unit}${total === 1 ? '' : 's'} in last ${buckets.length}d — ${actionHint}`
    : `${emptyHint} — ${actionHint}`;

  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: framed ? T.cardBg : 'transparent',
        border: framed ? `1px solid ${T.cardBorder}` : 'none',
        borderRadius: framed ? 4 : 0,
        width: framed ? W + 4 : W,
        height: framed ? H + 4 : 30,
        padding: framed ? 2 : 0,
        margin: 0,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        opacity: framed ? 1 : 0.85,
        transition: framed
          ? `border-color 160ms ${T.ease}, background 160ms ${T.ease}`
          : `opacity 160ms ${T.ease}`,
      }}
      onMouseEnter={e => {
        if (framed) {
          e.currentTarget.style.borderColor = T.cardBorderH;
          e.currentTarget.style.background = T.cardBgH;
        } else {
          e.currentTarget.style.opacity = '1';
        }
      }}
      onMouseLeave={e => {
        if (framed) {
          e.currentTarget.style.borderColor = T.cardBorder;
          e.currentTarget.style.background = T.cardBg;
        } else {
          e.currentTarget.style.opacity = '0.85';
        }
      }}
    >
      <svg width={W} height={H} style={{ display: 'block' }} aria-hidden="true">
        <defs>
          <linearGradient id={`hsg-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.live} stopOpacity={0.22} />
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
              strokeWidth="1.25"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {lastPt && <circle cx={lastPt.x} cy={lastPt.y} r={1.8} fill={T.live} />}
          </>
        ) : (
          // Empty state: a single flat baseline (no dashes).  The previous
          // dasharray rendered as ~19 short ticks which read as Morse code,
          // not as a chart with no data.  A continuous low-opacity line is
          // the convention used by Vercel / Linear / Stripe sparklines and
          // makes "no usage yet" look like a chart that's just resting at
          // zero.
          <line
            x1={2} y1={H - 3} x2={W - 2} y2={H - 3}
            stroke={T.live} strokeWidth="1" strokeOpacity={0.28}
          />
        )}
      </svg>
    </button>
  );
}
