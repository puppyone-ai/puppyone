'use client';

import { useState } from 'react';
import {
  COLOR_ACCENT_BG_FAINT,
  COLOR_ACCENT_BORDER,
  COLOR_BG_DASHED,
  COLOR_BORDER_HOVER,
  COLOR_FG,
  COLOR_FG_DIM,
  COLOR_FG_MUTED,
} from './tokens';

/**
 * CreateAccessPointCTACard — Overview's entry point to Pp.2b Create.
 *
 * A single dashed-card click target that mirrors the geometry of the
 * scope rows above it (so the Overview reads as a coherent list with
 * a "+ new" affordance at the bottom), but its only job is to fire
 * `onCreate()` — the actual create form lives in `CreateAccessPointPanel`
 * and is rendered as a Pp.2b sub-page with its own back button.
 *
 * Keeping this as a navigation-only card (no form) is a deliberate
 * 2026-05-08 redesign decision: surfacing the form inline made the
 * Overview do double duty (list + create), which the user described
 * as "very awkward". The 3-page hierarchy keeps each surface focused.
 */
export function CreateAccessPointCTACard({
  onCreate,
}: {
  readonly onCreate: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Section label — title case, normal letter spacing per
          2026-05-08 UX feedback ("don't use uppercase + tiny font").
          Reads as a quiet section header, not as a SHOUTED metadata
          tag like the previous design. */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: COLOR_FG_MUTED,
          padding: '0 2px',
        }}
      >
        Create new
      </div>
      <button
        type="button"
        onClick={onCreate}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px',
          borderRadius: 8,
          border: `1px dashed ${hovered ? COLOR_ACCENT_BORDER : COLOR_BORDER_HOVER}`,
          background: hovered ? COLOR_ACCENT_BG_FAINT : COLOR_BG_DASHED,
          color: COLOR_FG,
          cursor: 'pointer',
          textAlign: 'left',
          width: '100%',
          transition: 'background 0.15s ease, border-color 0.15s ease',
        }}
      >
        <PlusIcon />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            flex: 1,
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>
            Promote a folder to an access point
          </div>
          <div
            style={{
              fontSize: 11,
              color: COLOR_FG_DIM,
              lineHeight: 1.5,
            }}
          >
            Enable CLI, AI agent, and third-party integrations bound to it.
          </div>
        </div>
        <ChevronRightIcon hovered={hovered} />
      </button>
    </div>
  );
}

function PlusIcon() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: 6,
        background: 'rgba(255,255,255,0.04)',
        color: '#a5f3fc',
        flexShrink: 0,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M8 3V13M3 8H13"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function ChevronRightIcon({ hovered }: { hovered: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        color: hovered ? '#d4d4d8' : '#52525b',
        transition: 'color 0.15s ease, transform 0.15s ease',
        transform: hovered ? 'translateX(2px)' : 'translateX(0)',
        flexShrink: 0,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M6 4L10 8L6 12"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
