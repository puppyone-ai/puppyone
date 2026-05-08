'use client';

import type { CSSProperties } from 'react';
import { DOTS_SIZE, TONE_MAP, type LoaderSize, type LoaderTone } from './tokens';

export interface DotsProps {
  size?: LoaderSize;
  tone?: LoaderTone;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

const DURATION_S = 1.2;
const STAGGER_S = 0.16;

/**
 * `Dots` — three horizontal dots that bounce in sequence.
 *
 * Companion to `<PulseGrid />` for contexts where vertical room is
 * tight (button labels, table cells, single-line meta strips). The
 * 3×3 grid would compress unrecognisably below ~14px tall; the
 * single-row dots stay readable down to 6px.
 *
 * Use this INSIDE a button when you'd otherwise reach for a spinner:
 *
 *   <button disabled={saving}>
 *     {saving ? <><Dots size="xs" /> Saving…</> : 'Save'}
 *   </button>
 */
export function Dots({
  size = 'sm',
  tone = 'neutral',
  className,
  style,
  ariaLabel = 'Loading',
}: DotsProps) {
  const { dot, gap } = DOTS_SIZE[size];
  const { active } = TONE_MAP[tone];

  return (
    <span
      role="status"
      aria-label={ariaLabel}
      data-puppy-loader="dots"
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: `${gap}px`,
        verticalAlign: 'middle',
        ...style,
      }}
    >
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: dot,
            height: dot,
            borderRadius: '50%',
            background: active,
            animation: `puppy-dot-bounce ${DURATION_S}s ease-in-out ${
              i * STAGGER_S
            }s infinite`,
          }}
        />
      ))}
    </span>
  );
}
