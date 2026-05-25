'use client';

import { COLOR_FG, COLOR_FG_DIM, COLOR_FG_MUTED } from './tokens';

/**
 * PathBreadcrumb — visual rendering of a scope's path.
 *
 * Replaces the earlier `/gtm/2026-4-7/invoice-reimbursement` mono-string
 * with a `Workspace › gtm › 2026-4-7 › …` chain that's easier for the
 * eye to parse at a glance and visually communicates "this access point
 * lives N levels deep" — the kind of context the user said they wanted
 * to see one-glance from the panel.
 *
 * Long paths get a leading `…` ellipsis: any segment beyond the last
 * three is collapsed so the row never wraps to a second line. Hovering
 * the row shows the full path in the row's `title` attribute.
 */
export function PathBreadcrumb({
  path,
  isRoot,
  muted = true,
}: {
  readonly path: string;
  readonly isRoot: boolean;
  readonly muted?: boolean;
}) {
  if (isRoot || path === '') {
    return (
      <span style={{ color: muted ? COLOR_FG_DIM : COLOR_FG_MUTED }}>
        Workspace root
      </span>
    );
  }

  const segments = path.split('/').filter(Boolean);
  const MAX = 3;
  const visible = segments.length > MAX ? segments.slice(-MAX) : segments;
  const truncated = segments.length > MAX;

  const sep = (
    <span
      aria-hidden
      style={{
        margin: '0 4px',
        color: muted ? COLOR_FG_DIM : COLOR_FG_MUTED,
        opacity: 0.6,
      }}
    >
      ›
    </span>
  );

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        flexWrap: 'nowrap',
        overflow: 'hidden',
      }}
    >
      <span style={{ color: muted ? COLOR_FG_DIM : COLOR_FG_MUTED }}>Workspace</span>
      {sep}
      {truncated && (
        <>
          <span aria-hidden style={{ color: muted ? COLOR_FG_DIM : COLOR_FG_MUTED, opacity: 0.6 }}>
            …
          </span>
          {sep}
        </>
      )}
      {visible.map((seg, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <span
          key={i}
          style={{
            display: 'inline-flex',
            alignItems: 'baseline',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: i === visible.length - 1
              ? COLOR_FG
              : muted
                ? COLOR_FG_DIM
                : COLOR_FG_MUTED,
            fontWeight: i === visible.length - 1 ? 500 : 400,
          }}
        >
          {seg}
          {i < visible.length - 1 && sep}
        </span>
      ))}
    </span>
  );
}
