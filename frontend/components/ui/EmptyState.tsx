'use client';

import type { CSSProperties, ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  minHeight?: number | string;
  style?: CSSProperties;
}

export function EmptyState({
  icon,
  title,
  description,
  minHeight = '100%',
  style,
}: EmptyStateProps) {
  return (
    <div
      style={{
        minHeight,
        width: '100%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 24,
        boxSizing: 'border-box',
        color: 'var(--po-text-disabled)',
        textAlign: 'center',
        ...style,
      }}
    >
      {icon ? (
        <div
          aria-hidden
          style={{
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--po-text-disabled)',
            opacity: 0.64,
          }}
        >
          {icon}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: 'var(--po-font-sans)',
          fontSize: 13,
          fontWeight: 'var(--po-text-weight-medium)',
          lineHeight: 'var(--po-line-height-tight)',
          letterSpacing: 0,
          color: 'var(--po-text-muted)',
        }}
      >
        {title}
      </div>
      {description ? (
        <div
          style={{
            maxWidth: 420,
            fontFamily: 'var(--po-font-sans)',
            fontSize: 12,
            fontWeight: 'var(--po-text-weight-regular)',
            lineHeight: '18px',
            letterSpacing: 0,
            color: 'var(--po-text-disabled)',
          }}
        >
          {description}
        </div>
      ) : null}
    </div>
  );
}
