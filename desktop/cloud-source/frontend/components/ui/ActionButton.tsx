'use client';

import {
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { BUTTON_HEIGHT, BUTTON_RADIUS } from './buttonTokens';

type ActionButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
type ActionButtonSize = 'sm' | 'md';

type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & {
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
  style?: CSSProperties;
};

const SIZE_STYLES: Record<ActionButtonSize, CSSProperties> = {
  sm: {
    height: BUTTON_HEIGHT,
    padding: '0 12px',
    fontSize: 12,
  },
  md: {
    height: BUTTON_HEIGHT,
    padding: '0 14px',
    fontSize: 13,
  },
};

function variantStyle(
  variant: ActionButtonVariant,
  hovered: boolean,
  disabled: boolean,
): CSSProperties {
  if (disabled) {
    return {
      border: '1px solid var(--po-border)',
      background: 'var(--po-control)',
      color: 'var(--po-text-disabled)',
      cursor: 'not-allowed',
    };
  }

  if (variant === 'primary') {
    return {
      border: '1px solid var(--po-text)',
      background: hovered ? 'color-mix(in srgb, var(--po-text) 88%, var(--po-panel) 12%)' : 'var(--po-text)',
      color: 'var(--po-text-inverse)',
      cursor: 'pointer',
    };
  }

  if (variant === 'danger') {
    return {
      border: '1px solid color-mix(in srgb, var(--po-danger) 28%, transparent)',
      background: hovered
        ? 'color-mix(in srgb, var(--po-danger) 18%, transparent)'
        : 'color-mix(in srgb, var(--po-danger) 12%, transparent)',
      color: 'var(--po-danger)',
      cursor: 'pointer',
    };
  }

  if (variant === 'warning') {
    return {
      border: '1px solid color-mix(in srgb, var(--po-warning) 32%, transparent)',
      background: hovered
        ? 'color-mix(in srgb, var(--po-warning) 22%, transparent)'
        : 'color-mix(in srgb, var(--po-warning) 16%, transparent)',
      color: 'var(--po-warning)',
      cursor: 'pointer',
    };
  }

  if (variant === 'ghost') {
    return {
      border: '1px solid transparent',
      background: hovered ? 'var(--po-hover)' : 'transparent',
      color: hovered ? 'var(--po-text)' : 'var(--po-text-muted)',
      cursor: 'pointer',
    };
  }

  return {
    border: '1px solid var(--po-border-strong)',
    background: hovered ? 'var(--po-hover)' : 'transparent',
    color: hovered ? 'var(--po-text)' : 'var(--po-text-muted)',
    cursor: 'pointer',
  };
}

export function ActionButton({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  loading = false,
  disabled,
  children,
  style,
  onMouseEnter,
  onMouseLeave,
  type,
  ...props
}: ActionButtonProps) {
  const [hovered, setHovered] = useState(false);
  const isDisabled = Boolean(disabled || loading);

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
      type={type ?? 'button'}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        ...SIZE_STYLES[size],
        width: fullWidth ? '100%' : undefined,
        borderRadius: BUTTON_RADIUS,
        fontWeight: variant === 'primary' ? 600 : 500,
        fontFamily: 'inherit',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        whiteSpace: 'nowrap',
        transition: 'background 0.12s, border-color 0.12s, color 0.12s, opacity 0.12s',
        ...variantStyle(variant, hovered, isDisabled),
        ...style,
      }}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
}
