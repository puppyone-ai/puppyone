'use client';

import type { CSSProperties, MouseEventHandler } from 'react';

export type StatusDotTone = 'success' | 'warning' | 'danger' | 'accent' | 'muted';
export type StatusDotStatus =
  | 'active'
  | 'ready'
  | 'connected'
  | 'success'
  | 'syncing'
  | 'processing'
  | 'pending'
  | 'warning'
  | 'paused'
  | 'error'
  | 'failed'
  | 'danger'
  | 'inactive'
  | 'disconnected'
  | 'stopped'
  | 'muted';

type StatusDotProps = {
  tone?: StatusDotTone;
  status?: StatusDotStatus | string | null;
  /**
   * Kept only for backward compatibility. Product status lamps render at one
   * canonical size so green/red/yellow indicators do not drift by page.
   */
  size?: number;
  pulse?: boolean;
  title?: string;
  style?: CSSProperties;
};

type StatusIndicatorProps = StatusDotProps & {
  label: string;
  className?: string;
  onClick?: MouseEventHandler<HTMLSpanElement>;
  textStyle?: CSSProperties;
};

const STATUS_DOT_SIZE = 6;

export function toneFromStatus(status: StatusDotStatus | string | null | undefined): StatusDotTone {
  if (!status) return 'muted';
  const normalized = status.toLowerCase();

  if (['active', 'ready', 'connected', 'success', 'completed', 'online'].includes(normalized)) {
    return 'success';
  }

  if (['syncing', 'processing', 'running', 'loading'].includes(normalized)) {
    return 'accent';
  }

  if (['pending', 'warning', 'paused', 'queued', 'mixed'].includes(normalized)) {
    return 'warning';
  }

  if (['error', 'failed', 'danger', 'blocked', 'needs attention'].includes(normalized)) {
    return 'danger';
  }

  return 'muted';
}

export function colorForTone(tone: StatusDotTone) {
  if (tone === 'success') return 'var(--po-success)';
  if (tone === 'warning') return 'var(--po-warning)';
  if (tone === 'danger') return 'var(--po-danger)';
  if (tone === 'accent') return 'var(--po-accent)';
  return 'var(--po-text-disabled)';
}

export function StatusDot({
  tone,
  status,
  size: _size,
  pulse: _pulse = false,
  title,
  style,
}: StatusDotProps) {
  const resolvedTone = tone ?? toneFromStatus(status);
  const color = colorForTone(resolvedTone);

  return (
    <span
      aria-hidden={!title}
      title={title}
      style={{
        width: STATUS_DOT_SIZE,
        height: STATUS_DOT_SIZE,
        borderRadius: '50%',
        background: color,
        display: 'inline-block',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

export function StatusIndicator({
  label,
  tone,
  status,
  pulse: _pulse = false,
  title,
  className,
  onClick,
  style,
  textStyle,
}: StatusIndicatorProps) {
  const resolvedTone = tone ?? toneFromStatus(status);
  const color = colorForTone(resolvedTone);

  return (
    <span
      className={className}
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color,
        fontSize: 12,
        lineHeight: '16px',
        fontWeight: resolvedTone === 'success' ? 500 : 400,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <StatusDot tone={resolvedTone} />
      <span style={textStyle}>{label}</span>
    </span>
  );
}
