'use client';

import type { useRouter } from 'next/navigation';
import { ArrowRight, ArrowLeft, ArrowLeftRight } from 'lucide-react';
import { AI_AGENT_ENABLED } from '@/lib/featureFlags';
import { T } from '../lib/tokens';
import { PROVIDER_LABELS, getApDirection } from '../lib/constants';
import type { DashboardConnection } from '../lib/types';
import { ProviderAvatar } from './ProviderAvatar';

// AccessPointsCard — Right-column card listing every AP attached to the
// project, mirroring the Data card on the left so the right rail reads
// as a coherent "what's around this project" overview.
//
// One row per AP, intentionally compact:
//   [provider avatar] [name + status dot]      [→/⇄/← direction]   [/scope]
//
// Why not just reuse APCard?
//   APCard is purpose-built for the (now-removed) inline canvas: 32px
//   icon container, hover popover with full meta grid, drag-aware
//   pointer handling, status pill, etc. — way too rich for a sidebar
//   list.  Here we want a directory-listing rhythm where you can scan
//   8 APs at a glance, click into one to manage it.  Direction +
//   scope path are the two pieces a Home visitor actually wants;
//   everything else (trigger, schedule, last-sync) is one click away
//   in /access.
//
// Empty state matches the OLD GitHub-style page literally — same
// copy ("No access points configured.") and same dashed-button
// affordance for the first-time-add gesture.  Keeping the language
// stable across versions reduces re-onboarding cost.

function DirectionGlyph({ direction }: { direction: 'inbound' | 'outbound' | 'bidirectional' }) {
  // Cyan tone for outbound is intentional: outbound APs are agents/MCPs
  // pulling DATA OUT, which is the "live wire" half of the system —
  // matches the cyan-for-live-data convention used elsewhere.
  // Bidirectional gets cyan too (filesystem MUT is the canonical example,
  // also a live wire).  Inbound is greyer because most projects have many
  // inbound sources and they're the "ambient" half.
  if (direction === 'outbound') {
    return <ArrowLeft size={11} strokeWidth={2} style={{ color: T.live, flexShrink: 0 }} />;
  }
  if (direction === 'bidirectional') {
    return <ArrowLeftRight size={11} strokeWidth={2} style={{ color: T.live, flexShrink: 0 }} />;
  }
  return <ArrowRight size={11} strokeWidth={2} style={{ color: T.text3, flexShrink: 0 }} />;
}

export function AccessPointsCard({
  projectId,
  router,
  connections,
}: {
  projectId: string;
  router: ReturnType<typeof useRouter>;
  connections: DashboardConnection[];
}) {
  // Filter out agent connectors when the in-app chat agent feature
  // is hidden (see `frontend/lib/featureFlags.ts`). The connectors
  // still exist on the server (auto-INSERTed per scope by the DB
  // trigger) but we don't list them in the home overview while the
  // surface is hidden — the row would link to /access?ap=<id> which
  // also filters them out, so the click would land on an empty
  // detail panel.
  const visibleConnections = AI_AGENT_ENABLED
    ? connections
    : connections.filter((c) => c.provider !== 'agent');
  const total = visibleConnections.length;

  return (
    <div
      style={{
        // Section card surface — see `tokens.ts`.  Locked in step
        // with the Data and History cards so the right rail reads
        // as a coherent set of framed panels.
        background: T.sectionBg,
        border: `2px solid ${T.sectionBorder}`,
        borderRadius: T.sectionRadius,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header — Title-Case label + count chip on the left, Manage →
          link on the right.  Action is "Manage" rather than "+"
          because the AP-creation flow lives behind the same chevron
          either way; "Manage" reads as the parent verb that contains
          both add + edit. */}
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
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: T.text2,
            }}
          >
            Integrations
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
              background: 'var(--po-border)',
              fontSize: 11,
              fontWeight: 600,
              // Dimmed from text1 → text2 (chip number was glaring
              // brighter than the label next to it).
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
          title="Add integration"
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

      {/* Body — list of AP rows or the empty placeholder.  We don't add
          a sparkline footer here (unlike HistoryCard) because per-AP
          activity is already implied by the row's own status dot, and
          a global usage spark would conflict with the topology canvas
          below where the same data is the relationship signal. */}
      <div style={{ padding: '4px 6px', minHeight: 60 }}>
        {total === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px 8px',
              color: T.text3,
              fontSize: 12,
            }}
          >
            No integrations configured.
          </div>
        ) : (
          visibleConnections.map((conn) => {
            const direction = getApDirection(conn);
            const label = conn.name || PROVIDER_LABELS[conn.provider] || conn.provider;
            const scope = conn.path || '';
            const isError = conn.status === 'error';
            const statusColor = isError
              ? T.err
              : conn.status === 'paused'
                ? T.warn
                : T.live;

            return (
              <button
                key={conn.id}
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
                  padding: '8px 8px',
                  margin: 0,
                  width: '100%',
                  textAlign: 'left',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  color: T.text2,
                  fontFamily: T.fontSans,
                  transition: `background 160ms ${T.ease}, color 160ms ${T.ease}`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = T.rowHover;
                  e.currentTarget.style.color = T.text1;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = T.text2;
                }}
              >
                {/* Provider avatar — same chip treatment as APCard so
                    the same provider reads as the same thing across
                    the page.  Smaller (24x24) because the row is
                    denser than the canvas card. */}
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--po-hover)',
                    flexShrink: 0,
                  }}
                >
                  <ProviderAvatar
                    provider={conn.provider}
                    size={16}
                    icon={(conn as any).icon}
                  />
                </div>

                {/* Name + status dot.  Status dot inline with the name
                    because the row is too dense for a separate trailing
                    pill (would compete with the scope path on the
                    right). */}
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
                      color: 'inherit',
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

                {/* Direction + scope path — pinned to the right edge.
                    Direction glyph carries the in/out semantics; scope
                    in mono so it visually reads as a path even when
                    truncated.  Gap is small so the two read as one
                    "→ /code" tag rather than two unrelated tokens. */}
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
                  {scope && (
                    <span
                      style={{
                        fontFamily: T.fontMono,
                        fontSize: 11,
                        color: T.text3,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 140,
                      }}
                    >
                      /{scope}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
