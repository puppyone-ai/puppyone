'use client';

import {
  COLOR_BG_SUNKEN,
  COLOR_BORDER,
  COLOR_FG_MUTED,
  FONT_MONO,
} from '../tokens';
import { CopyIconButton } from './IconButton';

export function CommandBlock({
  lines,
  language: _language = 'bash',
}: {
  readonly lines: readonly string[];
  /** Reserved for future syntax-highlighted code blocks. Currently unused. */
  readonly language?: 'bash' | 'json';
}) {
  const text = lines.join('\n');
  return (
    <div
      style={{
        borderRadius: 6,
        border: `1px solid ${COLOR_BORDER}`,
        background: COLOR_BG_SUNKEN,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: '10px 36px 10px 12px',
          fontFamily: FONT_MONO,
          fontSize: 11.5,
          lineHeight: 1.55,
          color: 'var(--po-text-muted)',
          overflowX: 'auto',
          whiteSpace: 'pre',
          wordBreak: 'normal',
        }}
      >{text}</pre>
      <div style={{ position: 'absolute', top: 6, right: 6 }}>
        <CopyIconButton text={text} />
      </div>
    </div>
  );
}

export function LabeledCommandBlock({
  label,
  lines,
}: {
  readonly label: string;
  readonly lines: readonly string[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: COLOR_FG_MUTED,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
      <CommandBlock lines={lines} />
    </div>
  );
}
