import React from 'react';
import { T } from '../lib/tokens';
import type { DashboardConnection } from '../lib/types';

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

export function ApChip({ aps }: { aps: DashboardConnection[] }) {
  if (!aps || aps.length === 0) return null;

  const label =
    aps.length === 1
      ? '1 access point'
      : `${aps.length} access points`;

  return (
    <div
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        flexShrink: 0,
        marginLeft: 8,
        marginRight: 12,
        // Quiet by default — the chip should read as a small
        // informational marker, not a CTA.  Lifted to text2 on the
        // count keeps the number legible without competing with the
        // file/folder name to its left.
        color: T.text3,
        fontSize: 11,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: T.live,
          flexShrink: 0,
        }}
      />
      {aps.length > 1 && (
        <span style={{ color: T.text2, fontWeight: 500 }}>{aps.length}</span>
      )}
    </div>
  );
}
