'use client';

import type { CSSProperties } from 'react';

type StatusDotTone = 'success' | 'warning' | 'danger' | 'accent' | 'muted';
type StatusDotStatus =
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
  size?: number;
  pulse?: boolean;
  title?: string;
  style?: CSSProperties;
};

function toneFromStatus(status: StatusDotStatus | string | null | undefined): StatusDotTone {
  if (!status) return 'muted';
  const normalized = status.toLowerCase();

  if (['active', 'ready', 'connected', 'success', 'completed', 'online'].includes(normalized)) {
    return 'success';
  }

  if (['syncing', 'processing', 'running', 'loading'].includes(normalized)) {
    return 'accent';
  }

  if (['pending', 'warning', 'paused', 'queued'].includes(normalized)) {
    return 'warning';
  }

  if (['error', 'failed', 'danger', 'blocked'].includes(normalized)) {
    return 'danger';
  }

  return 'muted';
}

function colorForTone(tone: StatusDotTone) {
  if (tone === 'success') return 'var(--po-success)';
  if (tone === 'warning') return 'var(--po-warning)';
  if (tone === 'danger') return 'var(--po-danger)';
  if (tone === 'accent') return 'var(--po-accent)';
  return 'var(--po-text-disabled)';
}

export function StatusDot({
  tone,
  status,
  size = 6,
  pulse = false,
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
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        display: 'inline-block',
        flexShrink: 0,
        boxShadow: pulse
          ? `0 0 0 4px color-mix(in srgb, ${color} 16%, transparent)`
          : undefined,
        ...style,
      }}
    />
  );
}
