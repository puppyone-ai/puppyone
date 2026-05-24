'use client';

import type { CSSProperties, ReactNode } from 'react';
import { PulseGrid } from './PulseGrid';
import { SIZE_TO_FONT, type LoaderSize, type LoaderTone } from './tokens';

export interface PageLoadingProps {
  /**
   * Label rendered to the RIGHT of the spinner. Default `"Loading"`.
   *
   * Pass `null` (explicit) to render the spinner alone — useful when
   * the surrounding chrome already says what's loading and the label
   * would just repeat it. Don't pass an empty string; that prints an
   * empty span and breaks the optical alignment.
   */
  label?: ReactNode | null;
  /**
   * `'screen'` (default) — full viewport, opaque background.
   *   Use for route-level loaders (Suspense fallbacks at page roots,
   *   `app/.../loading.tsx` files).
   * `'fill'` — 100% of the parent's box.
   *   Use inside any container that's already `position: relative` and
   *   has a defined height (panels, cards, drawers).
   */
  variant?: 'screen' | 'fill';
  /**
   * Spinner size. Default `'sm'` (~13px) — the *only* size you should
   * use for region-filling loaders going forward.
   *
   * History (kept for archaeology):
   *   - Originally defaulted to `'lg'` (26px). Route-level `loading.tsx`
   *     used `lg` while in-page states used `md`/`sm`, causing a
   *     visible "shrink" after every navigation.
   *   - Round 1 (2026-05-08) collapsed `lg` into `md` (18px) for
   *     parity between `loading.tsx` and the page state that follows.
   *   - Round 2 (this pass) drops `md` entirely. The new default is
   *     `sm`, which reads as a quiet inline "Loading" glyph rather
   *     than a 2014-era dialog spinner. `xs` survives only for
   *     in-button / in-cell spots where vertical room is tight.
   */
  size?: LoaderSize;
  tone?: LoaderTone;
  className?: string;
  style?: CSSProperties;
}

const SHARED: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  // Spinner + label sit on a horizontal row, gap matches the label's
  // own line-height so the two read as one optical unit.
  gap: 10,
  color: 'var(--po-text-subtle)',
  letterSpacing: '0.01em',
};

/**
 * `PageLoading` — full-bleed centred loader with an attached label.
 *
 * Layout:
 *   [▢▢▢]
 *   [▢▢▢]  Loading
 *   [▢▢▢]
 *
 * The label sits to the RIGHT of the spinner (not below) so the two
 * read as one phrase ("the system is loading") rather than two
 * stacked elements; the label's font-size is auto-derived from the
 * spinner size via `SIZE_TO_FONT` so swapping size never produces a
 * visually mismatched pair.
 *
 *   <PageLoading />                          // route-root suspense
 *   <PageLoading label="Signing you in…" />  // post-auth overlay
 *   <PageLoading variant="fill" />           // inside a positioned panel
 *   <PageLoading label={null} />             // panel filler, no text
 */
export function PageLoading({
  label = 'Loading',
  variant = 'screen',
  size = 'sm',
  tone = 'neutral',
  className,
  style,
}: PageLoadingProps) {
  const fontSize = SIZE_TO_FONT[size];

  const containerStyle: CSSProperties =
    variant === 'screen'
      ? {
          ...SHARED,
          width: '100%',
          height: '100%',
          minHeight: '100vh',
          background: 'var(--po-canvas)',
          ...style,
        }
      : {
          ...SHARED,
          width: '100%',
          height: '100%',
          ...style,
        };

  return (
    <div className={className} style={containerStyle}>
      <PulseGrid size={size} tone={tone} />
      {label != null && (
        <span style={{ fontSize, lineHeight: 1.4 }}>{label}</span>
      )}
    </div>
  );
}
