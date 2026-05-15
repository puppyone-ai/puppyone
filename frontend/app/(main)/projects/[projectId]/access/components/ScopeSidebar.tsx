'use client';

/**
 * ScopeSidebar — left rail of the access page.
 *
 * Sidebar shows one row per *mount point*, full stop. The mount point
 * is the access-point unit at this layer (everything bound to it is
 * "an access point at this path"). Provider categories — CLI, Agent,
 * Third-party — are a *detail-pane* concern, not a sidebar concern.
 *
 * Composition:
 *  - `ScopeSidebar`     wraps the scrollable column + header geometry.
 *  - `ScopeSidebarRow`  is one row in the list.
 *
 * Both live in this file because the row only exists to populate the
 * sidebar — there's no other consumer.
 */

import { useState } from 'react';
import type { RepoScope } from '@/lib/repoApi';
import { T } from '../lib/tokens';
import { ScopePinGlyph } from './icons';

// ─── Sidebar shell ───────────────────────────────────────────────────

export function ScopeSidebar({
  scopes,
  connectorsByScope,
  selectedScopeId,
  onSelect,
}: {
  readonly scopes: readonly RepoScope[];
  readonly connectorsByScope: ReadonlyMap<string, readonly { id: string }[]>;
  readonly selectedScopeId: string | undefined;
  readonly onSelect: (id: string) => void;
}) {
  return (
    // Width is owned by the parent `ResizableSidebarColumn` so the
    // user can drag-resize this rail. We just fill 100% of whatever
    // column container is given to us — same shape as the data
    // view's `ExplorerSidebar`.
    <div
      style={{
        width: '100%',
        height: '100%',
        flex: 1,
        minWidth: 0,
        borderRight: '1px solid var(--po-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--po-canvas)',
      }}
    >
      {/*
        Two-layer wrapper that mirrors `ExplorerSidebar` to the
        pixel — `paddingTop: 6` on the outer scroll container plus
        `padding: '0 0 6px 0'` on the inner wrapper. Together with
        each row's `marginTop: 2` this places the top edge of the
        first row at 6 + 0 + 2 = 8px below the sidebar header,
        exactly where the data view's "Root" row sits. Without this
        pairing, switching between /data and /access shifted the
        list down by 1px and the user could feel it.
      */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          overflowX: 'hidden',
          position: 'relative',
          paddingTop: 6,
        }}
      >
        <div style={{ padding: '0 0 6px 0', position: 'relative', boxSizing: 'border-box' }}>
          {scopes.map((s) => (
            <ScopeSidebarRow
              key={s.id}
              scope={s}
              connectorCount={connectorsByScope.get(s.id)?.length ?? 0}
              isSelected={s.id === selectedScopeId}
              onClick={() => onSelect(s.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar row ─────────────────────────────────────────────────────
//
// The row geometry below mirrors `ExplorerTreeRow` at depth 0 *to the
// pixel*: outer 30px / 1px-vertical-6px-horizontal margin / 6px radius;
// inner content with paddingLeft 8 + paddingRight 6 + gap 6 + 16x16
// icon column. We keep the two views in lock-step so a user flipping
// between data + access can't catch a 1-pixel jitter — that's the
// kind of subtle drift that erodes trust in the surface.

function ScopeSidebarRow({
  scope,
  connectorCount,
  isSelected,
  onClick,
}: {
  readonly scope: RepoScope;
  readonly connectorCount: number;
  readonly isSelected: boolean;
  readonly onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isWorkspaceWide = scope.path === '' || scope.is_root;
  const displayName = isWorkspaceWide
    ? (scope.name || 'Workspace root')
    : (scope.name || scope.path.split('/').filter(Boolean).pop() || scope.path);
  const subPath = isWorkspaceWide ? '/' : `/${scope.path}`;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        // Mirrors `ExplorerSidebar`'s Root row exactly (margin '2px 6px',
        // height 30, radius 6). Each access-page row is a *top-level*
        // entry in product terms — same shelf as Root, not a child of
        // it — so taking Root's vertical rhythm rather than
        // `ExplorerTreeRow`'s 1px keeps the first-row top edge at
        // exactly 8px below the sidebar header (paired with the
        // outer paddingTop: 6 wrapper above).
        margin: '2px 6px',
        height: 30,
        boxSizing: 'border-box',
        borderRadius: 6,
        // Translucent overlay so any structural lines (drop scope
        // border, tree elbow on neighbouring views) keep showing
        // through. Mirrors `ExplorerTreeRow` which made the same
        // switch — the two views are intentionally lock-stepped on
        // visual rhythm.
        background: isSelected ? 'var(--po-selected)' : hovered ? 'var(--po-hover)' : 'transparent',
        color: isSelected ? T.text1 : hovered ? T.text1 : T.text2,
        fontSize: 13,
        fontFamily: T.fontSans,
        userSelect: 'none',
        transition: 'background 0.1s, color 0.1s',
        cursor: 'pointer',
        position: 'relative',
      }}
      title={`${displayName} · ${subPath}`}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: '100%',
          boxSizing: 'border-box',
          paddingLeft: 8,
          paddingRight: 6,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            width: 16,
            height: 16,
            justifyContent: 'center',
          }}
        >
          <ScopePinGlyph size={16} />
        </div>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 6,
            overflow: 'hidden',
            fontFamily: T.fontSans,
          }}
        >
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {displayName}
          </span>
          <span
            style={{
              fontSize: 11,
              color: isSelected ? T.text2 : T.text3,
              fontFamily: T.fontMono,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flexShrink: 1,
              minWidth: 0,
            }}
          >
            {subPath}
          </span>
        </span>
        <span
          style={{
            flexShrink: 0,
            fontSize: 10.5,
            fontWeight: 600,
            padding: '1px 5px',
            borderRadius: 4,
            background: isSelected ? 'var(--po-border-strong)' : 'var(--po-hover)',
            color: isSelected ? T.text1 : T.text3,
            fontFamily: T.fontMono,
            letterSpacing: '0.04em',
          }}
        >
          {connectorCount}
        </span>
      </div>
    </div>
  );
}
