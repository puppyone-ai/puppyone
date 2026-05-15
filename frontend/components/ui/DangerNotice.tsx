'use client';

import type { CSSProperties, ReactNode } from 'react';

type DangerNoticeTone = 'danger' | 'warning';

type DangerNoticeProps = {
  title?: ReactNode;
  children?: ReactNode;
  tone?: DangerNoticeTone;
  compact?: boolean;
  style?: CSSProperties;
};

function toneToken(tone: DangerNoticeTone) {
  return tone === 'danger' ? 'var(--po-danger)' : 'var(--po-warning)';
}

export function DangerNotice({
  title,
  children,
  tone = 'danger',
  compact = false,
  style,
}: DangerNoticeProps) {
  const color = toneToken(tone);

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        padding: compact ? '10px 12px' : '12px 14px',
        borderRadius: 8,
        border: `1px solid color-mix(in srgb, ${color} 24%, transparent)`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        color: 'var(--po-text)',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          marginTop: compact ? 5 : 6,
        }}
      />
      <div style={{ minWidth: 0 }}>
        {title && (
          <div
            style={{
              fontSize: 13,
              lineHeight: '18px',
              fontWeight: 600,
              color,
            }}
          >
            {title}
          </div>
        )}
        {children && (
          <div
            style={{
              marginTop: title ? 4 : 0,
              fontSize: 13,
              lineHeight: '19px',
              color: 'var(--po-text-muted)',
            }}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
