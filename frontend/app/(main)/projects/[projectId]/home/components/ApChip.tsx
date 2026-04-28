import React from 'react';
import { Link2 } from 'lucide-react';
import { T } from '../lib/tokens';
import type { DashboardConnection } from '../lib/types';

// Same path-normalization rule used in page.tsx's `accessByPath`
// builder and AccessPointsListCard.  The chip needs to broadcast its
// row's path when hovered, but the row's path coming out of the
// dataCardView is already normalized to '' for project root, so this
// is just a defensive identity for chip's expected inputs.  Kept
// here as a small named helper so hover-sync intent reads at the
// callsite below.
function normalizeChipPath(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === '/') return '';
  return raw;
}

// Right-aligned chip rendered alongside any tree row that has one or
// more Access Points attached to it (per `accessByPath`).  Read it as
// "this row is wired to N agents/tools" — the tiny visual that lets a
// user scanning the Data card see the project's external surface area
// inline, instead of having to cross-reference the ConnectionsCanvas
// below.
//
// Visual contract (intentionally muted):
//   ─ One cyan dot                        — uses T.live, the page's
//                                            single chromatic accent.
//                                            Same hue as the
//                                            ConnectionsCanvas edges
//                                            so users connect the two
//                                            views by colour.
//   ─ Optional count number (only > 1)    — fan-out indicator;
//                                            invisible when there's
//                                            just one AP so the
//                                            common case stays calm.
//   ─ No background, no border, no hover  — the chip belongs to the
//                                            row, not floating ON it;
//                                            the row's own hover wash
//                                            already provides
//                                            interactive feedback.
//
// Why not multiple dots (one per AP, or per provider)?  Tested in
// design — at row height 32px and ~5 char of horizontal budget, two
// dots already crowd the right margin, three is illegible.  A single
// dot + count delivers "this row is wired" in 12px with no clipping.

export function ApChip({
  aps,
  rowPath,
  hoveredPath,
  onHoverPath,
}: {
  aps: DashboardConnection[];
  // Path of the tree row this chip lives on.  Used as the
  // hover-sync key so AccessPointsListCard can match against an
  // AP's normalized path and highlight the corresponding card.
  rowPath: string;
  // Currently hovered path (anywhere — chip OR AP card).  Lifted
  // in page.tsx so chip and card share one source of truth.
  hoveredPath: string | null;
  // Notifier — chip sets this on mouseenter (with its row path) and
  // clears it on mouseleave.  Same callback the AP card uses, so
  // the relationship is reflexive.
  onHoverPath: (path: string | null) => void;
}) {
  if (!aps || aps.length === 0) return null;

  const label =
    aps.length === 1
      ? '1 access point'
      : `${aps.length} access points`;

  const myPath = normalizeChipPath(rowPath);
  const isActive = hoveredPath !== null && hoveredPath === myPath;

  return (
    <div
      title={label}
      aria-label={label}
      onMouseEnter={() => onHoverPath(myPath)}
      onMouseLeave={() => onHoverPath(null)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
        marginLeft: 8,
        marginRight: 12,
        padding: '3px 7px',
        borderRadius: 10,
        // Default-state pill: faint cyan tint + a thin cyan border so
        // the chip reads as a small "wired" badge instead of a naked
        // dot.  The Link2 icon inside is the visual marker — a chain
        // link communicates "connected to something external" the
        // moment a user glances at the row, without forcing them to
        // decode an abstract coloured shape.
        //
        // Active state (hover-sync from chip itself or from the
        // matching AP row in the card below) bumps the bg to
        // `rowHighlightRoot` (the brighter cyan) and the border to
        // saturated `T.live` — same handshake intensity as the AP
        // row picks up so the user sees them light up together.
        background: isActive
          ? T.rowHighlightRoot
          : 'rgba(34, 211, 238, 0.06)',
        border: `1px solid ${
          isActive ? T.live : 'rgba(34, 211, 238, 0.18)'
        }`,
        color: T.text3,
        fontSize: 11,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
        transition: `background 160ms ${T.ease}, border-color 160ms ${T.ease}`,
        cursor: 'default',
      }}
    >
      <Link2
        size={11}
        strokeWidth={2.2}
        style={{ color: T.live, flexShrink: 0 }}
      />
      {aps.length > 1 && (
        <span style={{ color: T.text2, fontWeight: 500 }}>{aps.length}</span>
      )}
    </div>
  );
}
