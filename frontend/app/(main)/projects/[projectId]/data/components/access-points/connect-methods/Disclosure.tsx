'use client';

import { useState, type ReactNode } from 'react';
import { COLOR_FG, COLOR_FG_DIM } from '../tokens';

/**
 * Disclosure — collapsible "Show details ▾" reveal.
 *
 * Default state is closed: the prompt copy card is the only thing the user
 * sees, so the page feels light and action-first. Power users who want the
 * raw install / login / use commands can click the summary to expand.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  readonly summary: string;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: open ? 12 : 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          alignSelf: 'flex-start',
          padding: '6px 8px',
          marginLeft: -8,
          background: 'transparent',
          border: 'none',
          color: hovered || open ? COLOR_FG : COLOR_FG_DIM,
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'color 0.12s',
        }}
      >
        <svg
          width={13}
          height={13}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}
          aria-hidden
        >
          <path d="M4 2.5l3.5 3.5L4 9.5" />
        </svg>
        {summary}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {children}
        </div>
      )}
    </div>
  );
}
