'use client';

import { useState } from 'react';
import type { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, ArrowLeftRight } from 'lucide-react';
import { T } from '../lib/tokens';
import { PROVIDER_LABELS, getApDirection } from '../lib/constants';
import type { DashboardConnection } from '../lib/types';
import { ProviderAvatar } from './ProviderAvatar';

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

// Single-line copyable pill: monospaced text with a hover-only Copy
// button on the right.  Used twice per AP row (URL + command) so the
// horizontal rhythm stays predictable.
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
        gap: 8,
        padding: '6px 10px',
        background: 'rgba(0,0,0,0.25)',
        border: `1px solid ${T.cardBorder}`,
        borderRadius: 4,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: T.text3,
          letterSpacing: '0.05em',
          flexShrink: 0,
          minWidth: 28,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <code
        style={{
          flex: 1,
          fontSize: 11,
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
          padding: '2px 8px',
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
}: {
  projectId: string;
  router: ReturnType<typeof useRouter>;
  connections: DashboardConnection[];
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

      {/* Body — list of AP cards or the empty placeholder.  minHeight
          keeps the card from collapsing when an empty project has
          zero APs (rare in practice — `mut connect` bootstrap creates
          one — but the layout floor matters for visual stability
          when an AP gets revoked). */}
      <div style={{ padding: '8px 8px', minHeight: 60 }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {connections.map((conn) => {
              const direction = getApDirection(conn);
              const label =
                conn.name || PROVIDER_LABELS[conn.provider] || conn.provider;
              const scope = conn.path || '';
              const isError = conn.status === 'error';
              const statusColor = isError
                ? T.err
                : conn.status === 'paused'
                  ? T.warn
                  : T.live;
              const url = buildEndpointUrl(conn);
              const cmd = buildCliCommand(conn, url);

              return (
                <div
                  key={conn.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: 10,
                    borderRadius: 6,
                    background: T.cardBg,
                    border: `1px solid ${T.cardBorder}`,
                    transition: `background 160ms ${T.ease}, border-color 160ms ${T.ease}`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = T.cardBgH;
                    e.currentTarget.style.borderColor = T.cardBorderH;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = T.cardBg;
                    e.currentTarget.style.borderColor = T.cardBorder;
                  }}
                >
                  {/* Identity strip — same layout rhythm as sidebar
                      AccessPointsCard so the same AP reads consistently
                      across the two views.  Whole strip is clickable
                      to /access?ap=<id> for full management. */}
                  <button
                    type="button"
                    onClick={() =>
                      router.push(
                        `/projects/${projectId}/access?ap=${conn.id}`,
                      )
                    }
                    title={`${label}${scope ? ` — /${scope}` : ''} (${conn.status})`}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
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
                        {scope ? `/${scope}` : '/'}
                      </span>
                    </div>
                  </button>

                  {/* Endpoint URL — every AP that has an access_key gets
                      a copyable URL.  Sandbox provider returns null for
                      now (its public route uses endpoint.id which the
                      dashboard doesn't surface yet); we just don't
                      render the line in that case rather than showing a
                      partially-broken pill. */}
                  {url && (
                    <CopyableLine
                      label="URL"
                      value={url}
                      copyKey={`url-${conn.id}`}
                      copiedKey={copiedKey}
                      onCopy={handleCopy}
                    />
                  )}

                  {/* CLI command — filesystem only for now.  Other
                      providers' invocation shapes (MCP server config,
                      sandbox exec body, agent prompt etc.) are richer
                      than a single command line and live on the
                      /access detail page. */}
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
