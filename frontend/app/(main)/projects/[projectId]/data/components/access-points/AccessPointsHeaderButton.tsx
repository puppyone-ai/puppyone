'use client';

import { ActionButton } from '@/components/ui/ActionButton';

// The chip keeps Access discoverable in the page header: a leading
// chain glyph + the literal word "Access" + a count of access points in
// this project.
//
// 2026-05-08 redesign:
//   - Renamed from "Add access" → "Access". The button doesn't *create*
//     directly; clicking it opens the modal-owned Access surface where
//     creation is one click away. The verb framing was misleading.
//   - Count is now project-wide scope count, not per-scope integration
//     count. The button is a global entry point — its number should
//     reflect the project's total access surface, not whatever scope
//     the user happens to be cursoring over.
//   - Provider stack glyph dropped: it was a per-scope concern and
//     conflicted with the new global semantic.
//
// 2026-05-28 pass — make Access read as a real action:
//   Access is a project-level primary entry, not a pale status badge.
//   Use the shared access button so it has a solid but muted sage-green
//   surface and reads as "granted / connected" without screaming.

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
  return (
    <ActionButton
      variant="access"
      size="sm"
      onClick={onClick}
      title={`${scopeCount} access ${scopeCount === 1 ? 'point' : 'points'} in this project`}
      aria-label="Manage access points"
      aria-pressed={isOpen}
      leadingIcon={<ChainIcon />}
      style={{
        padding: '0 12px 0 10px',
        boxShadow: isOpen
          ? '0 0 0 2px var(--po-access-active-hover)'
          : 'none',
      }}
    >
      <span>Access</span>
      <span
        style={{
          color: 'color-mix(in srgb, var(--po-access-action-contrast) 78%, transparent)',
          fontVariantNumeric: 'tabular-nums',
          transition: 'color 0.15s ease',
        }}
      >
        {scopeCount}
      </span>
    </ActionButton>
  );
}

// Mirrors the chain glyph used across the access surfaces so the header
// chip, scope list rows, and expose menus read as the same concept at
// different scales.
function ChainIcon() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
        color: 'currentColor',
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
        {/* Lucide `link-2` (horizontal). Same geometry the Overview's
            per-row chain stamp uses, so the user reads the header chip
            and list row as the same recurring "access" sigil.
            Per 2026-05-08 UX feedback: unify the access mark across
            the system or it stops feeling like an identity. */}
        <path d="M9 17H7A5 5 0 0 1 7 7h2" />
        <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
    </span>
  );
}
