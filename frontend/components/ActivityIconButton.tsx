'use client';

import { useState } from 'react';
import { activityIconButtonStyle } from './activityStyles';

type ActivityIconButtonKind = 'minimize' | 'collapse' | 'close' | 'back';

interface ActivityIconButtonProps {
  kind: ActivityIconButtonKind;
  title: string;
  onClick: () => void;
}

export function ActivityIconButton({
  kind,
  title,
  onClick,
}: Readonly<ActivityIconButtonProps>) {
  const [hovered, setHovered] = useState(false);

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
        background: hovered ? 'rgba(255,255,255,0.07)' : 'transparent',
        color: hovered ? '#d4d4d8' : '#71717a',
        transition: 'background 0.12s ease, color 0.12s ease',
      }}
    >
      {kind === 'minimize' && (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M4 8h8"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      )}

      {kind === 'collapse' && (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
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
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M5 5L11 11M11 5L5 11"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      )}

      {kind === 'back' && (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path
            d="M9.5 4L5.5 8L9.5 12"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

