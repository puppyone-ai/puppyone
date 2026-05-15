'use client';

import { useState } from 'react';
import { CHROME_LABEL_TYPOGRAPHY } from '@/lib/uiTypography';

// The chip lives in the same visual language as the sidebar's row-level
// access-active button. The
// header surface is the same accent family, scaled up: a leading chain
// glyph (the project's recurring "access" mark, also used in the file
// tree's per-row chip) + the literal word "Access" + a count of access
// points in this project.
//
// 2026-05-08 redesign:
//   - Renamed from "Add access" → "Access". The button doesn't *create*
//     anything; clicking it opens the management surface (Pp.1
//     Overview), where creation is one click away. The verb framing
//     was misleading.
//   - Count is now project-wide scope count, not per-scope integration
//     count. The button is a global entry point — its number should
//     reflect the project's total access surface, not whatever scope
//     the user happens to be cursoring over.
//   - Provider stack glyph dropped: it was a per-scope concern and
//     conflicted with the new global semantic.
//
// 2026-05-09 pass — keep Access discoverable:
//   Access scopes are the core product action on the Data page, so the
//   header entry needs a visible resting state. Keep it understated:
//   border + icon carry the signal, not a glowing CTA treatment.
const STATES = {
  resting: {
    bg: 'var(--po-control)',
    border: 'color-mix(in srgb, var(--po-accent) 20%, transparent)',
    text: 'var(--po-text-muted)',
    countText: 'var(--po-text-muted)',
    iconStroke: 'var(--po-accent-text)',
  },
  hover: {
    bg: 'var(--po-border-subtle)',
    border: 'color-mix(in srgb, var(--po-accent) 30%, transparent)',
    text: 'var(--po-text)',
    countText: 'var(--po-text-muted)',
    iconStroke: 'var(--po-accent)',
  },
  active: {
    bg: 'var(--po-selected)',
    border: 'color-mix(in srgb, var(--po-accent) 36%, transparent)',
    text: 'var(--po-text)',
    countText: 'var(--po-text-muted)',
    iconStroke: 'var(--po-accent)',
  },
} as const;

export function AccessPointsHeaderButton({
  scopeCount,
  isOpen,
  onClick,
}: {
  /**
   * Total number of access points (scopes) in the current project.
   * Always rendered next to the label; "0" is a valid display value
   * (it tells the user "you haven't created any yet — open me to
   * start") rather than a reason to swap to a different button copy.
   */
  scopeCount: number;
  isOpen: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);

  const state = isOpen ? STATES.active : hover ? STATES.hover : STATES.resting;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${scopeCount} access ${scopeCount === 1 ? 'point' : 'points'} in this project`}
      aria-label="Manage access points"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...CHROME_LABEL_TYPOGRAPHY,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 30,
        padding: '0 12px 0 10px',
        borderRadius: 8,
        border: `1px solid ${state.border}`,
        background: state.bg,
        color: state.text,
        cursor: 'pointer',
        transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
        whiteSpace: 'nowrap',
      }}
    >
      <ChainIcon stroke={state.iconStroke} />
      <span>Access</span>
      <span
        style={{
          // Same font-size as the label per 2026-05-08 spec ("用同样
          // 的字号去做") — the count reads as the second word of the
          // chip's two-word headline, not as a subordinate badge.
          fontSize: CHROME_LABEL_TYPOGRAPHY.fontSize,
          fontWeight: CHROME_LABEL_TYPOGRAPHY.fontWeight,
          color: state.countText,
          fontVariantNumeric: 'tabular-nums',
          transition: 'color 0.15s ease',
        }}
      >
        {scopeCount}
      </span>
    </button>
  );
}

// Mirrors the chain glyph used by ExplorerRowActions' RowActionButton so
// the header chip and the per-row access toggles read as the same
// concept at different scales.
function ChainIcon({ stroke }: { stroke: string }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
        color: stroke,
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Lucide `link-2` (horizontal). Same geometry the explorer
            sidebar's per-row access button uses, and the same the
            Overview's per-row chain stamp uses, so the user reads
            ALL three surfaces (sidebar chip, header chip, list row)
            as the same recurring "access" sigil at different scales.
            Per 2026-05-08 UX feedback: unify the access mark across
            the system or it stops feeling like an identity. */}
        <path d="M9 17H7A5 5 0 0 1 7 7h2" />
        <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
    </span>
  );
}
