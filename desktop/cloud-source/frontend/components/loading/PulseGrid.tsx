'use client';

import type { CSSProperties } from 'react';
import {
  PULSE_GRID_SIZE,
  TONE_MAP,
  type LoaderSize,
  type LoaderTone,
} from './tokens';

export interface PulseGridProps {
  /** Visual scale. xs → ~9px, sm → ~13px. (`md` was retired in the
   *  2026-05-08 round-2 collapse — see tokens.ts for history.) */
  size?: LoaderSize;
  /** Colour family. Default `neutral` (gray) covers ~95% of usage. */
  tone?: LoaderTone;
  /**
   * Animation pattern.
   *  - `diagonal` (default) — wave from top-left to bottom-right;
   *    most "flowing" feel, recommended.
   *  - `row`      — each row lights up together, 3 ticks left→right.
   *    Closer to Cursor's loading dots.
   *  - `radial`   — centre cell first, then ring expands outward.
   *    Most dramatic; reserve for full-page loaders.
   */
  pattern?: 'diagonal' | 'row' | 'radial';
  className?: string;
  style?: CSSProperties;
  /**
   * Accessible label for screen readers. Defaults to `"Loading"`.
   * Pass a more specific label (e.g. `"Loading project history"`) when
   * the surrounding context doesn't already describe what's loading.
   */
  ariaLabel?: string;
}

// Per-pattern stagger lookup: index → frame number (0-based) within
// the wave's full sweep. The animation duration is fixed at 1.4s; we
// space frames so the wave fully crosses the grid by ~50% of one
// cycle, then everything quiets back down by 100%.
const PATTERNS: Record<NonNullable<PulseGridProps['pattern']>, number[]> = {
  // Diagonal sweep, 5 frames (top-left=0 → bottom-right=4):
  //   0 1 2
  //   1 2 3
  //   2 3 4
  diagonal: [0, 1, 2, 1, 2, 3, 2, 3, 4],
  // Row sweep, 3 frames (top=0 → bottom=2):
  //   0 0 0
  //   1 1 1
  //   2 2 2
  row: [0, 0, 0, 1, 1, 1, 2, 2, 2],
  // Radial expansion, 2 frames (centre=0 → ring=1):
  //   1 1 1
  //   1 0 1
  //   1 1 1
  radial: [1, 1, 1, 1, 0, 1, 1, 1, 1],
};

// Speed tuning notes — change here, every loader in the app updates.
//
//   STAGGER_S × 4   = how long the wave takes to cross the grid
//   DURATION_S × .3 = how long a single dot stays lit (30% of cycle)
//
// Sweet spot: wave-cross ≈ DURATION_S / 3, so the wave reads as
// "flowing" rather than "marching".
const STAGGER_S = 0.07;
const DURATION_S = 0.9;

/**
 * `PulseGrid` — the canonical Puppyone loader.
 *
 * 3×3 matrix of fading dots. Reads as "data nodes pulsing through a
 * grid", which mirrors the product's own ContextBase (a tree of file
 * / data nodes) without using the spinning-wheel metaphor that every
 * other web app uses.
 *
 * Use:
 *  - `<PulseGrid size="sm" />` — every region-filling loader (panel-
 *    centred, dialog placeholder, full-page) AND inline-next-to-text.
 *    `sm` is the unified default since the 2026-05-08 round-2 collapse
 *    that retired `md` (18px → too loud for the dense chrome).
 *  - `<PulseGrid size="xs" />` — inside buttons / table cells (or use
 *    `<Dots />` when vertical room is tight)
 *
 * Almost all callers should reach for `<PageLoading variant="fill" />`
 * or `<InlineLoading />` instead — those wrap PulseGrid with the
 * required label + centring so you never end up with a bare,
 * label-less spinner sitting unmoored in a region.
 *
 * The component is a pure DIV tree. No SVG, no canvas — keeps the
 * footprint at zero extra bundle bytes once it's rendered, and means
 * `prefers-reduced-motion` neutralises it via the global rule in
 * `globals.css`.
 */
export function PulseGrid({
  size = 'sm',
  tone = 'neutral',
  pattern = 'diagonal',
  className,
  style,
  ariaLabel = 'Loading',
}: PulseGridProps) {
  const { dot, gap, radius } = PULSE_GRID_SIZE[size];
  const { rest, active } = TONE_MAP[tone];
  const stagger = PATTERNS[pattern];

  return (
    <div
      role="status"
      aria-label={ariaLabel}
      data-puppy-loader="pulse-grid"
      className={className}
      style={{
        display: 'inline-grid',
        gridTemplateColumns: `repeat(3, ${dot}px)`,
        gridTemplateRows: `repeat(3, ${dot}px)`,
        gap: `${gap}px`,
        ...style,
      }}
    >
      {stagger.map((frame, i) => (
        <span
          key={i}
          style={{
            width: dot,
            height: dot,
            borderRadius: radius,
            background: active,
            // `rest` is exposed for completeness (consumers in light
            // contexts can recolour the unlit dot via CSS), but the
            // animation itself only varies opacity — that's why we
            // don't read `rest` here.
            ['--puppy-loader-rest' as string]: rest,
            animation: `puppy-pulse-grid ${DURATION_S}s ease-in-out ${
              frame * STAGGER_S
            }s infinite`,
          }}
        />
      ))}
    </div>
  );
}
