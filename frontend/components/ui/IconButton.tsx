'use client';

import {
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { BUTTON_ICON_SIZE, BUTTON_MICRO_ICON_SIZE } from './buttonTokens';

type IconButtonTone = 'default' | 'danger' | 'success' | 'warning';
type IconButtonSize = 'sm' | 'md';

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'children'> & {
  children: ReactNode;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  style?: CSSProperties;
};

const SIZE_STYLES: Record<IconButtonSize, CSSProperties> = {
  sm: {
    width: BUTTON_MICRO_ICON_SIZE,
    height: BUTTON_MICRO_ICON_SIZE,
  },
  md: {
    width: BUTTON_ICON_SIZE,
    height: BUTTON_ICON_SIZE,
  },
};

function toneColor(tone: IconButtonTone, hovered: boolean) {
  if (!hovered) return 'var(--po-text-subtle)';
  if (tone === 'danger') return 'var(--po-danger)';
  if (tone === 'success') return 'var(--po-success)';
  if (tone === 'warning') return 'var(--po-warning)';
  return 'var(--po-text-muted)';
}

export function IconButton({
  children,
  tone = 'default',
  size = 'md',
  disabled,
  style,
  onMouseEnter,
  onMouseLeave,
  ...props
}: IconButtonProps) {
  const [hovered, setHovered] = useState(false);

  const handleMouseEnter = (event: MouseEvent<HTMLButtonElement>) => {
    setHovered(true);
    onMouseEnter?.(event);
  };

  const handleMouseLeave = (event: MouseEvent<HTMLButtonElement>) => {
    setHovered(false);
    onMouseLeave?.(event);
  };

  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      disabled={disabled}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        ...SIZE_STYLES[size],
        padding: 0,
        background: hovered && !disabled ? 'var(--po-hover)' : 'transparent',
        border: 'none',
        borderRadius: 4,
        color: disabled ? 'var(--po-text-disabled)' : toneColor(tone, hovered),
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'background 0.12s ease, color 0.12s ease',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
