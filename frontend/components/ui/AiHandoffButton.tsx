'use client';

import { Check, Copy } from 'lucide-react';
import type { ButtonHTMLAttributes, CSSProperties } from 'react';

type AiHandoffButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & {
  readonly copied?: boolean;
  readonly label?: string;
  readonly copiedLabel?: string;
  readonly style?: CSSProperties;
};

export function AiHandoffButton({
  copied = false,
  label = 'Copy prompt',
  copiedLabel = 'Copied',
  disabled,
  style,
  ...props
}: AiHandoffButtonProps) {
  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      disabled={disabled}
      style={{
        height: 32,
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '0 14px',
        border: copied
          ? '1px solid color-mix(in srgb, var(--po-success) 42%, var(--po-text) 20%)'
          : '1px solid var(--po-text)',
        background: copied ? 'var(--po-success)' : 'var(--po-text)',
        color: 'var(--po-canvas)',
        fontSize: 12,
        lineHeight: 1,
        fontWeight: 600,
        fontFamily: 'var(--po-font-sans)',
        whiteSpace: 'nowrap',
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: disabled
          ? 'none'
          : '0 10px 24px color-mix(in srgb, var(--po-shadow) 30%, transparent)',
        opacity: disabled ? 0.48 : 1,
        transition: 'background 0.14s ease, border-color 0.14s ease, color 0.14s ease, opacity 0.14s ease',
        ...style,
      }}
    >
      {copied ? <Check size={14} strokeWidth={1.9} /> : <Copy size={14} strokeWidth={1.75} />}
      {copied ? copiedLabel : label}
    </button>
  );
}
