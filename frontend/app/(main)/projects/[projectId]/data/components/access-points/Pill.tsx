'use client';

import type { ReactNode } from 'react';
import {
  COLOR_ACCENT,
  COLOR_ACCENT_BG,
  COLOR_ACCENT_BORDER_BRIGHT,
  COLOR_FG,
  COLOR_FG_DIM,
  COLOR_FG_MUTED,
} from './tokens';

/**
 * Pill — tiny status chip used inside the access-point row. Three
 * variants tuned to the row's role:
 *   - brand: cyan-tinted, used for the Root badge
 *   - rw / r: neutral surface, just labels the mode (the inline text
 *     already tells you which one — colour stays neutral so users with
 *     red-green concerns aren't decoding a colour key)
 *   - meta: subtler still, used for "N excludes" counts
 */
export function Pill({
  children,
  variant,
}: {
  readonly children: ReactNode;
  readonly variant: 'brand' | 'rw' | 'r' | 'meta';
}) {
  const styles: Record<typeof variant, { bg: string; color: string; border: string }> = {
    brand: {
      bg: COLOR_ACCENT_BG,
      color: COLOR_ACCENT,
      border: COLOR_ACCENT_BORDER_BRIGHT,
    },
    rw: {
      bg: 'rgba(255,255,255,0.06)',
      color: COLOR_FG,
      border: 'rgba(255,255,255,0.10)',
    },
    r: {
      bg: 'rgba(255,255,255,0.03)',
      color: COLOR_FG_MUTED,
      border: 'rgba(255,255,255,0.08)',
    },
    meta: {
      bg: 'transparent',
      color: COLOR_FG_DIM,
      border: 'rgba(255,255,255,0.08)',
    },
  };
  const s = styles[variant];
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: 10,
        fontWeight: 500,
        lineHeight: 1.4,
        letterSpacing: 0.02,
        padding: '1.5px 6px',
        borderRadius: 4,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
