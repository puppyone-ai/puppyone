'use client';

import type { CSSProperties, ReactNode } from 'react';
import { PulseGrid } from './PulseGrid';
import { SIZE_TO_FONT, type LoaderSize, type LoaderTone } from './tokens';

export interface InlineLoadingProps {
  /**
   * Optional label rendered to the right of the spinner. Default
   * `"Loading"`. Pass `null` for a spinner-only inline marker (e.g.
   * inside a small cell where the surrounding row already says what's
   * loading — this matches the "small components: animation only"
   * rule the design system follows).
   */
  label?: ReactNode | null;
  size?: LoaderSize;
  tone?: LoaderTone;
  className?: string;
  style?: CSSProperties;
}

/**
 * `InlineLoading` — a spinner + label that sits *inline* next to
 * other content. Use it ONLY when the loader follows body text or
 * shares a row with other inline elements; never as the sole
 * occupant of a region.
 *
 *   ✅ <span>{isSyncing ? <InlineLoading label="Syncing…" /> : null}</span>
 *   ✅ inside a 30px row: `<InlineLoading label={null} size="xs" />`
 *
 *   ❌ <div style={{ padding: 16 }}><InlineLoading /></div>
 *      — this kind of "occupy a region" usage produces the off-centre
 *        loader the user complained about (top-aligned because
 *        InlineLoading has no built-in flex centring). Use
 *        `<PageLoading variant="fill" />` instead.
 *
 * Defaults to `size="sm"` (~13px), the same default as every other
 * loader in the system after the 2026-05-08 round-2 collapse that
 * retired `md` and `lg`.
 */
export function InlineLoading({
  label = 'Loading',
  size = 'sm',
  tone = 'neutral',
  className,
  style,
}: InlineLoadingProps) {
  const fontSize = SIZE_TO_FONT[size];

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        color: '#71717a',
        fontSize,
        lineHeight: 1.4,
        ...style,
      }}
    >
      <PulseGrid size={size} tone={tone} />
      {label != null && <span>{label}</span>}
    </span>
  );
}
