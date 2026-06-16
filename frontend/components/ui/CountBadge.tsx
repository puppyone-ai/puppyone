import type { CSSProperties, ReactNode } from 'react';

export type CountBadgeSize = 'sm' | 'md' | 'lg';
export type CountBadgeTone = 'neutral' | 'muted' | 'selected' | 'surface' | 'danger' | 'accent' | 'success';

type CountBadgeProps = {
  value: ReactNode;
  size?: CountBadgeSize;
  tone?: CountBadgeTone;
  title?: string;
  ariaLabel?: string;
  ariaHidden?: boolean;
};

const SIZE_STYLES: Record<CountBadgeSize, CSSProperties> = {
  sm: {
    height: 16,
    minWidth: 16,
    padding: '0 5px',
    fontSize: 10,
    lineHeight: '16px',
    fontWeight: 500,
  },
  md: {
    height: 18,
    minWidth: 18,
    padding: '0 6px',
    fontSize: 10,
    lineHeight: '18px',
    fontWeight: 600,
  },
  lg: {
    height: 22,
    minWidth: 22,
    padding: '0 7px',
    fontSize: 12,
    lineHeight: '22px',
    fontWeight: 650,
  },
};

const TONE_STYLES: Record<CountBadgeTone, CSSProperties> = {
  neutral: {
    background: 'var(--po-border-subtle)',
    color: 'var(--po-text-muted)',
  },
  muted: {
    background: 'var(--po-control)',
    color: 'var(--po-text-subtle)',
  },
  selected: {
    background: 'color-mix(in srgb, var(--po-text) 10%, var(--po-panel) 90%)',
    color: 'var(--po-text)',
  },
  surface: {
    background: 'var(--po-panel-raised)',
    color: 'var(--po-text-muted)',
    border: '1px solid var(--po-border)',
  },
  danger: {
    background: 'var(--po-danger)',
    color: 'var(--po-canvas)',
    boxShadow: '0 0 0 1px color-mix(in srgb, var(--po-danger) 25%, transparent)',
  },
  accent: {
    background: 'color-mix(in srgb, var(--po-accent) 14%, var(--po-panel) 86%)',
    color: 'var(--po-accent)',
  },
  success: {
    background: 'color-mix(in srgb, var(--po-success) 15%, transparent)',
    color: 'var(--po-success)',
  },
};

export function CountBadge({
  value,
  size = 'sm',
  tone = 'neutral',
  title,
  ariaLabel,
  ariaHidden,
}: CountBadgeProps) {
  return (
    <span
      title={title}
      aria-label={ariaLabel}
      aria-hidden={ariaHidden}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxSizing: 'border-box',
        borderRadius: 999,
        fontFamily: 'var(--po-font-sans)',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        letterSpacing: 0,
        ...SIZE_STYLES[size],
        ...TONE_STYLES[tone],
      }}
    >
      {value}
    </span>
  );
}
