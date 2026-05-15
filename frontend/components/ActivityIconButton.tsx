'use client';

import { useState } from 'react';
import { activityIconButtonStyle } from './activityStyles';

type ActivityIconButtonKind = 'minimize' | 'collapse' | 'close' | 'back' | 'settings';

interface ActivityIconButtonProps {
  kind: ActivityIconButtonKind;
  title: string;
  onClick: () => void;
  size?: 'sm' | 'md';
  active?: boolean;
  badge?: boolean;
}

export function ActivityIconButton({
  kind,
  title,
  onClick,
  size = 'md',
  active = false,
  badge = false,
}: Readonly<ActivityIconButtonProps>) {
  const [hovered, setHovered] = useState(false);
  const buttonSize = size === 'sm' ? 20 : 24;
  const iconSize = size === 'sm' ? 12 : 14;

  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...activityIconButtonStyle,
        position: 'relative',
        width: buttonSize,
        height: buttonSize,
        background: active
          ? 'var(--po-selected)'
          : hovered
            ? 'var(--po-active)'
            : 'transparent',
        color: active
          ? 'var(--po-text)'
          : hovered
            ? 'var(--po-text-muted)'
            : 'var(--po-text-subtle)',
        transition: 'background 0.12s ease, color 0.12s ease',
      }}
    >
      {kind === 'minimize' && (
        <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M4 8h8"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      )}

      {kind === 'collapse' && (
        <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M5 6.5L8 9.5L11 6.5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {kind === 'close' && (
        <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M5 5L11 11M11 5L5 11"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      )}

      {kind === 'back' && (
        <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M9.5 4L5.5 8L9.5 12"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {kind === 'settings' && (
        <svg width={iconSize} height={iconSize} viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M13.5 4.5h-6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M8.5 11.5h-6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx="4.5" cy="4.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="11.5" cy="11.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      )}

      {badge && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 5,
            height: 5,
            borderRadius: 999,
            background: 'var(--po-success)',
          }}
        />
      )}
    </button>
  );
}
