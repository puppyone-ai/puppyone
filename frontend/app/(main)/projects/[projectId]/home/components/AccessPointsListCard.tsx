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
// Why this exists
//   The right-rail AccessPointsCard treated every AP as a one-line
//   directory entry: provider chip, name, scope, click-to-manage.  But
//   on Home the AP block is the user's *operational* surface — the
//   thing they reach for when they need to paste a `mut connect` URL
//   into a terminal, drop an MCP endpoint into Claude/Cursor, or grab
//   an exec URL for a Sandbox.  280px of sidebar can't carry those
//   strings + the Copy buttons users hit ten times a day.  Promoting
//   the block to the main column gives each AP enough horizontal
//   budget for an Endpoint URL row + a one-shot CLI command row +
//   inline Copy buttons, removing the round-trip to /access for the
//   common copy/paste actions.
//
// Visual contract
//   ─ Section card matches Data / History card chrome (sectionBg +
//     2px sectionBorder + sectionRadius + sectionHeaderBg strip) so
//     it reads as the same family of "framed module" components.
//   ─ Per-AP row is two visual layers stacked:
//       1. Identity strip   — provider avatar, name, status dot,
//                             direction glyph, scope path. Mirrors
//                             the sidebar card's row layout so the
//                             same AP reads as the same thing in
//                             both views.
//       2. Endpoint block   — monospaced URL (with Copy) + provider-
//                             specific CLI command (with Copy) for
//                             provider=filesystem.  Other providers
//                             just get the endpoint URL; the
//                             provider-specific config lives on the
//                             /access detail page.
//   ─ Empty state matches AccessPointsCard's literal copy ("No
//     access points configured.") so users moving between page
//     versions don't see different language for the same state.

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
// FilesystemDetailView / SyncDetailView / GetStartedPanel.  Without
// NEXT_PUBLIC_API_URL on a multi-host deployment (frontend on app.*,
// backend on api.*) the URL we render would point at the frontend
// origin and 404 in any tool that tried to use it.
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
      // exec URL; here we surface the access_key URL and let the
      // detail page own the precise sandbox shape.  TODO: extend
      // dashboard payload with `endpoint_id` if we want a sandbox
      // exec URL to render directly in this card.
      return null;
    default:
      return null;
  }
}

// Shell command users would actually paste, scoped per provider.
// `null` means we don't render a command row for this provider
// (today: everything that isn't filesystem) — those providers'
// invocation shapes (Claude config blob, MCP server entry, sandbox
// exec body) live in their /access detail panels.
function buildCliCommand(conn: DashboardConnection, url: string | null): string | null {
  if (!url || !conn.access_key) return null;
  if (conn.provider !== 'filesystem') return null;
  return `mut connect ${url} --credential ${conn.access_key}`;
}

// Single-line copyable row.  Renders inline (no inset background, no
// border) so it reads as first-class content of the AP card rather
// than a nested "sub-card" — the inset treatment we tried earlier
// produced too much visual nesting (AP card → boxed URL row → boxed
// cmd row) and made the URL/command feel demoted.  Now the AP card
// is the only frame; URL and `$` are just labelled rows inside it.
//
// Used twice per AP row (URL + command) so the horizontal rhythm
// stays predictable.
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
          // Fixed minWidth so URL and $ rows align column-wise — the
          // value column starts at the same x in both lines, which
          // makes "they're parallel things" read at a glance.
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
  // Path of the currently-hovered chip / AP row, normalized via
  // `normalizeApPath`.  When this matches an AP's normalized path,
  // that AP renders in its highlighted state.  `null` means nothing
  // is hovered.  Lifted to page.tsx so a hover on a Data-card
  // ApChip and a hover on this card's AP row share the same source
  // of truth.
  hoveredPath: string | null;
  // Set when this card's row is hovered, cleared when the cursor
  // leaves.  The Data card uses the same callback (via the chip's
  // own onHover) so the hover state is reflexive — hovering the
  // AP card highlights the matching tree row, hovering the tree
  // row highlights the matching AP card.
  onHoverPath: (path: string | null) => void;
}) {
  const total = connections.length;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedKey(key);
    // 1500ms feedback window — long enough to register the affirmation
    // ("yes, that copied"), short enough that consecutive Copy clicks
    // don't feel laggy on the second tap.
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
      {/* Header — matches Data / History card chrome.  Manage > is the
          only header action; the AP creation / edit flow lives behind
          the same chevron either way ("Manage" reads as the parent
          verb that contains both add + edit). */}
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

      {/* Body — flat list of AP rows (sidebar AccessPointsCard
          rhythm: avatar + name + status dot + direction + scope path
          on a single line) with URL / `$` rows nested beneath each.
          minHeight stays so revoke→empty doesn't collapse the card
          shell. */}
      <div style={{ padding: '4px 6px', minHeight: 60 }}>
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
          connections.map((conn, idx) => {
            const direction = getApDirection(conn);
            const label =
              conn.name || PROVIDER_LABELS[conn.provider] || conn.provider;
            // displayScope: '/' for any of the three root-scope
            // forms the backend may produce, '/<path>' otherwise.
            // Without this, root APs render as '//' (template '/'
            // prepended to a path value that's already '/').
            const rawPath = conn.path;
            const isRoot =
              rawPath === null || rawPath === '' || rawPath === '/';
            const displayScope = isRoot ? '/' : `/${rawPath}`;
            const isError = conn.status === 'error';
            const statusColor = isError
              ? T.err
              : conn.status === 'paused'
                ? T.warn
                : T.live;
            const url = buildEndpointUrl(conn);
            const cmd = buildCliCommand(conn, url);

            // Normalized path drives hover-sync between Data ApChip
            // and this card.  When the user mouses over a chip in the
            // tree, page.tsx sets hoveredPath to the chip's row path
            // (already normalized via `accessByPath`'s key); when
            // they mouse over an AP row here, we set hoveredPath to
            // this AP's normalized path.  The matching side
            // highlights — chip ↔ row — making "this card and that
            // chip are the same thing" obvious without the user
            // having to mentally connect colour cues.
            const apPath = normalizeApPath(rawPath);
            const isHovered = hoveredPath !== null && hoveredPath === apPath;

            return (
              <React.Fragment key={conn.id}>
                {/* Per-AP block: identity row + URL + cmd, drawn flat
                    (no individual card frame) — the section card is
                    the only frame, the rows below sit inside its
                    body like a directory listing.  Highlight on
                    hover-sync is a soft cyan tint flush across the
                    whole block (identity row + sub-rows) so the
                    user sees the entire AP, not just one row. */}
                <div
                  onMouseEnter={() => onHoverPath(apPath)}
                  onMouseLeave={() => onHoverPath(null)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '6px 8px',
                    borderRadius: 4,
                    background: isHovered ? T.rowHighlight : 'transparent',
                    transition: `background 160ms ${T.ease}`,
                  }}
                >
                  {/* Identity row — sidebar AccessPointsCard layout
                      verbatim so the same AP reads consistently
                      across surfaces. */}
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/projects/${projectId}/access?ap=${conn.id}`,
                      )
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
                          boxShadow: isError
                            ? 'none'
                            : `0 0 0 2px ${T.liveSoft}`,
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

                  {/* URL + cmd nested rows.  Indented to align with
                      the AP name (24px avatar + 10px gap = 34px) so
                      they read as belonging to this AP without
                      needing extra background chrome. */}
                  {(url || cmd) && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        marginTop: 6,
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
                          onCopy={handleCopy}
                        />
                      )}
                      {cmd && (
                        <CopyableLine
                          label="$"
                          value={cmd}
                          copyKey={`cmd-${conn.id}`}
                          copiedKey={copiedKey}
                          onCopy={handleCopy}
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* Hairline divider between APs — only when there's
                    a next AP after this one.  T.sectionDivider keeps
                    it in the same family as other 1px rules on the
                    page, so the dividers in the AP list read as part
                    of the section card's structure rather than as
                    decorative. */}
                {idx < connections.length - 1 && (
                  <div
                    aria-hidden
                    style={{
                      height: 1,
                      background: T.sectionDivider,
                      margin: '4px 0',
                    }}
                  />
                )}
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}
