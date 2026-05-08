'use client';

import { useState } from 'react';
import {
  COLOR_BG_SUNKEN,
  COLOR_BORDER,
  COLOR_FG_MUTED,
  FONT_MONO,
} from '../tokens';
import { EyeIcon, EyeOffIcon } from './icons';
import { CopyIconButton, IconButton } from './IconButton';

export function KeyValueRow({
  label,
  value,
  masked = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly masked?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const isMasked = masked && !revealed;
  const display = !value
    ? '—'
    : isMasked
      ? '•'.repeat(Math.min(24, value.length))
      : value;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        borderRadius: 6,
        border: `1px solid ${COLOR_BORDER}`,
        background: COLOR_BG_SUNKEN,
        padding: '7px 8px 7px 10px',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: COLOR_FG_MUTED,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          width: 64,
          flexShrink: 0,
        }}
      >
        {label}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: FONT_MONO,
          fontSize: 11.5,
          color: '#d4d4d8',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {display}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        {masked && (
          <IconButton
            label={revealed ? 'Hide' : 'Reveal'}
            onClick={() => setRevealed((v) => !v)}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </IconButton>
        )}
        <CopyIconButton text={value} />
      </div>
    </div>
  );
}
