'use client';

import React, { useState } from 'react';
import type { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, ArrowLeftRight } from 'lucide-react';
import { T } from '../lib/tokens';
import { PROVIDER_LABELS, getApDirection } from '../lib/constants';
import type { DashboardConnection } from '../lib/types';
import { ProviderAvatar } from './ProviderAvatar';

// Normalize the three known "root scope" path representations the
// backend may emit ('/' for `mut connect` bootstrap rows, null for
// legacy rows, '' for early hand-bootstrapped rows) into a single
// canonical key.  Used both for the lookup key in `accessByPath` and
// for the hover-sync key here.  Keep this in step with the same
// normalization in page.tsx — if they drift, the chip↔card hover
// handshake silently breaks.
function normalizeApPath(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === '' || raw === '/') {
    return '';
  }
  return raw;
}

// AccessPointsListCard — left-column primary surface that replaces the
// previous ConnectionsCanvas slot.
//
// Layout: section card with the same chrome as Data / History.  Body
// is a flat list (sidebar AccessPointsCard rhythm verbatim: avatar +
// name + status dot + direction + scope path) with URL / `$` rows
// nested below each, indented to align with the AP name.  Adjacent
// APs are separated by a 1px hairline divider so multi-AP lists
// don't visually fuse.
//
// Hover-sync: each AP row + the matching ApChip in the Data tree
// share a single `hoveredPath` source of truth lifted to page.tsx.
// Mousing over either side flips on a highlight on the other:
//   ─ Self-hover (cursor on the AP row) → neutral grey wash
//     (T.rowHover), the same affordance every clickable row in the
//     app uses.  Cyan would over-promise here; the user is actively
//     interacting with the row, not observing a relationship.
//   ─ Synced highlight (chip in the tree above is hovered) → cyan
//     wash (T.rowHighlight), matching the chip pill's accent.  This
//     is the "we're the same thing" state — colour locked to the
//     chip side of the handshake.
//   ─ Both at once: self-hover wins; we don't double-paint.

function DirectionGlyph({ direction }: { direction: 'inbound' | 'outbound' | 'bidirectional' }) {
  if (direction === 'outbound') {
    return <ArrowLeft size={11} strokeWidth={2} style={{ color: T.live, flexShrink: 0 }} />;
  }
  if (direction === 'bidirectional') {
    return <ArrowLeftRight size={11} strokeWidth={2} style={{ color: T.live, flexShrink: 0 }} />;
  }
  return <ArrowRight size={11} strokeWidth={2} style={{ color: T.text3, flexShrink: 0 }} />;
}

// Compose the public-facing endpoint URL for an AP, picking the right
// path shape per provider.  The host comes from NEXT_PUBLIC_API_URL
// when set (build-time-baked backend host) and falls back to the
// current page origin only when no env was provided — same pattern as
// FilesystemDetailView / SyncDetailView / GetStartedPanel.
function buildEndpointUrl(conn: DashboardConnection): string | null {
  if (!conn.access_key) return null;
  const apiBase =
    typeof window !== 'undefined'
      ? process.env.NEXT_PUBLIC_API_URL || window.location.origin
      : '';

  switch (conn.provider) {
    case 'filesystem':
      return `${apiBase}/api/v1/mut/ap/${conn.access_key}`;
    case 'mcp':
    case 'agent':
      return `${apiBase}/api/v1/mcp/proxy/${conn.access_key}`;
    case 'sandbox':
      // Sandbox uses endpoint.id rather than access_key for the
      // public exec route, but DashboardConnection only carries
      // access_key.  The /access detail page composes the real
      // exec URL; here we surface no URL rather than a broken one.
      return null;
    default:
      return null;
  }
}

// Shell command users would actually paste, scoped per provider.
// `null` means we don't render a command row for this provider —
// today everything that isn't filesystem; their richer invocation
// shapes (MCP server config blob, sandbox exec body, etc.) live on
// the /access detail page.
function buildCliCommand(conn: DashboardConnection, url: string | null): string | null {
  if (!url || !conn.access_key) return null;
  if (conn.provider !== 'filesystem') return null;
  return `mut connect ${url} --credential ${conn.access_key}`;
}

// Single-line copyable row.  Renders inline (no inset background, no
// border) so it reads as first-class content of the AP body rather
// than a nested "sub-card".  Label + value + Copy in a row.
function CopyableLine({
  label,
  value,
  copyKey,
  copiedKey,
  onCopy,
}: {
  label: string;
  value: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const isCopied = copiedKey === copyKey;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 0,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: T.text3,
          letterSpacing: '0.05em',
          flexShrink: 0,
          minWidth: 22,
          textTransform: 'uppercase',
          fontFamily: T.fontMono,
        }}
      >
        {label}
      </span>
      <code
        style={{
          flex: 1,
          fontSize: 12,
          color: T.text2,
          fontFamily: T.fontMono,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        {value}
      </code>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCopy(value, copyKey);
        }}
        style={{
          flexShrink: 0,
          padding: '2px 10px',
          fontSize: 10,
          fontWeight: 500,
          color: isCopied ? T.live : T.text3,
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid ${T.cardBorder}`,
          borderRadius: 3,
          cursor: 'pointer',
          fontFamily: T.fontSans,
          transition: `color 160ms ${T.ease}, background 160ms ${T.ease}`,
        }}
        onMouseEnter={(e) => {
          if (isCopied) return;
          e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
          e.currentTarget.style.color = T.text1;
        }}
        onMouseLeave={(e) => {
          if (isCopied) return;
          e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
          e.currentTarget.style.color = T.text3;
        }}
      >
        {isCopied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function AccessPointsListCard({
  projectId,
  router,
  connections,
  hoveredPath,
  onHoverPath,
}: {
  projectId: string;
  router: ReturnType<typeof useRouter>;
  connections: DashboardConnection[];
  hoveredPath: string | null;
  onHoverPath: (path: string | null) => void;
}) {
  const total = connections.length;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1500);
  };

  return (
    <div
      style={{
        background: T.sectionBg,
        border: `2px solid ${T.sectionBorder}`,
        borderRadius: T.sectionRadius,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: T.sectionHeaderBg,
          borderBottom: `1px solid ${T.sectionDivider}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: T.text2 }}>
            Access Points
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 20,
              height: 18,
              padding: '0 6px',
              borderRadius: 9,
              background: 'rgba(255,255,255,0.08)',
              fontSize: 11,
              fontWeight: 600,
              color: total > 0 ? T.text2 : T.text3,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}
          >
            {total}
          </span>
        </div>
        <button
          onClick={() => router.push(`/projects/${projectId}/access`)}
          title="Manage access points"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            fontSize: 12,
            color: T.text2,
            fontFamily: T.fontSans,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            transition: `color 200ms ${T.ease}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = T.text1;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = T.text2;
          }}
        >
          Manage
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path
              d="M4 2l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div style={{ padding: '6px 8px', minHeight: 60 }}>
        {total === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '32px 8px',
              color: T.text3,
              fontSize: 12,
            }}
          >
            No access points configured.
          </div>
        ) : (
          connections.map((conn, idx) => (
            <ApListRow
              key={conn.id}
              conn={conn}
              isLast={idx === connections.length - 1}
              projectId={projectId}
              router={router}
              hoveredPath={hoveredPath}
              onHoverPath={onHoverPath}
              copiedKey={copiedKey}
              onCopy={handleCopy}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Single AP row — hoisted out of the .map so we can keep an
// `isMouseOver` local state that distinguishes "the user actually
// has the cursor on this row" from "this row got highlighted because
// the matching chip in the tree above is hovered".  The two states
// look different by design (see component-level comment).
function ApListRow({
  conn,
  isLast,
  projectId,
  router,
  hoveredPath,
  onHoverPath,
  copiedKey,
  onCopy,
}: {
  conn: DashboardConnection;
  isLast: boolean;
  projectId: string;
  router: ReturnType<typeof useRouter>;
  hoveredPath: string | null;
  onHoverPath: (path: string | null) => void;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const [isMouseOver, setIsMouseOver] = useState(false);

  const direction = getApDirection(conn);
  const label = conn.name || PROVIDER_LABELS[conn.provider] || conn.provider;
  const rawPath = conn.path;
  const isRoot = rawPath === null || rawPath === '' || rawPath === '/';
  const displayScope = isRoot ? '/' : `/${rawPath}`;
  const isError = conn.status === 'error';
  const statusColor = isError
    ? T.err
    : conn.status === 'paused'
      ? T.warn
      : T.live;
  const url = buildEndpointUrl(conn);
  const cmd = buildCliCommand(conn, url);

  const apPath = normalizeApPath(rawPath);
  const isSyncHighlighted =
    !isMouseOver && hoveredPath !== null && hoveredPath === apPath;

  // Background priority: self-hover (grey, "you can click me") wins
  // over sync (cyan, "we're the same thing as the hovered chip"),
  // wins over rest (transparent).
  const background = isMouseOver
    ? T.rowHover
    : isSyncHighlighted
      ? T.rowHighlight
      : 'transparent';

  return (
    <React.Fragment>
      <div
        onMouseEnter={() => {
          setIsMouseOver(true);
          onHoverPath(apPath);
        }}
        onMouseLeave={() => {
          setIsMouseOver(false);
          onHoverPath(null);
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '10px 10px',
          borderRadius: 6,
          background,
          transition: `background 160ms ${T.ease}`,
        }}
      >
        {/* Identity row — sidebar AccessPointsCard layout verbatim
            so the same AP reads consistently across surfaces. */}
        <button
          type="button"
          onClick={() =>
            router.push(`/projects/${projectId}/access?ap=${conn.id}`)
          }
          title={`${label} — ${displayScope} (${conn.status})`}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 0',
            width: '100%',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: T.text2,
            fontFamily: T.fontSans,
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.04)',
              flexShrink: 0,
            }}
          >
            <ProviderAvatar
              provider={conn.provider}
              size={16}
              icon={(conn as any).icon}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
              flexShrink: 1,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: T.text1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {label}
            </span>
            <span
              aria-hidden
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: statusColor,
                boxShadow: isError ? 'none' : `0 0 0 2px ${T.liveSoft}`,
                flexShrink: 0,
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginLeft: 'auto',
              minWidth: 0,
              flexShrink: 1,
            }}
          >
            <DirectionGlyph direction={direction} />
            <span
              style={{
                fontFamily: T.fontMono,
                fontSize: 11,
                color: T.text3,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 220,
              }}
            >
              {displayScope}
            </span>
          </div>
        </button>

        {/* URL + cmd nested rows.  Indented 34px to align with the
            AP name (24px avatar + 10px gap), so they read as
            belonging to this AP without needing extra background
            chrome. */}
        {(url || cmd) && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              marginTop: 8,
              marginLeft: 34,
              marginRight: 0,
            }}
          >
            {url && (
              <CopyableLine
                label="URL"
                value={url}
                copyKey={`url-${conn.id}`}
                copiedKey={copiedKey}
                onCopy={onCopy}
              />
            )}
            {cmd && (
              <CopyableLine
                label="$"
                value={cmd}
                copyKey={`cmd-${conn.id}`}
                copiedKey={copiedKey}
                onCopy={onCopy}
              />
            )}
          </div>
        )}
      </div>

      {/* Divider between adjacent APs.  Lifted from T.sectionDivider
          (very faint hairline) to T.border (the app's standard 1px
          rule) — the previous opacity wasn't pulling enough weight
          for users to read multiple APs as distinct list items.
          Slightly more vertical breathing room (8px → 10px each side)
          for the same reason. */}
      {!isLast && (
        <div
          aria-hidden
          style={{
            height: 1,
            background: T.border,
            margin: '6px 8px',
          }}
        />
      )}
    </React.Fragment>
  );
}
