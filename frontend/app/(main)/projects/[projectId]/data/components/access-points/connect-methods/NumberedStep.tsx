'use client';

import type { ReactNode } from 'react';
import { COLOR_FG, COLOR_FG_DIM, COLOR_FG_MUTED } from '../tokens';

export function NumberedStep({
  number,
  title,
  hint,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          background: 'var(--po-border-subtle)',
          color: COLOR_FG_MUTED,
          fontSize: 11,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: 2,
        }}
        aria-hidden
      >
        {number}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: COLOR_FG, lineHeight: 1.4 }}>
          {title}
        </div>
        {hint && (
          <div style={{ fontSize: 11, color: COLOR_FG_DIM, lineHeight: 1.5 }}>{hint}</div>
        )}
        {children}
      </div>
    </div>
  );
}
